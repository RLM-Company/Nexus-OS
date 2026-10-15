/* eslint-disable @typescript-eslint/require-await -- PrivacyAdapter requires Promise results; SQLite snapshots and deletion transactions must execute synchronously within the fenced call. */
import type { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import type {
  PrivacyAdapter,
  PrivacySection,
  OriginalBinary,
  BinaryStream
} from "./coordinator.js";

type Count = { n: number };
type ImageAttachment = {
  kind: "image";
  name: string;
  media_type: "image/png" | "image/jpeg";
  data_base64: string;
};
const isImage = (v: unknown): v is Record<string, unknown> & { kind: "image" } =>
  v !== null && typeof v === "object" && !Array.isArray(v) && "kind" in v && v.kind === "image";
const imageOriginal = (
  v: Record<string, unknown>
): { metadata: ImageAttachment; bytes: Buffer } => {
  const { name, media_type, data_base64 } = v;
  if (
    typeof data_base64 !== "string" ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(data_base64) ||
    data_base64.length > 1333336
  )
    throw new Error("Invalid stored original bytes");
  if (
    typeof name !== "string" ||
    !name ||
    (media_type !== "image/png" && media_type !== "image/jpeg")
  )
    throw new Error("Invalid original metadata");
  const bytes = Buffer.from(data_base64, "base64");
  if (bytes.length > 1_000_000 || bytes.length === 0 || bytes.toString("base64") !== data_base64)
    throw new Error("Corrupt stored original");
  return { metadata: { kind: "image", name, media_type, data_base64 }, bytes };
};
const descriptor = (id: string, v: ImageAttachment, bytes: Buffer): OriginalBinary => ({
  id,
  filename: v.name,
  content_type: v.media_type,
  size_bytes: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex")
});
const sum = (row: unknown) => Number((row as Count).n);
/**
 * Scope-checked adapter for existing B20-B22 settings, ordinary/project chats,
 * historical text, project materials and local GitHub drafts. Other new modules
 * (Work, documents, research, media, Code) MUST register independent adapters.
 * Their tables are never read or deleted here.
 */
export class AccountCorePrivacyAdapter implements PrivacyAdapter {
  readonly id = "account-core";
  constructor(
    private readonly sqlite: DatabaseSync,
    private readonly stopOwnedExecutions: (ownerId: string, epoch: number) => Promise<void>
  ) {}

  async quiesce(ownerId: string, epoch: number): Promise<{ drained: true; fence_epoch: number }> {
    await this.stopOwnedExecutions(ownerId, epoch);
    // Durable queue is cancelled, NEVER restarted during deletion. Only owned rows.
    this.sqlite
      .prepare(
        `UPDATE general_chat_runs SET status='cancelled',updated_at=? WHERE status='queued' AND chat_id IN
      (SELECT id FROM general_chats WHERE owner_id=?)`
      )
      .run(new Date().toISOString(), ownerId);
    this.sqlite
      .prepare(
        `UPDATE runs SET status='cancelled',updated_at=? WHERE lower(status)='queued' AND project_id IN
      (SELECT id FROM projects WHERE owner_id=?)`
      )
      .run(new Date().toISOString(), ownerId);
    const active = sum(
      this.sqlite
        .prepare(
          `SELECT
      (SELECT count(*) FROM general_chat_runs r JOIN general_chats c ON c.id=r.chat_id WHERE c.owner_id=? AND r.status='running')+
      (SELECT count(*) FROM runs r JOIN projects p ON p.id=r.project_id WHERE p.owner_id=? AND lower(r.status)='running') n`
        )
        .get(ownerId, ownerId)
    );
    if (active)
      throw new Error(`Owner has ${active} in-flight executions; abort/drain callback incomplete`);
    return { drained: true, fence_epoch: epoch };
  }

  async export(ownerId: string): Promise<PrivacySection> {
    const select = (query: string) =>
      this.sqlite.prepare(query).all(ownerId) as Record<string, unknown>[];
    const records: Record<string, unknown[]> = {
      preferences: select("SELECT * FROM kosmora_account_preferences WHERE owner_id=?"),
      chat_preferences: select(
        "SELECT p.* FROM kosmora_chat_preferences p JOIN general_chats c ON c.id=p.chat_id AND c.owner_id=p.owner_id WHERE c.owner_id=?"
      ),
      chats: select("SELECT * FROM general_chats WHERE owner_id=?"),
      chat_memory: select(
        "SELECT m.* FROM chat_memory_notes m JOIN general_chats c ON c.id=m.chat_id WHERE c.owner_id=?"
      ),
      chat_folders: select("SELECT * FROM chat_folders WHERE owner_id=?"),
      navigation_legacy_imports: select("SELECT * FROM navigation_legacy_imports WHERE owner_id=?"),
      navigation_pins: select("SELECT * FROM navigation_pins WHERE owner_id=?"),
      chat_folder_assignments: select(
        "SELECT a.* FROM chat_folder_assignments a JOIN general_chats c ON c.id=a.chat_id WHERE c.owner_id=?"
      ),
      chat_context: select(
        "SELECT s.* FROM chat_context_settings s JOIN general_chats c ON c.id=s.chat_id WHERE c.owner_id=?"
      ),
      chat_branches: select(
        "SELECT b.* FROM chat_branches b JOIN general_chats c ON c.id=b.chat_id WHERE c.owner_id=?"
      ),
      messages: select(
        "SELECT m.* FROM general_chat_messages m JOIN general_chats c ON c.id=m.chat_id WHERE c.owner_id=?"
      ),
      runs: select(
        "SELECT r.* FROM general_chat_runs r JOIN general_chats c ON c.id=r.chat_id WHERE c.owner_id=?"
      ),
      projects: select("SELECT * FROM projects WHERE owner_id=?"),
      project_chats: select(
        "SELECT c.* FROM chats c JOIN projects p ON p.id=c.project_id WHERE p.owner_id=?"
      ),
      project_messages: select(
        "SELECT m.* FROM messages m JOIN projects p ON p.id=m.project_id WHERE p.owner_id=?"
      ),
      project_runs: select(
        "SELECT r.* FROM runs r JOIN projects p ON p.id=r.project_id WHERE p.owner_id=?"
      ),
      materials: select(
        "SELECT m.* FROM project_materials m JOIN projects p ON p.id=m.project_id WHERE p.owner_id=?"
      ),
      project_limits: select("SELECT * FROM project_usage_limits WHERE owner_id=?"),
      github_drafts: select(
        "SELECT d.* FROM github_change_drafts d JOIN projects p ON p.id=d.project_id AND p.owner_id=d.owner_id WHERE d.owner_id=?"
      ),
      translation_usage: select("SELECT * FROM kosmora_relay_usage WHERE owner_id=?"),
      token_holds: select("SELECT * FROM kosmora_usage_holds WHERE owner_id=?"),
      retained_accounting: select("SELECT * FROM kosmora_retained_accounting WHERE owner_id=?"),
      chat_usage: select(
        "SELECT u.* FROM general_chat_model_usage u JOIN general_chats c ON c.id=u.chat_id WHERE c.owner_id=?"
      ),
      project_usage: select(
        "SELECT u.* FROM model_usage_ledger u JOIN projects p ON p.id=u.project_id WHERE p.owner_id=?"
      )
    };
    // Legacy messages persist uploaded image bytes as data_base64 inside attachments_json.
    // Emit an authenticated original-binary manifest; do not inline the bytes in JSON.
    // Old PDF/DOCX uploads only stored extracted text; never invent absent originals.
    const originals: OriginalBinary[] = [];
    for (const [kind, collection] of [
      ["g", "messages"],
      ["p", "project_messages"],
      ["m", "materials"]
    ] as const) {
      records[collection] = records[collection]!.map((raw) => {
        const row = raw as Record<string, unknown>;
        const key = kind === "m" ? "project_id" : "id";
        const id = row[key];
        if (typeof id !== "string") throw new Error(`Incomplete ${collection} identifier`);
        const rawJson = row.attachments_json;
        if (typeof rawJson !== "string") throw new Error(`Incomplete ${collection} attachments`);
        const files = JSON.parse(rawJson) as unknown;
        if (!Array.isArray(files)) throw new Error("Corrupt attachment collection");
        const output = files.map((file: unknown, i) => {
          if (!isImage(file)) return file;
          const { metadata, bytes } = imageOriginal(file);
          const originalId = `${kind}:${id}:${i}`;
          originals.push(descriptor(originalId, metadata, bytes));
          const withoutBytes: Record<string, unknown> = { ...file };
          delete withoutBytes.data_base64;
          return { ...withoutBytes, original_id: originalId };
        });
        return { ...row, attachments_json: JSON.stringify(output) };
      });
    }
    return { records, originals, complete: true };
  }

  async readBinary(ownerId: string, opaqueId: string): Promise<BinaryStream | null> {
    const match = /^([gpm]):([a-zA-Z0-9-]{1,128}):([0-3])$/.exec(opaqueId);
    if (!match) return null;
    const [, kind, objectId, indexText] = match;
    if (!kind || !objectId || !indexText) return null;
    const sql =
      kind === "g"
        ? `SELECT m.attachments_json FROM general_chat_messages m JOIN general_chats c ON c.id=m.chat_id WHERE c.owner_id=? AND m.id=?`
        : kind === "p"
          ? `SELECT m.attachments_json FROM messages m JOIN projects p ON p.id=m.project_id WHERE p.owner_id=? AND m.id=?`
          : `SELECT m.attachments_json FROM project_materials m JOIN projects p ON p.id=m.project_id WHERE p.owner_id=? AND m.project_id=?`;
    const row = this.sqlite.prepare(sql).get(ownerId, objectId) as
      { attachments_json: string } | undefined;
    if (!row) return null;
    const attachments = JSON.parse(row.attachments_json) as unknown;
    if (!Array.isArray(attachments)) throw new Error("Corrupt attachments");
    const file: unknown = attachments[Number(indexText)];
    if (!isImage(file)) return null;
    const { metadata, bytes } = imageOriginal(file);
    return { stream: Readable.from([bytes]), original: descriptor(opaqueId, metadata, bytes) };
  }

  async delete(ownerId: string, epoch: number): Promise<{ deleted_records: number }> {
    const row = this.sqlite
      .prepare(
        "SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=? AND epoch=? AND state='deleting'"
      )
      .get(ownerId, epoch);
    if (!row) throw new Error("Owner deletion fence is not active");
    // Canonical and retained accounting, uncertain holds and relay translation costs survive.
    // Data in adjacent stores must already have been deleted by their required adapters.
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const n = (sql: string) => Number(this.sqlite.prepare(sql).run(ownerId).changes);
      let deleted = 0;
      deleted += n("DELETE FROM general_chat_messages WHERE owner_id=?");
      deleted += n(
        "DELETE FROM general_chat_runs WHERE chat_id IN (SELECT id FROM general_chats WHERE owner_id=?)"
      );
      deleted += n("DELETE FROM general_chats WHERE owner_id=?");
      deleted += n(
        "DELETE FROM messages WHERE project_id IN (SELECT id FROM projects WHERE owner_id=?)"
      );
      deleted += n(
        "DELETE FROM runs WHERE project_id IN (SELECT id FROM projects WHERE owner_id=?)"
      );
      // The Work adapter must have removed all artifacts before parent CASCADE.
      const leftover = this.sqlite
        .prepare("SELECT count(*) n FROM manager_work WHERE owner_id=?")
        .get(ownerId) as { n: number };
      if (leftover.n)
        throw new Error("Work artifacts remain: Work adapter did not delete owned executions");
      deleted += n("DELETE FROM github_change_drafts WHERE owner_id=?");
      deleted += n(
        "DELETE FROM project_materials WHERE project_id IN (SELECT id FROM projects WHERE owner_id=?)"
      );
      deleted += n("DELETE FROM project_usage_limits WHERE owner_id=?");
      deleted += n(
        "DELETE FROM chats WHERE project_id IN (SELECT id FROM projects WHERE owner_id=?)"
      );
      // Project-related items cascade only after their specialized adapters delete them.
      deleted += n("DELETE FROM projects WHERE owner_id=?");
      deleted += n("DELETE FROM chat_folders WHERE owner_id=?");
      deleted += n("DELETE FROM navigation_pins WHERE owner_id=?");
      deleted += n("DELETE FROM navigation_legacy_imports WHERE owner_id=?");
      deleted += n("DELETE FROM kosmora_account_preferences WHERE owner_id=?");
      deleted += n("DELETE FROM kosmora_data_delete_challenges WHERE owner_id=?");
      // Keep all canonical usage that migrated to retained accounting BEFORE FK cascades.
      this.sqlite.exec("COMMIT");
      return { deleted_records: deleted };
    } catch (e) {
      this.sqlite.exec("ROLLBACK");
      throw e;
    }
  }
}
