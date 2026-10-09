import type { MediaCapability, MediaModel } from "./media-registry.js";

export class MediaProviderError extends Error {
  constructor(
    readonly code: "ABORTED" | "PROVIDER_ERROR" | "INVALID_ASSET",
    message: string
  ) {
    super(message);
    this.name = "MediaProviderError";
  }
}

export type MediaBinary = {
  bytes: Uint8Array;
  mime: "image/png" | "audio/mpeg";
  extension: "png" | "mp3";
};

const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const MAX_SPEECH_BYTES = 8 * 1024 * 1024;
const OPENAI_ORIGIN = "https://api.openai.com";

const readBounded = async (
  response: Response,
  maximum: number,
  signal: AbortSignal
): Promise<Uint8Array> => {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > maximum)
    throw new MediaProviderError("INVALID_ASSET", "Output exceeds media limit");
  if (!response.body) throw new MediaProviderError("INVALID_ASSET", "Empty media response");
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      if (signal.aborted) throw new MediaProviderError("ABORTED", "Cancelled");
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maximum)
        throw new MediaProviderError("INVALID_ASSET", "Output exceeds media limit");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const output = new Uint8Array(size);
  let index = 0;
  for (const chunk of chunks) {
    output.set(chunk, index);
    index += chunk.length;
  }
  return output;
};

const isPng = (bytes: Uint8Array): boolean =>
  bytes.length > 24 &&
  [137, 80, 78, 71, 13, 10, 26, 10].every((part, index) => bytes[index] === part);
const isMp3 = (bytes: Uint8Array): boolean =>
  bytes.length > 8 &&
  ((bytes[0] === 73 && bytes[1] === 68 && bytes[2] === 51) ||
    (bytes[0] === 255 && ((bytes[1] ?? 0) & 0xe0) === 0xe0));

/** Only the pinned official origin is contacted. No arbitrary base URL or redirects. */
export class OpenAIMediaAdapter {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    if (!apiKey.trim()) throw new Error("Media credential missing");
  }

  private async request(
    path: string,
    body: BodyInit,
    contentType: string | null,
    signal: AbortSignal
  ): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${OPENAI_ORIGIN}/v1/${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...(contentType ? { "Content-Type": contentType } : {})
        },
        body,
        signal,
        redirect: "error"
      });
    } catch {
      throw new MediaProviderError(
        signal.aborted ? "ABORTED" : "PROVIDER_ERROR",
        "Media provider request failed"
      );
    }
    // Never expose body, key, request text, or arbitrary provider diagnostic.
    if (!response.ok)
      throw new MediaProviderError("PROVIDER_ERROR", `Media provider HTTP ${response.status}`);
    return response;
  }

  async generateImage(
    prompt: string,
    model: Extract<MediaModel, "gpt-image-1">,
    signal: AbortSignal
  ): Promise<MediaBinary> {
    const response = await this.request(
      "images/generations",
      JSON.stringify({
        model,
        prompt,
        n: 1,
        size: "1024x1024",
        quality: "low",
        output_format: "png"
      }),
      "application/json",
      signal
    );
    const raw = await readBounded(response, MAX_IMAGE_BYTES * 1.4, signal);
    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder().decode(raw)) as unknown;
    } catch {
      throw new MediaProviderError("INVALID_ASSET", "Invalid provider image response");
    }
    const b64 = (payload as { data?: { b64_json?: unknown }[] } | null)?.data?.[0]?.b64_json;
    if (
      typeof b64 !== "string" ||
      b64.length === 0 ||
      b64.length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(b64)
    ) {
      throw new MediaProviderError("INVALID_ASSET", "Image bytes missing or invalid");
    }
    const bytes = Buffer.from(b64, "base64");
    if (bytes.length > MAX_IMAGE_BYTES || !isPng(bytes))
      throw new MediaProviderError("INVALID_ASSET", "No valid PNG asset returned");
    return { bytes, mime: "image/png", extension: "png" };
  }

  async transcribe(
    bytes: Uint8Array,
    mime: "audio/webm" | "audio/wav" | "audio/mp4" | "audio/mpeg",
    model: Extract<MediaModel, "gpt-4o-mini-transcribe">,
    signal: AbortSignal
  ): Promise<string> {
    const extensions = {
      "audio/webm": "webm",
      "audio/wav": "wav",
      "audio/mp4": "mp4",
      "audio/mpeg": "mp3"
    };
    const form = new FormData();
    form.append(
      "file",
      new Blob([Uint8Array.from(bytes)], { type: mime }),
      `recording.${extensions[mime]}`
    );
    form.append("model", model);
    form.append("response_format", "json");
    const response = await this.request("audio/transcriptions", form, null, signal);
    const raw = await readBounded(response, 256 * 1024, signal);
    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder().decode(raw)) as unknown;
    } catch {
      throw new MediaProviderError("INVALID_ASSET", "Invalid transcription response");
    }
    const text = (value as { text?: unknown } | null)?.text;
    if (typeof text !== "string" || text.length > 20_000)
      throw new MediaProviderError("INVALID_ASSET", "Transcription text missing");
    return text;
  }

  async speak(
    text: string,
    model: Extract<MediaModel, "gpt-4o-mini-tts">,
    signal: AbortSignal
  ): Promise<MediaBinary> {
    const response = await this.request(
      "audio/speech",
      JSON.stringify({
        model,
        input: text,
        voice: "alloy",
        response_format: "mp3"
      }),
      "application/json",
      signal
    );
    const bytes = await readBounded(response, MAX_SPEECH_BYTES, signal);
    if (!isMp3(bytes)) throw new MediaProviderError("INVALID_ASSET", "No valid MP3 asset returned");
    return { bytes, mime: "audio/mpeg", extension: "mp3" };
  }
}

export const MEDIA_ENDPOINTS: Readonly<Record<MediaCapability, string>> = {
  image_generation: `${OPENAI_ORIGIN}/v1/images/generations`,
  transcription: `${OPENAI_ORIGIN}/v1/audio/transcriptions`,
  speech: `${OPENAI_ORIGIN}/v1/audio/speech`
};
