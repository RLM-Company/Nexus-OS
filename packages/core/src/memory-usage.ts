import { createHash } from "node:crypto";
import type { ContextMemoryBundle, MemoryUsageSnapshot, ModelRequest } from "@cosmora/contracts";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const prepared = new WeakMap<ModelRequest, { json: string; snapshot: MemoryUsageSnapshot }>();

/** Tag only trusted builders, never infer memory from JSON supplied by a user. */
export function tagContextMemoryRequest(
  request: ModelRequest,
  bundle: ContextMemoryBundle | undefined
): ModelRequest {
  if (!bundle?.items.length) return request;
  const json = JSON.stringify(bundle);
  prepared.set(request, {
    json,
    snapshot: {
      representation: "exact",
      bundle_sha256: sha(json),
      bundle_bytes: Buffer.byteLength(json, "utf8"),
      sources_omitted: Math.max(0, bundle.items.length - 128),
      sources: bundle.items.slice(0, 128).map((e) => ({
        reference: e.reference,
        kind: e.kind,
        version: e.version ?? null,
        text_sha256: sha(e.text),
        source_kind: e.source?.kind ?? null,
        source_message_id: e.source?.message_id ?? null,
        source_sha256: e.source?.sha256 ?? null,
        excerpt_only: e.excerpt_only
      }))
    }
  });
  return request;
}

/** Receipt for the final main request, after Relay/profile transforms and fitting. */
export function contextMemoryUsage(request: ModelRequest, original = request): MemoryUsageSnapshot {
  const known = prepared.get(original);
  if (!known)
    return {
      representation: "none",
      bundle_sha256: null,
      bundle_bytes: 0,
      sources_omitted: 0,
      sources: []
    };
  if (request.messages.some((m) => m.role === "user" && m.content.includes(known.json)))
    return structuredClone(known.snapshot);
  // Relay may translate the pack. Do not claim its individual original quotes survived.
  return structuredClone({ ...known.snapshot, representation: "unverified" });
}
