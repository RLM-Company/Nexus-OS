/** Isolated media capabilities. Never infer media support from a chat model's `vision` flag. */
export type MediaCapability = "image_generation" | "transcription" | "speech";
export type MediaModel = "gpt-image-1" | "gpt-4o-mini-transcribe" | "gpt-4o-mini-tts";

export interface MediaRegistryRoute {
  readonly capability: MediaCapability;
  readonly provider: "openai";
  readonly model: MediaModel;
  readonly specification: string;
}

// These are explicit, spec-reviewed routes, NOT discovered availability or live capability proofs.
const routes: readonly MediaRegistryRoute[] = [
  {
    capability: "image_generation",
    provider: "openai",
    model: "gpt-image-1",
    specification: "https://platform.openai.com/docs/api-reference/images/create"
  },
  {
    capability: "transcription",
    provider: "openai",
    model: "gpt-4o-mini-transcribe",
    specification: "https://platform.openai.com/docs/api-reference/audio/createTranscription"
  },
  {
    capability: "speech",
    provider: "openai",
    model: "gpt-4o-mini-tts",
    specification: "https://platform.openai.com/docs/api-reference/audio/createSpeech"
  }
] as const;

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
