/** Strict UI projection of the active provider route. Never advertise speculative options. */
export const IMAGE_SIZE_FOR_RATIO = {
  "1:1": "1024x1024",
  "3:2": "1536x1024",
  "2:3": "1024x1536"
} as const;

export type ImageRatio = keyof typeof IMAGE_SIZE_FOR_RATIO;
export type ImageQuality = "low" | "medium" | "high" | "auto";
export type ImageFormat = "png" | "jpeg" | "webp";

export type ImageConstraints = {
  sizes: readonly (typeof IMAGE_SIZE_FOR_RATIO)[ImageRatio][];
  aspectRatios: readonly ImageRatio[];
  qualities: readonly ImageQuality[];
  formats: readonly ImageFormat[];
  maxCount: 1;
  maxPromptLength: number;
  supportsReferenceImage: boolean;
};

export type ImageRequestOptions = {
  aspect_ratio: ImageRatio;
  quality: ImageQuality;
  format: ImageFormat;
};

function supported<T extends string>(raw: unknown, allowed: readonly T[]): readonly T[] | null {
  if (
    !Array.isArray(raw) ||
    raw.length === 0 ||
    raw.some((entry: unknown) => typeof entry !== "string" || !allowed.includes(entry as T))
  )
    return null;
  return raw as T[];
}

export function parseImageConstraints(input: unknown): ImageConstraints | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  const sizes = supported(raw.sizes, Object.values(IMAGE_SIZE_FOR_RATIO));
  const aspectRatios = supported(raw.aspectRatios, Object.keys(IMAGE_SIZE_FOR_RATIO) as ImageRatio[]);
  const qualities = supported(raw.qualities, ["low", "medium", "high", "auto"]);
  const formats = supported(raw.formats, ["png", "jpeg", "webp"]);
  if (
    !sizes ||
    !aspectRatios ||
    !qualities ||
    !formats ||
    aspectRatios.some((ratio) => !sizes.includes(IMAGE_SIZE_FOR_RATIO[ratio])) ||
    raw.maxCount !== 1 ||
    typeof raw.maxPromptLength !== "number" ||
    !Number.isSafeInteger(raw.maxPromptLength) ||
    raw.maxPromptLength < 1 ||
    raw.maxPromptLength > 2000 ||
    typeof raw.supportsReferenceImage !== "boolean"
  )
    return null;
  return {
    sizes,
    aspectRatios,
    qualities,
    formats,
    maxCount: 1,
    maxPromptLength: raw.maxPromptLength,
    supportsReferenceImage: raw.supportsReferenceImage
  };
}

export function resolveImageOptions(
  constraints: ImageConstraints | null | undefined,
  preferred: Partial<Record<keyof ImageRequestOptions, string>>
): ImageRequestOptions | null {
  if (!constraints) return null;
  const pick = <T extends string>(values: readonly T[], current: string | undefined, fallback: T): T =>
    values.find((value) => value === current) ??
    values.find((value) => value === fallback) ??
    values[0]!;
  return {
    aspect_ratio: pick(constraints.aspectRatios, preferred.aspect_ratio, "1:1"),
    quality: pick(constraints.qualities, preferred.quality, "low"),
    format: pick(constraints.formats, preferred.format, "png")
  };
}
