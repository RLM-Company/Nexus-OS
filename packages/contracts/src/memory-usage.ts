import { Type, type Static } from "typebox";

const hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const id = Type.String({ minLength: 1, maxLength: 128 });
export const MemoryUsageSnapshotSchema = Type.Object(
  {
    representation: Type.Union([
      Type.Literal("exact"),
      Type.Literal("unverified"),
      Type.Literal("none")
    ]),
    bundle_sha256: Type.Union([hash, Type.Null()]),
    bundle_bytes: Type.Integer({ minimum: 0, maximum: 100000 }),
    sources_omitted: Type.Integer({ minimum: 0, maximum: 100000 }),
    sources: Type.Array(
      Type.Object(
        {
          reference: Type.String({ minLength: 3, maxLength: 132 }),
          kind: Type.Union([Type.Literal("memory"), Type.Literal("history")]),
          version: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
          text_sha256: hash,
          source_kind: Type.Union([
            Type.Literal("chat_message"),
            Type.Literal("project_message"),
            Type.Null()
          ]),
          source_message_id: Type.Union([id, Type.Null()]),
          source_sha256: Type.Union([hash, Type.Null()]),
          excerpt_only: Type.Boolean()
        },
        { additionalProperties: false }
      ),
      { maxItems: 128 }
    )
  },
  { additionalProperties: false }
);
export type MemoryUsageSnapshot = Static<typeof MemoryUsageSnapshotSchema>;
export interface MemoryUsageRecord {
  id: string;
  run_id: string;
  request_id: string;
  attempt: number;
  channel: "chat" | "manager_work" | "native_work";
  phase: "dispatch_boundary" | "provider_completed";
  created_at: string;
  snapshot: MemoryUsageSnapshot;
}
export interface MemoryUsagePage {
  items: MemoryUsageRecord[];
  next_offset: number | null;
}
