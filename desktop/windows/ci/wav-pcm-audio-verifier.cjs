"use strict";

/**
 * Zero-dependency RIFF/WAVE PCM 16-bit Audio Synthesizer, Header Parser,
 * and Acoustic DSP / Voice Activity Verifier for offline desktop STT/TTS pipelines.
 */

const WAV_HEADER_BYTES = 44;

/**
 * Synthesizes a valid RIFF/WAVE 16-bit Little-Endian PCM audio buffer.
 * Supports multi-segment tone/silence programming for testing voice activity detection.
 *
 * @param {object} options
 * @param {number} [options.sampleRate=16000]
 * @param {number} [options.channels=1]
 * @param {number} [options.durationMs=500]
 * @param {number} [options.frequencyHz=440]
 * @param {number} [options.amplitude=0.7] - Normalized [0.0, 1.0]
 * @param {Array<{ startMs: number, endMs: number, frequencyHz: number, amplitude: number }>} [options.segments]
 * @returns {Buffer}
 */
function synthesizeWavPcmBuffer(options = {}) {
  const sampleRate = options.sampleRate || 16000;
  const channels = options.channels || 1;
  const durationMs = options.durationMs || 500;
  const defaultFreq = options.frequencyHz ?? 440;
  const defaultAmp = options.amplitude ?? 0.7;
  const segments = Array.isArray(options.segments) ? options.segments : null;

  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = channels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const totalSamplesPerChannel = Math.floor((sampleRate * durationMs) / 1000);
  const dataByteLength = totalSamplesPerChannel * blockAlign;
  const buffer = Buffer.alloc(WAV_HEADER_BYTES + dataByteLength);

  // RIFF Chunk Descriptor
  buffer.write("RIFF", 0, 4, "ascii");
  buffer.writeUInt32LE(36 + dataByteLength, 4);
  buffer.write("WAVE", 8, 4, "ascii");

  // fmt Sub-chunk
  buffer.write("fmt ", 12, 4, "ascii");
  buffer.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  buffer.writeUInt16LE(1, 20); // AudioFormat (1 = Linear PCM)
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);

  // data Sub-chunk
  buffer.write("data", 36, 4, "ascii");
  buffer.writeUInt32LE(dataByteLength, 40);

  let offset = WAV_HEADER_BYTES;
  for (let i = 0; i < totalSamplesPerChannel; i++) {
    const timeSec = i / sampleRate;
    const timeMs = timeSec * 1000;

    let freq = defaultFreq;
    let amp = defaultAmp;

    if (segments) {
      freq = 0;
      amp = 0;
      for (const seg of segments) {
        if (timeMs >= seg.startMs && timeMs < seg.endMs) {
          freq = seg.frequencyHz;
          amp = seg.amplitude;
          break;
        }
      }
    }

    const rawSample = amp > 0 && freq > 0 ? Math.sin(2 * Math.PI * freq * timeSec) * amp : 0;
    const clamped = Math.max(-1, Math.min(1, rawSample));
    const int16Sample = Math.round(clamped * 32767);

    for (let ch = 0; ch < channels; ch++) {
      buffer.writeInt16LE(int16Sample, offset);
      offset += 2;
    }
  }

  return buffer;
}

/**
 * Parses and validates a RIFF/WAVE PCM 16-bit audio buffer and extracts acoustic metrics
 * and Voice Activity Detection (VAD) active segments.
 *
 * @param {Buffer} wavBuffer
 * @param {object} [options]
 * @param {number} [options.frameDurationMs=20]
 * @param {number} [options.vadThresholdDbFs=-40]
 */
function analyzeAndVerifyWavPcm(wavBuffer, options = {}) {
  const errors = [];
  if (!Buffer.isBuffer(wavBuffer) || wavBuffer.length < WAV_HEADER_BYTES) {
    return {
      valid: false,
      errors: ["WAV_BUFFER_TOO_SHORT: Buffer must be at least 44 bytes"]
    };
  }

  const riffMagic = wavBuffer.toString("ascii", 0, 4);
  const waveMagic = wavBuffer.toString("ascii", 8, 12);
  const fmtMagic = wavBuffer.toString("ascii", 12, 16);
  const dataMagic = wavBuffer.toString("ascii", 36, 40);

  if (riffMagic !== "RIFF" || waveMagic !== "WAVE") {
    errors.push(`INVALID_RIFF_WAVE_SIGNATURE: got ${riffMagic}/${waveMagic}`);
  }
  if (fmtMagic !== "fmt ") {
    errors.push(`INVALID_FMT_CHUNK: got ${fmtMagic}`);
  }
  if (dataMagic !== "data") {
    errors.push(`INVALID_DATA_CHUNK: got ${dataMagic}`);
  }

  const audioFormat = wavBuffer.readUInt16LE(20);
  const channels = wavBuffer.readUInt16LE(22);
  const sampleRate = wavBuffer.readUInt32LE(24);
  const byteRate = wavBuffer.readUInt32LE(28);
  const blockAlign = wavBuffer.readUInt16LE(32);
  const bitsPerSample = wavBuffer.readUInt16LE(34);
  const declaredDataBytes = wavBuffer.readUInt32LE(40);
  const actualDataBytes = wavBuffer.length - WAV_HEADER_BYTES;

  if (audioFormat !== 1) {
    errors.push(`UNSUPPORTED_AUDIO_FORMAT: expected PCM (1), got ${audioFormat}`);
  }
  if (bitsPerSample !== 16) {
    errors.push(`UNSUPPORTED_BITS_PER_SAMPLE: expected 16, got ${bitsPerSample}`);
  }
  const expectedBlockAlign = channels * (bitsPerSample / 8);
  if (blockAlign !== expectedBlockAlign) {
    errors.push(`BLOCK_ALIGN_MISMATCH: expected ${expectedBlockAlign}, got ${blockAlign}`);
  }
  const expectedByteRate = sampleRate * expectedBlockAlign;
  if (byteRate !== expectedByteRate) {
    errors.push(`BYTE_RATE_MISMATCH: expected ${expectedByteRate}, got ${byteRate}`);
  }
  if (declaredDataBytes > actualDataBytes) {
    errors.push(
      `TRUNCATED_PCM_DATA: header declared ${declaredDataBytes} bytes, buffer has ${actualDataBytes}`
    );
  }

  if (errors.length > 0) {
    return {
      valid: false,
      errors
    };
  }

  const totalFrames = Math.floor(declaredDataBytes / blockAlign);
  const durationMs = Math.round((totalFrames / sampleRate) * 1000);

  let sumSquares = 0;
  let sumSamples = 0;
  let peakAbs = 0;
  let clippedSamples = 0;
  let zeroCrossings = 0;
  let prevSign = 0;

  const monoSamples = new Float64Array(totalFrames);

  for (let f = 0; f < totalFrames; f++) {
    const sampleOffset = WAV_HEADER_BYTES + f * blockAlign;
    const rawInt16 = wavBuffer.readInt16LE(sampleOffset);
    const normalized = rawInt16 / 32768.0;
    monoSamples[f] = normalized;

    sumSamples += normalized;
    sumSquares += normalized * normalized;
    const absVal = Math.abs(normalized);
    if (absVal > peakAbs) peakAbs = absVal;
    if (Math.abs(rawInt16) >= 32766) clippedSamples++;

    const sign = normalized > 1e-4 ? 1 : normalized < -1e-4 ? -1 : 0;
    if (sign !== 0 && prevSign !== 0 && sign !== prevSign) {
      zeroCrossings++;
    }
    if (sign !== 0) prevSign = sign;
  }

  const rmsLinear = totalFrames > 0 ? Math.sqrt(sumSquares / totalFrames) : 0;
  const rmsDbFs = rmsLinear > 1e-9 ? Number((20 * Math.log10(rmsLinear)).toFixed(2)) : -100;
  const dcOffset = totalFrames > 0 ? Number((sumSamples / totalFrames).toFixed(6)) : 0;
  const estimatedFreqHz =
    durationMs > 0 ? Math.round((zeroCrossings / 2 / (durationMs / 1000))) : 0;

  // Frame-level Voice Activity Detection (VAD)
  const frameDurationMs = options.frameDurationMs || 20;
  const vadThresholdDbFs = options.vadThresholdDbFs ?? -40;
  const samplesPerVadFrame = Math.max(1, Math.floor((sampleRate * frameDurationMs) / 1000));
  const activeSegments = [];
  let currentSegment = null;

  for (let startSample = 0; startSample < totalFrames; startSample += samplesPerVadFrame) {
    const endSample = Math.min(totalFrames, startSample + samplesPerVadFrame);
    let frameSumSq = 0;
    for (let s = startSample; s < endSample; s++) {
      frameSumSq += monoSamples[s] * monoSamples[s];
    }
    const frameRms = Math.sqrt(frameSumSq / (endSample - startSample));
    const frameDb = frameRms > 1e-9 ? 20 * Math.log10(frameRms) : -100;
    const isActive = frameDb >= vadThresholdDbFs;

    const frameStartMs = Math.round((startSample / sampleRate) * 1000);
    const frameEndMs = Math.round((endSample / sampleRate) * 1000);

    if (isActive) {
      if (!currentSegment) {
        currentSegment = { startMs: frameStartMs, endMs: frameEndMs };
      } else {
        currentSegment.endMs = frameEndMs;
      }
    } else if (currentSegment) {
      activeSegments.push(currentSegment);
      currentSegment = null;
    }
  }
  if (currentSegment) {
    activeSegments.push(currentSegment);
  }

  return {
    valid: true,
    errors: [],
    header: {
      audioFormat,
      channels,
      sampleRate,
      byteRate,
      blockAlign,
      bitsPerSample,
      dataBytes: declaredDataBytes,
      durationMs
    },
    acoustics: {
      rmsDbFs,
      peakNormalized: Number(peakAbs.toFixed(4)),
      dcOffset,
      clippedSamples,
      isSilent: rmsDbFs < vadThresholdDbFs,
      estimatedDominantFrequencyHz: estimatedFreqHz,
      voiceActivitySegments: activeSegments
    }
  };
}

module.exports = {
  synthesizeWavPcmBuffer,
  analyzeAndVerifyWavPcm
};
