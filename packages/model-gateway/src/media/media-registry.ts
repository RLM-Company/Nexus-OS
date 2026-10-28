/** Isolated media capabilities. Never infer media support from a chat model's `vision` flag. */
export type MediaCapability = "image_generation" | "transcription" | "speech";
export type MediaModel = "gpt-image-1" | "gpt-4o-mini-transcribe" | "gpt-4o-mini-tts";

export type MediaImageSize = "1024x1024" | "1536x1024" | "1024x1536";
export type MediaImageAspectRatio = "1:1" | "3:2" | "2:3";
export type MediaImageQuality = "low" | "medium" | "high" | "auto";
export type MediaImageFormat = "png" | "jpeg" | "webp";
export type MediaImageMime = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

export type MediaAudioMime = "audio/webm" | "audio/wav" | "audio/mp4" | "audio/mpeg" | "audio/ogg";

export type MediaSpeechVoice =
  | "alloy"
  | "ash"
  | "ballad"
  | "coral"
  | "echo"
  | "fable"
  | "onyx"
  | "nova"
  | "sage"
  | "shimmer"
  | "verse";
export type MediaSpeechFormat = "mp3" | "wav" | "opus";
export type MediaSpeechMime = "audio/mpeg" | "audio/wav" | "audio/ogg";

export interface MediaImageCapabilityConstraints {
  readonly sizes: readonly MediaImageSize[];
  readonly aspectRatios: readonly MediaImageAspectRatio[];
  readonly qualities: readonly MediaImageQuality[];
  readonly formats: readonly MediaImageFormat[];
  readonly maxCount: number;
  readonly maxPromptLength: number;
  readonly supportsReferenceImage: boolean;
}

export interface MediaTranscriptionCapabilityConstraints {
  readonly mimes: readonly MediaAudioMime[];
  readonly maxBytes: number;
  readonly maxDurationSeconds: number;
  readonly supportsLanguage: boolean;
}

export interface MediaSpeechCapabilityConstraints {
  readonly voices: readonly MediaSpeechVoice[];
  readonly formats: readonly MediaSpeechFormat[];
  readonly minSpeed: number;
  readonly maxSpeed: number;
  readonly maxTextLength: number;
}

export interface MediaRegistryRoute {
  readonly capability: MediaCapability;
  readonly provider: "openai";
  readonly model: MediaModel;
  readonly specification: string;
  readonly imageConstraints?: MediaImageCapabilityConstraints;
  readonly transcriptionConstraints?: MediaTranscriptionCapabilityConstraints;
  readonly speechConstraints?: MediaSpeechCapabilityConstraints;
}

export class MediaCapabilityError extends Error {
  readonly code = "capability_unavailable" as const;
  readonly normalizedCode = "capability_unavailable" as const;
  constructor(
    readonly reason: string,
    message = `Media capability or parameter unavailable: ${reason}`
  ) {
    super(message);
    this.name = "MediaCapabilityError";
  }
}

export const IMAGE_ASPECT_RATIO_TO_SIZE: Readonly<Record<MediaImageAspectRatio, MediaImageSize>> = {
  "1:1": "1024x1024",
  "3:2": "1536x1024",
  "2:3": "1024x1536"
};

export interface ImageGenerationParametersInput {
  readonly size?: string | undefined;
  readonly resolution?: string | undefined;
  readonly aspect_ratio?: string | undefined;
  readonly quality?: string | undefined;
  readonly format?: string | undefined;
  readonly output_format?: string | undefined;
  readonly count?: number | undefined;
  readonly n?: number | undefined;
  readonly reference_image?: unknown;
  readonly reference_image_url?: string | undefined;
  readonly reference_image_base64?: string | undefined;
}

export interface ValidatedImageGenerationParameters {
  readonly size: MediaImageSize;
  readonly aspect_ratio: MediaImageAspectRatio;
  readonly quality: MediaImageQuality;
  readonly format: MediaImageFormat;
  readonly count: 1;
}

export interface SpeechGenerationParametersInput {
  readonly voice?: string | undefined;
  readonly format?: string | undefined;
  readonly response_format?: string | undefined;
  readonly speed?: number | undefined;
}

export interface ValidatedSpeechGenerationParameters {
  readonly voice: MediaSpeechVoice;
  readonly format: MediaSpeechFormat;
  readonly speed: number;
}

export interface TranscriptionParametersInput {
  readonly mime: string;
  readonly language?: string | undefined;
  readonly duration_seconds?: number | undefined;
}

export interface ValidatedTranscriptionParameters {
  readonly mime: MediaAudioMime;
  readonly language: string | null;
  readonly duration_seconds: number | null;
}

const IMAGE_CONSTRAINTS: MediaImageCapabilityConstraints = {
  sizes: ["1024x1024", "1536x1024", "1024x1536"],
  aspectRatios: ["1:1", "3:2", "2:3"],
  qualities: ["low", "medium", "high", "auto"],
  formats: ["png", "jpeg", "webp"],
  maxCount: 1,
  maxPromptLength: 2000,
  supportsReferenceImage: false
};

const TRANSCRIPTION_CONSTRAINTS: MediaTranscriptionCapabilityConstraints = {
  mimes: ["audio/webm", "audio/wav", "audio/mp4", "audio/mpeg", "audio/ogg"],
  maxBytes: 1_500_000,
  maxDurationSeconds: 60,
  supportsLanguage: true
};

const SPEECH_CONSTRAINTS: MediaSpeechCapabilityConstraints = {
  voices: [
    "alloy",
    "ash",
    "ballad",
    "coral",
    "echo",
    "fable",
    "onyx",
    "nova",
    "sage",
    "shimmer",
    "verse"
  ],
  formats: ["mp3", "wav", "opus"],
  minSpeed: 0.25,
  maxSpeed: 4.0,
  maxTextLength: 4096
};

// These are explicit, spec-reviewed routes, NOT discovered availability or live capability proofs.
const routes: readonly MediaRegistryRoute[] = [
  {
    capability: "image_generation",
    provider: "openai",
    model: "gpt-image-1",
    specification: "https://platform.openai.com/docs/api-reference/images/create",
    imageConstraints: IMAGE_CONSTRAINTS
  },
  {
    capability: "transcription",
    provider: "openai",
    model: "gpt-4o-mini-transcribe",
    specification: "https://platform.openai.com/docs/api-reference/audio/createTranscription",
    transcriptionConstraints: TRANSCRIPTION_CONSTRAINTS
  },
  {
    capability: "speech",
    provider: "openai",
    model: "gpt-4o-mini-tts",
    specification: "https://platform.openai.com/docs/api-reference/audio/createSpeech",
    speechConstraints: SPEECH_CONSTRAINTS
  }
] as const;

export function validateImageParameters(
  route: MediaRegistryRoute | null,
  input: ImageGenerationParametersInput = {}
): ValidatedImageGenerationParameters {
  if (!route || route.capability !== "image_generation" || !route.imageConstraints) {
    throw new MediaCapabilityError("IMAGE_ROUTE_UNAVAILABLE");
  }
  const constraints = route.imageConstraints;

  const hasRef =
    (input.reference_image !== undefined && input.reference_image !== null) ||
    (typeof input.reference_image_url === "string" &&
      input.reference_image_url.trim().length > 0) ||
    (typeof input.reference_image_base64 === "string" &&
      input.reference_image_base64.trim().length > 0);
  if (hasRef && !constraints.supportsReferenceImage) {
    throw new MediaCapabilityError("REFERENCE_IMAGE_UNSUPPORTED");
  }

  if (input.count !== undefined && input.n !== undefined && input.count !== input.n) {
    throw new MediaCapabilityError("IMAGE_COUNT_CONFLICT");
  }
  const requestedCount = input.count ?? input.n ?? 1;
  if (
    !Number.isSafeInteger(requestedCount) ||
    requestedCount < 1 ||
    requestedCount > constraints.maxCount
  ) {
    throw new MediaCapabilityError("IMAGE_COUNT_UNSUPPORTED");
  }

  if (
    input.size !== undefined &&
    input.resolution !== undefined &&
    input.size !== input.resolution
  ) {
    throw new MediaCapabilityError("IMAGE_SIZE_CONFLICT");
  }
  const rawSize = input.size ?? input.resolution;
  const rawAspect = input.aspect_ratio;

  let resolvedSize: MediaImageSize = "1024x1024";
  let resolvedAspect: MediaImageAspectRatio = "1:1";

  if (rawAspect !== undefined) {
    if (!(constraints.aspectRatios as readonly string[]).includes(rawAspect)) {
      throw new MediaCapabilityError("IMAGE_ASPECT_RATIO_UNSUPPORTED");
    }
    resolvedAspect = rawAspect as MediaImageAspectRatio;
    resolvedSize = IMAGE_ASPECT_RATIO_TO_SIZE[resolvedAspect];
  }

  if (rawSize !== undefined) {
    if (!(constraints.sizes as readonly string[]).includes(rawSize)) {
      throw new MediaCapabilityError("IMAGE_SIZE_UNSUPPORTED");
    }
    const checkedSize = rawSize as MediaImageSize;
    if (rawAspect !== undefined && checkedSize !== resolvedSize) {
      throw new MediaCapabilityError("IMAGE_ASPECT_RATIO_SIZE_MISMATCH");
    }
    resolvedSize = checkedSize;
    if (rawAspect === undefined) {
      resolvedAspect =
        checkedSize === "1536x1024" ? "3:2" : checkedSize === "1024x1536" ? "2:3" : "1:1";
    }
  }

  const rawQuality = input.quality ?? "low";
  if (!(constraints.qualities as readonly string[]).includes(rawQuality)) {
    throw new MediaCapabilityError("IMAGE_QUALITY_UNSUPPORTED");
  }

  if (
    input.format !== undefined &&
    input.output_format !== undefined &&
    input.format !== input.output_format
  ) {
    throw new MediaCapabilityError("IMAGE_FORMAT_CONFLICT");
  }
  const rawFormat = input.format ?? input.output_format ?? "png";
  const normalizedFormat = rawFormat === "jpg" ? "jpeg" : rawFormat;
  if (!(constraints.formats as readonly string[]).includes(normalizedFormat)) {
    throw new MediaCapabilityError("IMAGE_FORMAT_UNSUPPORTED");
  }

  return {
    size: resolvedSize,
    aspect_ratio: resolvedAspect,
    quality: rawQuality as MediaImageQuality,
    format: normalizedFormat as MediaImageFormat,
    count: 1
  };
}

export function validateSpeechParameters(
  route: MediaRegistryRoute | null,
  input: SpeechGenerationParametersInput = {}
): ValidatedSpeechGenerationParameters {
  if (!route || route.capability !== "speech" || !route.speechConstraints) {
    throw new MediaCapabilityError("SPEECH_ROUTE_UNAVAILABLE");
  }
  const constraints = route.speechConstraints;

  const rawVoice = input.voice ?? "alloy";
  if (!(constraints.voices as readonly string[]).includes(rawVoice)) {
    throw new MediaCapabilityError("SPEECH_VOICE_UNSUPPORTED");
  }

  if (
    input.format !== undefined &&
    input.response_format !== undefined &&
    input.format !== input.response_format
  ) {
    throw new MediaCapabilityError("SPEECH_FORMAT_CONFLICT");
  }
  const rawFormat = input.format ?? input.response_format ?? "mp3";
  if (!(constraints.formats as readonly string[]).includes(rawFormat)) {
    throw new MediaCapabilityError("SPEECH_FORMAT_UNSUPPORTED");
  }

  const rawSpeed = input.speed ?? 1.0;
  if (
    typeof rawSpeed !== "number" ||
    !Number.isFinite(rawSpeed) ||
    rawSpeed < constraints.minSpeed ||
    rawSpeed > constraints.maxSpeed
  ) {
    throw new MediaCapabilityError("SPEECH_SPEED_UNSUPPORTED");
  }

  return {
    voice: rawVoice as MediaSpeechVoice,
    format: rawFormat as MediaSpeechFormat,
    speed: rawSpeed
  };
}

export function validateTranscriptionParameters(
  route: MediaRegistryRoute | null,
  input: TranscriptionParametersInput
): ValidatedTranscriptionParameters {
  if (!route || route.capability !== "transcription" || !route.transcriptionConstraints) {
    throw new MediaCapabilityError("TRANSCRIPTION_ROUTE_UNAVAILABLE");
  }
  const constraints = route.transcriptionConstraints;
  if (!(constraints.mimes as readonly string[]).includes(input.mime)) {
    throw new MediaCapabilityError("TRANSCRIPTION_MIME_UNSUPPORTED");
  }
  let language: string | null = null;
  if (input.language !== undefined && input.language !== null && input.language !== "") {
    if (!constraints.supportsLanguage || !/^[a-z]{2}$/.test(input.language)) {
      throw new MediaCapabilityError("TRANSCRIPTION_LANGUAGE_UNSUPPORTED");
    }
    language = input.language;
  }
  let durationSeconds: number | null = null;
  if (input.duration_seconds !== undefined && input.duration_seconds !== null) {
    if (
      typeof input.duration_seconds !== "number" ||
      !Number.isFinite(input.duration_seconds) ||
      input.duration_seconds <= 0 ||
      input.duration_seconds > constraints.maxDurationSeconds
    ) {
      throw new MediaCapabilityError("TRANSCRIPTION_DURATION_INVALID");
    }
    durationSeconds = input.duration_seconds;
  }
  return {
    mime: input.mime as MediaAudioMime,
    language,
    duration_seconds: durationSeconds
  };
}

export class MediaCapabilityRegistry {
  readonly #routes: readonly MediaRegistryRoute[];

  constructor(
    enabled: readonly MediaCapability[] = ["image_generation", "transcription", "speech"]
  ) {
    this.#routes = routes.filter((route) => enabled.includes(route.capability));
  }

  route(capability: MediaCapability): MediaRegistryRoute | null {
    return this.#routes.find((route) => route.capability === capability) ?? null;
  }

  list(): readonly MediaRegistryRoute[] {
    return this.#routes.map((route) => ({ ...route }));
  }
}
