import { setTimeout as delay } from "node:timers/promises";
import type { MediaService } from "./media-service.js";
import type { MediaJob } from "./media-store.js";

export type ChatStudioKind = "video" | "sfx" | "music" | "speech";
export type ChatStudioRunner = (
  ownerId: string,
  runId: string,
  body: string,
  signal: AbortSignal
) => Promise<{ kind: ChatStudioKind; id: string }>;
export class ChatStudioError extends Error {
  constructor(
    readonly code:
      | "STUDIO_COMMAND_INVALID"
      | "STUDIO_UNAVAILABLE"
      | "STUDIO_BUSY"
      | "STUDIO_GENERATION_FAILED"
      | "STUDIO_OUTCOME_UNKNOWN"
  ) {
    super(code);
  }
}

export const isChatStudioCommand = (text: string): boolean =>
  /^\/studio(?=\s|$)/u.test(text.trim());

/** A command is always parsed directly from the persisted owner message. No model emits consent. */
export async function runChatStudio(
  service: MediaService,
  ownerId: string,
  runId: string,
  body: string,
  signal: AbortSignal
): ReturnType<ChatStudioRunner> {
  const parsed = /^\/studio (video|sfx|music|speech)([^\r\n]*?) --paid:\s*([\s\S]+)$/u.exec(
    body.trim()
  );
  const prompt = parsed?.[3]?.trim();
  if (!parsed || !prompt) throw new ChatStudioError("STUDIO_COMMAND_INVALID");
  const [kind, options] = [parsed[1]!, parsed[2]!.trim()] as const;
  const requestId = `chat-studio:${runId}`;
  signal.throwIfAborted();
  let job: MediaJob;
  try {
    if (kind === "video") {
      const match = /^(\d{1,2}) (16:9|9:16)$/u.exec(options);
      if (!match) throw new ChatStudioError("STUDIO_COMMAND_INVALID");
      job = service.enqueueVideo(
        ownerId,
        {
          prompt,
          duration_seconds: Number(match[1]),
          aspect_ratio: match[2] === "16:9" ? "16:9" : "9:16",
          explicit_paid_consent: true
        },
        requestId
      );
    } else if (kind === "music" || kind === "sfx") {
      const match = /^(\d{1,2})(?: (instrumental|vocals))?$/u.exec(options);
      if (!match || (kind === "music") !== Boolean(match[2]))
        throw new ChatStudioError("STUDIO_COMMAND_INVALID");
      job = service.enqueueCreativeAudio(
        ownerId,
        kind,
        prompt,
        Number(match[1]),
        match[2] === "instrumental",
        true,
        requestId
      );
    } else {
      const match = options && /^([a-z_]+) ([0-9]+(?:\.[0-9]+)?) (mp3|wav|opus)$/u.exec(options);
      if (options && !match) throw new ChatStudioError("STUDIO_COMMAND_INVALID");
      job = service.enqueue(ownerId, "speech", prompt, true, {
        client_request_id: requestId,
        ...(match ? { voice: match[1]!, speed: Number(match[2]), format: match[3]! } : {})
      });
    }
  } catch (error) {
    if (error instanceof ChatStudioError) throw error;
    const code = error instanceof Error ? error.message : null;
    if (code === "MEDIA_UNAVAILABLE") throw new ChatStudioError("STUDIO_UNAVAILABLE");
    if (code === "MEDIA_BUSY") throw new ChatStudioError("STUDIO_BUSY");
    if (code === "CREATIVE_OPTIONS_INVALID") throw new ChatStudioError("STUDIO_COMMAND_INVALID");
    throw new ChatStudioError("STUDIO_GENERATION_FAILED");
  }
  const cancel = () => {
    service.cancel(job.id, ownerId);
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted();
      const current = service.get(job.id, ownerId);
      if (current?.status === "done" && current.asset)
        return { kind: kind as ChatStudioKind, id: current.id };
      if (!current || current.status === "failed" || current.status === "cancelled") {
        if (current?.error_code === "timeout" || current?.error_code === "INTERRUPTED")
          throw new ChatStudioError("STUDIO_OUTCOME_UNKNOWN");
        throw new ChatStudioError("STUDIO_GENERATION_FAILED");
      }
      await delay(250, undefined, { signal });
    }
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}
