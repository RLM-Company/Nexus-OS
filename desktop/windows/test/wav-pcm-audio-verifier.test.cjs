"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  synthesizeWavPcmBuffer,
  analyzeAndVerifyWavPcm
} = require("../ci/wav-pcm-audio-verifier.cjs");

test("WAV PCM synthesizer & verifier validates RIFF headers, detects 440Hz tone, and segments Voice Activity bursts", () => {
  // 1. Synthesize 600ms audio with two speech/tone bursts: [100..260ms] and [380..520ms]
  const wavBuf = synthesizeWavPcmBuffer({
    sampleRate: 16000,
    channels: 1,
    durationMs: 600,
    segments: [
      { startMs: 100, endMs: 260, frequencyHz: 440, amplitude: 0.8 },
      { startMs: 380, endMs: 520, frequencyHz: 880, amplitude: 0.6 }
    ]
  });

  const report = analyzeAndVerifyWavPcm(wavBuf, {
    frameDurationMs: 20,
    vadThresholdDbFs: -35
  });

  assert.equal(report.valid, true);
  assert.equal(report.header.sampleRate, 16000);
  assert.equal(report.header.channels, 1);
  assert.equal(report.header.durationMs, 600);
  assert.equal(report.acoustics.isSilent, false);
  assert.equal(report.acoustics.clippedSamples, 0);
  assert.equal(report.acoustics.voiceActivitySegments.length, 2);
  assert.deepEqual(report.acoustics.voiceActivitySegments[0], { startMs: 100, endMs: 260 });
  assert.deepEqual(report.acoustics.voiceActivitySegments[1], { startMs: 380, endMs: 520 });

  // 2. Pure digital silence detection
  const silentBuf = synthesizeWavPcmBuffer({
    sampleRate: 16000,
    channels: 1,
    durationMs: 200,
    frequencyHz: 0,
    amplitude: 0
  });
  const silentReport = analyzeAndVerifyWavPcm(silentBuf);
  assert.equal(silentReport.valid, true);
  assert.equal(silentReport.acoustics.isSilent, true);
  assert.equal(silentReport.acoustics.voiceActivitySegments.length, 0);

  // 3. Corrupted / truncated buffer rejection
  const truncated = wavBuf.subarray(0, 100);
  const badReport = analyzeAndVerifyWavPcm(truncated);
  assert.equal(badReport.valid, false);
  assert.ok(badReport.errors.some((e) => e.includes("TRUNCATED_PCM_DATA")));
});
