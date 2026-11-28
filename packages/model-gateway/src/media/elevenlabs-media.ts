import { MediaProviderError, readBounded, type MediaBinary } from "./openai-media-adapter.js";

export const AUDIO_CREATIVE_ROUTES = {
  sfx: { provider: "elevenlabs", model: "eleven_text_to_sound_v2", minSeconds: 1, maxSeconds: 20 },
  music: { provider: "elevenlabs", model: "music_v1", minSeconds: 3, maxSeconds: 60 }
} as const;
export type CreativeAudioKind = keyof typeof AUDIO_CREATIVE_ROUTES;

export class ElevenLabsMediaAdapter {
  constructor(
    private readonly credential: string,
    private readonly transport: typeof fetch = fetch
  ) {
    if (!credential.trim()) throw Error("MEDIA_CREDENTIAL_UNAVAILABLE");
  }

  async generate(
    kind: CreativeAudioKind,
    prompt: string,
    seconds: number,
    instrumental: boolean,
    signal: AbortSignal
  ): Promise<MediaBinary> {
    const route = AUDIO_CREATIVE_ROUTES[kind];
    const effect = kind === "sfx";
    const endpoint = effect ? "sound-generation" : "music";
    const response = await this.transport(
      `https://api.elevenlabs.io/v1/${endpoint}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "xi-api-key": this.credential },
        redirect: "error",
        credentials: "omit",
        signal,
        body: JSON.stringify(
          effect
            ? { text: prompt, duration_seconds: seconds, model_id: route.model }
            : {
                prompt,
                music_length_ms: seconds * 1000,
                force_instrumental: instrumental,
                model_id: route.model
              }
        )
      }
    );
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new MediaProviderError("PROVIDER_ERROR", "Audio generation rejected", {
        status: response.status
      });
    }
    if (response.headers.get("content-type")?.split(";")[0]?.trim() !== "audio/mpeg") {
      await response.body?.cancel().catch(() => {});
      throw new MediaProviderError("INVALID_ASSET", "Expected MP3 audio", {
        normalizedCode: "invalid_mime"
      });
    }
    const bytes = await readBounded(response, 8 * 1024 * 1024, signal);
    if (!isCreativeMp3(bytes)) throw new MediaProviderError("INVALID_ASSET", "Invalid MP3 audio");
    return { bytes, mime: "audio/mpeg", extension: "mp3" };
  }
}

/** Validate the fixed MPEG-1 Layer III output through its complete sequence of frames. */
export function isCreativeMp3(bytes: Uint8Array): boolean {
  let offset = 0;
  if (bytes[0] === 73 && bytes[1] === 68 && bytes[2] === 51) {
    if (bytes.length < 10 || bytes.subarray(6, 10).some((b) => b >= 128)) return false;
    offset = 10 + bytes.subarray(6, 10).reduce((size, byte) => size * 128 + byte, 0);
    if ((bytes[5]! & 16) !== 0) offset += 10;
  }
  const rates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  let frames = 0;
  while (offset + 4 <= bytes.length) {
    if (
      bytes.length - offset === 128 &&
      bytes[offset] === 84 &&
      bytes[offset + 1] === 65 &&
      bytes[offset + 2] === 71
    ) {
      offset += 128;
      break;
    }
    const header = bytes[offset + 2]!;
    const rate = rates[header >> 4];
    if (bytes[offset] !== 255 || (bytes[offset + 1]! & 254) !== 250 || !rate || (header & 12) !== 0)
      return false;
    offset += Math.floor((144000 * rate) / 44100) + ((header >> 1) & 1);
    frames++;
  }
  return frames >= 2 && offset === bytes.length;
}
