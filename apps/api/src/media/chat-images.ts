import { setTimeout as delay } from "node:timers/promises";
import type { MediaService } from "./media-service.js";
export class ChatImageError extends Error {
  constructor(
    readonly code:
      | "MEDIA_UNAVAILABLE"
      | "IMAGE_GENERATION_FAILED"
      | "IMAGE_REFERENCES_UNSUPPORTED"
      | "IMAGE_PROMPT_TOO_LONG"
  ) {
    super(code);
  }
}
/** Owner approved one paid image for each explicit creation request on 25 October. */
export function imageCreationPrompt(content: string): string | null {
  const value = content.trim().replace(/^(?:пожалуйста[,!]?\s*|please[,!]?\s*)/i, "");
  const direct = /^(?:(?:нарисуй(?:те)?|изобрази(?:те)?)(?=\s|[,:.!?]|$)|(?:draw|illustrate)\b)/iu;
  const create =
    /^(?:создай(?:те)?|сгенерируй(?:те)?|сделай(?:те)?|generate|create|make)\s+(?:(?:мне|a|an|the)\s+)?(?:картин\S*|изображени\S*|фото\S*|иллюстраци\S*|постер\S*|image\b|picture\b|photo\b|illustration\b|poster\b)/iu;
  return direct.test(value) || create.test(value) ? value : null;
}
export async function generateChatImage(
  service: MediaService,
  owner: string,
  prompt: string,
  signal: AbortSignal
): Promise<string> {
  if (prompt.length > 2000) throw new ChatImageError("IMAGE_PROMPT_TOO_LONG");
  if (!service.capabilities().image_generation.ready) throw new ChatImageError("MEDIA_UNAVAILABLE");
  // Consent is scoped to the explicit user request, never a background suggestion.
  const job = service.enqueue(owner, "image", prompt, true);
  const cancel = () => {
    service.cancel(job.id, owner);
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    for (let attempt = 0; attempt < 500; attempt++) {
      signal.throwIfAborted();
      const current = service.get(job.id, owner);
      if (!current || current.status === "failed" || current.status === "cancelled")
        throw new ChatImageError("IMAGE_GENERATION_FAILED");
      if (current.status === "done" && current.asset?.mime === "image/png") return current.id;
      await delay(150, undefined, { signal });
    }
    cancel();
    throw new ChatImageError("IMAGE_GENERATION_FAILED");
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}
