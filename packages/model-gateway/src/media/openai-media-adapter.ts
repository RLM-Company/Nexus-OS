import { isValidChatAttachments, type ChatImageAttachment } from "@cosmora/contracts";
import type {
  MediaAudioMime,
  MediaCapability,
  MediaImageFormat,
  MediaImageMime,
  MediaImageQuality,
  MediaImageSize,
  MediaModel,
  MediaSpeechFormat,
  MediaSpeechMime,
  MediaSpeechVoice
} from "./media-registry.js";

export type NormalizedMediaErrorCode =
  | "invalid_key"
  | "insufficient_funds"
  | "capability_unavailable"
  | "rate_limit"
  | "timeout"
  | "corrupt_response"
  | "invalid_mime"
  | "aborted"
  | "provider_error";

export type MediaProviderErrorCode =
  "ABORTED" | "PROVIDER_ERROR" | "INVALID_ASSET" | NormalizedMediaErrorCode;

/** Strip any credentials, bearer tokens, or query secrets from diagnostics before logging or surfacing. */
export function sanitizeMediaMessage(input: string): string {
  return input
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-(?:proj-)?[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_KEY]")
    .replace(/([?&](?:api_?key|token|key|sig|signature|auth)=)[^&\s]+/gi, "$1[REDACTED]")
    .slice(0, 240);
}

export class MediaProviderError extends Error {
  readonly normalizedCode: NormalizedMediaErrorCode;
  readonly status: number | undefined;

  constructor(
    readonly code: MediaProviderErrorCode,
    message: string,
    options?: {
      normalizedCode?: NormalizedMediaErrorCode;
      status?: number;
    }
  ) {
    super(sanitizeMediaMessage(message));
    this.name = "MediaProviderError";
    this.status = options?.status;
    this.normalizedCode =
      options?.normalizedCode ??
      (code === "ABORTED"
        ? "aborted"
        : code === "INVALID_ASSET"
          ? "corrupt_response"
          : code === "PROVIDER_ERROR"
            ? "provider_error"
            : code);
  }
}

export type MediaCanonicalUsage = {
  source: "provider";
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
};

export type MediaAssetMime = MediaImageMime | MediaSpeechMime;
export type MediaAssetExtension = "png" | "jpg" | "webp" | "gif" | "mp3" | "wav" | "ogg";

export type MediaBinary = {
  bytes: Uint8Array;
  mime: MediaAssetMime;
  extension: MediaAssetExtension;
  usage?: MediaCanonicalUsage;
};

export interface ImageAdapterOptions {
  readonly size?: MediaImageSize;
  readonly quality?: MediaImageQuality;
  readonly format?: MediaImageFormat;
}

export interface SpeechAdapterOptions {
  readonly voice?: MediaSpeechVoice;
  readonly format?: MediaSpeechFormat;
  readonly speed?: number;
}

export interface TranscribeAdapterOptions {
  readonly language?: string | null;
}

export interface TranscribeAdapterResult {
  readonly text: string;
  readonly language?: string | null;
  readonly duration_seconds?: number | null;
  readonly usage?: MediaCanonicalUsage;
}

/** Provider counters only. No price estimates and no inferred counts. */
const providerUsage = (value: unknown): MediaCanonicalUsage | undefined => {
  if (!value || typeof value !== "object") return;
  const u = value as Record<string, unknown>;
  const ok = (n: unknown): n is number =>
    typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
  if (
    ok(u.input_tokens) &&
    ok(u.output_tokens) &&
    ok(u.total_tokens) &&
    u.input_tokens + u.output_tokens === u.total_tokens
  ) {
    return {
      source: "provider",
      input_tokens: u.input_tokens,
      output_tokens: u.output_tokens,
      total_tokens: u.total_tokens
    };
  }
};

const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const MAX_SPEECH_BYTES = 8 * 1024 * 1024;
const OPENAI_ORIGIN = "https://api.openai.com";

export const isPngBytes = (bytes: Uint8Array): boolean =>
  bytes.length > 24 &&
  [137, 80, 78, 71, 13, 10, 26, 10].every((part, index) => bytes[index] === part) &&
  bytes[12] === 73 &&
  bytes[13] === 72 &&
  bytes[14] === 68 &&
  bytes[15] === 82;

export const isJpegBytes = (bytes: Uint8Array): boolean =>
  bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;

export const isWebpBytes = (bytes: Uint8Array): boolean =>
  bytes.length > 12 &&
  bytes[0] === 0x52 &&
  bytes[1] === 0x49 &&
  bytes[2] === 0x46 &&
  bytes[3] === 0x46 &&
  bytes[8] === 0x57 &&
  bytes[9] === 0x45 &&
  bytes[10] === 0x42 &&
  bytes[11] === 0x50;

export const isGifBytes = (bytes: Uint8Array): boolean =>
  bytes.length > 6 &&
  bytes[0] === 0x47 &&
  bytes[1] === 0x49 &&
  bytes[2] === 0x46 &&
  bytes[3] === 0x38 &&
  (bytes[4] === 0x37 || bytes[4] === 0x39) &&
  bytes[5] === 0x61;

export const isMp3Bytes = (bytes: Uint8Array): boolean =>
  bytes.length > 8 &&
  ((bytes[0] === 73 && bytes[1] === 68 && bytes[2] === 51) ||
    (bytes[0] === 255 && ((bytes[1] ?? 0) & 0xe0) === 0xe0));

export const isWavBytes = (bytes: Uint8Array): boolean =>
  bytes.length >= 44 &&
  bytes[0] === 0x52 &&
  bytes[1] === 0x49 &&
  bytes[2] === 0x46 &&
  bytes[3] === 0x46 &&
  bytes[8] === 0x57 &&
  bytes[9] === 0x41 &&
  bytes[10] === 0x56 &&
  bytes[11] === 0x45;

export const isOggBytes = (bytes: Uint8Array): boolean =>
  bytes.length > 4 &&
  bytes[0] === 0x4f &&
  bytes[1] === 0x67 &&
  bytes[2] === 0x67 &&
  bytes[3] === 0x53;

export const isWebmBytes = (bytes: Uint8Array): boolean =>
  bytes.length >= 4 &&
  bytes[0] === 0x1a &&
  bytes[1] === 0x45 &&
  bytes[2] === 0xdf &&
  bytes[3] === 0xa3;

export const isMp4AudioBytes = (bytes: Uint8Array): boolean =>
  bytes.length >= 8 &&
  bytes[4] === 0x66 &&
  bytes[5] === 0x74 &&
  bytes[6] === 0x79 &&
  bytes[7] === 0x70;

export function sniffMediaBinary(
  bytes: Uint8Array
): { mime: MediaAssetMime | "audio/webm" | "audio/mp4"; extension: string } | null {
  if (isPngBytes(bytes)) return { mime: "image/png", extension: "png" };
  if (isJpegBytes(bytes)) return { mime: "image/jpeg", extension: "jpg" };
  if (isWebpBytes(bytes)) return { mime: "image/webp", extension: "webp" };
  if (isGifBytes(bytes)) return { mime: "image/gif", extension: "gif" };
  if (isMp3Bytes(bytes)) return { mime: "audio/mpeg", extension: "mp3" };
  if (isOggBytes(bytes)) return { mime: "audio/ogg", extension: "ogg" };
  if (isWebmBytes(bytes)) return { mime: "audio/webm", extension: "webm" };
  if (isMp4AudioBytes(bytes)) return { mime: "audio/mp4", extension: "mp4" };
  if (isWavBytes(bytes)) return { mime: "audio/wav", extension: "wav" };
  return null;
}

export function verifyAudioRecordingSignature(bytes: Uint8Array, mime: MediaAudioMime): boolean {
  if (!bytes.length) return false;
  switch (mime) {
    case "audio/webm":
      return isWebmBytes(bytes);
    case "audio/wav":
      return isWavBytes(bytes);
    case "audio/mp4":
      return isMp4AudioBytes(bytes);
    case "audio/mpeg":
      return isMp3Bytes(bytes);
    case "audio/ogg":
      return isOggBytes(bytes);
    default:
      return false;
  }
}

/** Walk RIFF chunks so inserted metadata cannot bypass the duration limit. */
export function estimateWavDurationSeconds(bytes: Uint8Array): number | null {
  if (bytes.length < 44 || !isWavBytes(bytes)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) + 8 !== bytes.length) return null;
  let byteRate: number | null = null;
  let dataBytes = 0;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const kind = new TextDecoder().decode(bytes.subarray(offset, offset + 4));
    const size = view.getUint32(offset + 4, true);
    const end = offset + 8 + size;
    if (end > bytes.length) return null;
    if (kind === "fmt ") {
      if (size < 16 || view.getUint16(offset + 8, true) !== 1) return null;
      const channels = view.getUint16(offset + 10, true);
      const rate = view.getUint32(offset + 12, true);
      const align = view.getUint16(offset + 20, true);
      const bits = view.getUint16(offset + 22, true);
      byteRate = view.getUint32(offset + 16, true);
      if (
        !channels ||
        !rate ||
        !bits ||
        align !== (channels * bits) / 8 ||
        byteRate !== rate * align
      )
        return null;
    }
    if (kind === "data") dataBytes += size;
    offset = end + (size % 2);
  }
  return byteRate && dataBytes ? dataBytes / byteRate : null;
}

const isTimeoutSignal = (signal: AbortSignal, error?: unknown): boolean => {
  const reason: unknown = signal.reason;
  if (reason instanceof Error && (reason.name === "TimeoutError" || reason.message === "TIMEOUT")) {
    return true;
  }
  if (typeof reason === "string" && reason.toUpperCase().includes("TIMEOUT")) {
    return true;
  }
  if (error instanceof Error && (error.name === "TimeoutError" || error.message === "TIMEOUT")) {
    return true;
  }
  return false;
};

const readBounded = async (
  response: Response,
  maximum: number,
  signal: AbortSignal
): Promise<Uint8Array> => {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > maximum)
    throw new MediaProviderError("INVALID_ASSET", "Output exceeds media limit", {
      normalizedCode: "corrupt_response"
    });
  if (!response.body)
    throw new MediaProviderError("INVALID_ASSET", "Empty media response", {
      normalizedCode: "corrupt_response"
    });
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  const onAbort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    for (;;) {
      if (signal.aborted) {
        const timedOut = isTimeoutSignal(signal);
        throw new MediaProviderError(
          timedOut ? "timeout" : "ABORTED",
          timedOut ? "Media provider request timed out" : "Cancelled",
          { normalizedCode: timedOut ? "timeout" : "aborted" }
        );
      }
      const { done, value } = await reader.read();
      if (signal.aborted) throw signal.reason;
      if (done) break;
      size += value.length;
      if (size > maximum)
        throw new MediaProviderError("INVALID_ASSET", "Output exceeds media limit", {
          normalizedCode: "corrupt_response"
        });
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof MediaProviderError) throw error;
    if (signal.aborted) {
      const timedOut = isTimeoutSignal(signal, error);
      throw new MediaProviderError(
        timedOut ? "timeout" : "ABORTED",
        timedOut ? "Media provider request timed out" : "Cancelled",
        { normalizedCode: timedOut ? "timeout" : "aborted" }
      );
    }
    throw new MediaProviderError("INVALID_ASSET", "Media stream interrupted or corrupt", {
      normalizedCode: "corrupt_response"
    });
  } finally {
    signal.removeEventListener("abort", onAbort);
    void reader.cancel().catch(() => undefined);
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

async function classifyProviderHttpError(
  response: Response,
  signal: AbortSignal
): Promise<MediaProviderError> {
  const status = response.status;
  let errorCode = "";
  let errorType = "";
  try {
    const text = new TextDecoder().decode(await readBounded(response, 65_536, signal));
    if (text && text.length <= 65_536) {
      const parsed = JSON.parse(text) as {
        error?: { code?: unknown; type?: unknown; message?: unknown };
      } | null;
      errorCode = typeof parsed?.error?.code === "string" ? parsed.error.code.toLowerCase() : "";
      errorType = typeof parsed?.error?.type === "string" ? parsed.error.type.toLowerCase() : "";
    }
  } catch {
    /* Ignore unparseable error body; never echo raw upstream body. */
  }

  if (
    status === 401 ||
    status === 403 ||
    errorCode === "invalid_api_key" ||
    errorType === "authentication_error"
  ) {
    return new MediaProviderError(
      "invalid_key",
      `Media provider authentication failed (${status})`,
      {
        normalizedCode: "invalid_key",
        status
      }
    );
  }
  if (
    status === 402 ||
    errorCode === "insufficient_quota" ||
    errorCode === "billing_hard_limit_reached" ||
    errorType === "insufficient_quota"
  ) {
    return new MediaProviderError(
      "insufficient_funds",
      `Media provider quota or funds insufficient (${status})`,
      { normalizedCode: "insufficient_funds", status }
    );
  }
  if (
    status === 404 ||
    errorCode === "model_not_found" ||
    errorCode === "unsupported_parameter" ||
    errorCode === "invalid_model"
  ) {
    return new MediaProviderError(
      "capability_unavailable",
      `Media provider capability unavailable (${status})`,
      { normalizedCode: "capability_unavailable", status }
    );
  }
  if (status === 429) {
    return new MediaProviderError("rate_limit", `Media provider rate limit (${status})`, {
      normalizedCode: "rate_limit",
      status
    });
  }
  if (status === 408 || status === 504) {
    return new MediaProviderError("timeout", `Media provider timeout (${status})`, {
      normalizedCode: "timeout",
      status
    });
  }
  return new MediaProviderError("PROVIDER_ERROR", `Media provider HTTP ${status}`, {
    normalizedCode: "provider_error",
    status
  });
}

const IMAGE_FORMAT_EXPECTED: Readonly<
  Record<MediaImageFormat, { mime: MediaImageMime; extension: "png" | "jpg" | "webp" }>
> = {
  png: { mime: "image/png", extension: "png" },
  jpeg: { mime: "image/jpeg", extension: "jpg" },
  webp: { mime: "image/webp", extension: "webp" }
};

const SPEECH_FORMAT_EXPECTED: Readonly<
  Record<MediaSpeechFormat, { mime: MediaSpeechMime; extension: "mp3" | "wav" | "ogg" }>
> = {
  mp3: { mime: "audio/mpeg", extension: "mp3" },
  wav: { mime: "audio/wav", extension: "wav" },
  opus: { mime: "audio/ogg", extension: "ogg" }
};

/** Only the two configured provider origins are allowed. URL-only results are never fetched. */
export class OpenAIMediaAdapter {
  private readonly baseUrl: string;
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
    baseUrl = `${OPENAI_ORIGIN}/v1`,
    private readonly requestTimeoutMs = 60_000
  ) {
    if (!apiKey.trim()) throw new Error("Media credential missing");
    const url = new URL(baseUrl);
    const normalized = url.href.replace(/\/$/, "");
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      ![`${OPENAI_ORIGIN}/v1`, "https://ru.cheapvibecode.ru/v1"].includes(normalized)
    )
      throw new Error("Unsupported media provider origin");
    if (
      !Number.isSafeInteger(requestTimeoutMs) ||
      requestTimeoutMs < 1 ||
      requestTimeoutMs > 120_000
    )
      throw new Error("Invalid media deadline");
    this.baseUrl = normalized;
  }

  private async request(
    path: string,
    body: BodyInit,
    contentType: string | null,
    signal: AbortSignal
  ): Promise<Response> {
    const deadline = AbortSignal.timeout(path === "images/edits" ? 120_000 : this.requestTimeoutMs);
    const combined = AbortSignal.any([signal, deadline]);
    try {
      combined.throwIfAborted();
      const response = await this.fetchImpl(`${this.baseUrl}/${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...(contentType ? { "Content-Type": contentType } : {})
        },
        body,
        signal: combined,
        redirect: "error",
        credentials: "omit"
      });
      if (!response.ok) {
        throw await classifyProviderHttpError(response, combined);
      }
      // Buffer within the same deadline, including stalled streams after response headers.
      const maximum =
        path === "audio/speech"
          ? MAX_SPEECH_BYTES
          : path === "audio/transcriptions"
            ? 256 * 1024
            : Math.ceil(MAX_IMAGE_BYTES * 1.4);
      const bytes = await readBounded(response, maximum, combined);
      combined.throwIfAborted();
      return new Response(Uint8Array.from(bytes), {
        status: response.status,
        headers: response.headers
      });
    } catch (error) {
      if (error instanceof MediaProviderError) throw error;
      if (combined.aborted)
        throw new MediaProviderError(
          isTimeoutSignal(combined, error) ? "timeout" : "ABORTED",
          "Media request interrupted"
        );
      throw new MediaProviderError("PROVIDER_ERROR", "Media provider request failed");
    }
  }

  async generateImage(
    prompt: string,
    model: Extract<MediaModel, "gpt-image-1">,
    signal: AbortSignal,
    options: ImageAdapterOptions = {}
  ): Promise<MediaBinary> {
    const size = options.size ?? "1024x1024";
    const quality = options.quality ?? "low";
    const format = options.format ?? "png";
    const response = await this.request(
      "images/generations",
      JSON.stringify({
        model,
        prompt,
        n: 1,
        size,
        quality,
        output_format: format
      }),
      "application/json",
      signal
    );
    return this.decodeImage(response, signal, format);
  }

  async editImage(
    prompt: string,
    references: readonly ChatImageAttachment[],
    model: "gpt-image-1",
    signal: AbortSignal,
    options: ImageAdapterOptions = {}
  ): Promise<MediaBinary> {
    if (!references.length || !isValidChatAttachments(references))
      throw new MediaProviderError("INVALID_ASSET", "Invalid image references");
    const form = new FormData();
    for (const [key, value] of Object.entries({
      model,
      prompt,
      n: "1",
      size: options.size ?? "1024x1024",
      quality: options.quality ?? "low",
      output_format: options.format ?? "png"
    }))
      form.append(key, value);
    for (const reference of references)
      form.append(
        references.length === 1 ? "image" : "image[]",
        new Blob([Uint8Array.from(Buffer.from(reference.data_base64, "base64"))], {
          type: reference.media_type
        }),
        reference.name
      );
    return this.decodeImage(
      await this.request("images/edits", form, null, signal),
      signal,
      options.format
    );
  }

  private async decodeImage(
    response: Response,
    signal: AbortSignal,
    format: MediaImageFormat = "png"
  ): Promise<MediaBinary> {
    const expected = IMAGE_FORMAT_EXPECTED[format];
    const raw = await readBounded(response, MAX_IMAGE_BYTES * 1.4, signal);
    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder().decode(raw)) as unknown;
    } catch {
      throw new MediaProviderError("INVALID_ASSET", "Invalid provider image response", {
        normalizedCode: "corrupt_response"
      });
    }
    const firstItem = (payload as { data?: { b64_json?: unknown; url?: unknown }[] } | null)
      ?.data?.[0];
    const b64 = firstItem?.b64_json;
    // URL-only results are rejected: no dynamic destination receives a request.

    let bytes: Uint8Array;
    if (typeof b64 === "string" && b64.length > 0) {
      if (
        b64.length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(b64)
      ) {
        throw new MediaProviderError("INVALID_ASSET", "Image bytes missing or invalid", {
          normalizedCode: "corrupt_response"
        });
      }
      bytes = Buffer.from(b64, "base64");
    } else {
      throw new MediaProviderError("INVALID_ASSET", "Image bytes missing or invalid", {
        normalizedCode: "corrupt_response"
      });
    }

    if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
      throw new MediaProviderError("INVALID_ASSET", "Image size out of bounds", {
        normalizedCode: "corrupt_response"
      });
    }
    const sniffed = sniffMediaBinary(bytes);
    if (!sniffed || !sniffed.mime.startsWith("image/")) {
      throw new MediaProviderError("INVALID_ASSET", "No valid image signature returned", {
        normalizedCode: "corrupt_response"
      });
    }
    if (sniffed.mime !== expected.mime) {
      throw new MediaProviderError(
        "INVALID_ASSET",
        "Returned image MIME does not match requested format",
        {
          normalizedCode: "invalid_mime"
        }
      );
    }
    const usage = providerUsage((payload as { usage?: unknown } | null)?.usage);
    return {
      bytes,
      mime: expected.mime,
      extension: expected.extension,
      ...(usage ? { usage } : {})
    };
  }

  async transcribeWithUsage(
    bytes: Uint8Array,
    mime: MediaAudioMime,
    model: Extract<MediaModel, "gpt-4o-mini-transcribe">,
    signal: AbortSignal,
    options: TranscribeAdapterOptions = {}
  ): Promise<TranscribeAdapterResult> {
    const extensions: Record<MediaAudioMime, string> = {
      "audio/webm": "webm",
      "audio/wav": "wav",
      "audio/mp4": "mp4",
      "audio/mpeg": "mp3",
      "audio/ogg": "ogg"
    };
    const form = new FormData();
    form.append(
      "file",
      new Blob([Uint8Array.from(bytes)], { type: mime }),
      `recording.${extensions[mime]}`
    );
    form.append("model", model);
    form.append("response_format", "json");
    if (options.language) {
      form.append("language", options.language);
    }
    const response = await this.request("audio/transcriptions", form, null, signal);
    const raw = await readBounded(response, 256 * 1024, signal);
    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder().decode(raw)) as unknown;
    } catch {
      throw new MediaProviderError("INVALID_ASSET", "Invalid transcription response", {
        normalizedCode: "corrupt_response"
      });
    }
    const record = value as {
      text?: unknown;
      language?: unknown;
      duration?: unknown;
      usage?: unknown;
    } | null;
    const text = record?.text;
    if (typeof text !== "string" || text.length > 20_000)
      throw new MediaProviderError("INVALID_ASSET", "Transcription text missing", {
        normalizedCode: "corrupt_response"
      });
    const language =
      typeof record?.language === "string" ? record.language : (options.language ?? null);
    const durationSeconds =
      typeof record?.duration === "number" &&
      Number.isFinite(record.duration) &&
      record.duration >= 0
        ? record.duration
        : null;
    const usage = providerUsage(record?.usage);
    return {
      text,
      language,
      duration_seconds: durationSeconds,
      ...(usage ? { usage } : {})
    };
  }

  async transcribe(
    bytes: Uint8Array,
    mime: MediaAudioMime,
    model: Extract<MediaModel, "gpt-4o-mini-transcribe">,
    signal: AbortSignal,
    options: TranscribeAdapterOptions = {}
  ): Promise<string> {
    return (await this.transcribeWithUsage(bytes, mime, model, signal, options)).text;
  }

  async speak(
    text: string,
    model: Extract<MediaModel, "gpt-4o-mini-tts">,
    signal: AbortSignal,
    options: SpeechAdapterOptions = {}
  ): Promise<MediaBinary> {
    const voice = options.voice ?? "alloy";
    const format = options.format ?? "mp3";
    const speed = options.speed ?? 1.0;
    const expected = SPEECH_FORMAT_EXPECTED[format];
    const response = await this.request(
      "audio/speech",
      JSON.stringify({
        model,
        input: text,
        voice,
        response_format: format,
        ...(speed !== 1.0 ? { speed } : {})
      }),
      "application/json",
      signal
    );
    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (
      contentType &&
      contentType !== "application/octet-stream" &&
      !contentType.startsWith("audio/")
    ) {
      throw new MediaProviderError("INVALID_ASSET", `Unexpected speech MIME ${contentType}`, {
        normalizedCode: "invalid_mime"
      });
    }
    const bytes = await readBounded(response, MAX_SPEECH_BYTES, signal);
    const sniffed = sniffMediaBinary(bytes);
    if (!sniffed || !sniffed.mime.startsWith("audio/")) {
      throw new MediaProviderError("INVALID_ASSET", "No valid audio asset returned", {
        normalizedCode: "corrupt_response"
      });
    }
    if (sniffed.mime !== expected.mime) {
      throw new MediaProviderError(
        "INVALID_ASSET",
        "Speech audio signature does not match requested format",
        {
          normalizedCode: "invalid_mime"
        }
      );
    }
    return { bytes, mime: expected.mime, extension: expected.extension };
  }
}

export const MEDIA_ENDPOINTS: Readonly<Record<MediaCapability, string>> = {
  image_generation: `${OPENAI_ORIGIN}/v1/images/generations`,
  transcription: `${OPENAI_ORIGIN}/v1/audio/transcriptions`,
  speech: `${OPENAI_ORIGIN}/v1/audio/speech`
};
