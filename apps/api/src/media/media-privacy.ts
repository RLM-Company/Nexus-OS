import type { MediaService } from "./media-service.js";

/** Plug into the canonical owner-scoped privacy coordinator; never mutate accounting. */
export function createMediaPrivacyAdapter(service: MediaService) {
  return {
    name: "media",
    required: true,
    quiesce: (ownerId: string) => service.quiesce(ownerId),
    export: (ownerId: string) => service.exportOwner(ownerId),
    delete: (ownerId: string) => service.deleteOwner(ownerId),
    resume: (ownerId: string) => service.resume(ownerId)
  };
}
