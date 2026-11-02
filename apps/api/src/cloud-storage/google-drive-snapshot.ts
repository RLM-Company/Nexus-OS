import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { isValidChatAttachments, type ChatAttachment } from "@cosmora/contracts";
import { createArchive } from "../account-settings/privacy/archive.js";
import { DriveStorageError } from "./google-drive.js";

export const SNAPSHOT_MAX_BYTES = 32 * 1024 * 1024;
export const SNAPSHOT_CHUNK_BYTES = 2 * 1024 * 1024;
export const snapshotHash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const strict = { additionalProperties: false };
const id = Type.String({ minLength: 1, maxLength: 128 });
const date = Type.String({ minLength: 20, maxLength: 35 });
const attachment = Type.Union([
  Type.Object(
    {
      name: Type.String({ minLength: 1, maxLength: 160 }),
      content: Type.String({ maxLength: 8000 }),
      source_type: Type.Optional(Type.Union([Type.Literal("pdf"), Type.Literal("docx")]))
    },
    strict
  ),
  Type.Object(
    {
      kind: Type.Literal("image"),
      name: Type.String({ minLength: 1, maxLength: 160 }),
      media_type: Type.Union([Type.Literal("image/png"), Type.Literal("image/jpeg")]),
      data_base64: Type.String({ maxLength: 1333336 })
    },
    strict
  )
]);
const schema = Type.Object(
  {
    format: Type.Literal("kosmora-chat-backup"),
    version: Type.Literal(1),
    exported_at: date,
    chats: Type.Array(
      Type.Object(
        {
          source_id: id,
          title: Type.String({ minLength: 1, maxLength: 200 }),
          mode: Type.Union([Type.Literal("kosmora"), Type.Literal("work")]),
          messages: Type.Array(
            Type.Object(
              {
                role: Type.Union([Type.Literal("user"), Type.Literal("assistant")]),
                content: Type.String({ maxLength: 2000000 }),
                status: Type.Union([
                  Type.Literal("completed"),
                  Type.Literal("cancelled"),
                  Type.Literal("failed"),
                  Type.Literal("pending"),
                  Type.Literal("streaming")
                ]),
                created_at: date,
                updated_at: date,
                attachments: Type.Array(attachment, { maxItems: 4 })
              },
              strict
            ),
            { maxItems: 50000 }
          )
        },
        strict
      ),
      { maxItems: 2000 }
    ),
    files: Type.Array(
      Type.Object(
        {
          name: Type.String({ minLength: 1, maxLength: 160 }),
          content: Type.String({ maxLength: 2000000 }),
          sha256: Type.String({ pattern: "^[a-f0-9]{64}$" }),
          version: Type.Integer({ minimum: 1 }),
          project: Type.String({ maxLength: 200 })
        },
        strict
      ),
      { maxItems: 2000 }
    )
  },
  strict
);
export type DriveSnapshot = Static<typeof schema>;
export type SnapshotSelection = { chat_ids?: string[]; include_results: boolean };

export function parseSnapshot(bytes: Uint8Array): DriveSnapshot {
  if (!bytes.length || bytes.length > SNAPSHOT_MAX_BYTES)
    throw new DriveStorageError("BACKUP_TOO_LARGE");
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    throw new DriveStorageError("BACKUP_INVALID");
  }
  if (!Value.Check(schema, value) || !Number.isFinite(Date.parse(value.exported_at)))
    throw new DriveStorageError("BACKUP_INVALID");
  const seen = new Set<string>();
  let messages = 0;
  for (const chat of value.chats) {
    if (seen.has(chat.source_id)) throw new DriveStorageError("BACKUP_INVALID");
    seen.add(chat.source_id);
    for (const message of chat.messages) {
      if (
        ++messages > 50000 ||
        !Number.isFinite(Date.parse(message.created_at)) ||
        !Number.isFinite(Date.parse(message.updated_at)) ||
        !isValidChatAttachments(message.attachments)
      )
        throw new DriveStorageError("BACKUP_INVALID");
    }
  }
  for (const file of value.files) {
    if (
      /[\\/]/.test(file.name) ||
      [...file.name].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) ||
      snapshotHash(Buffer.from(file.content, "utf8")) !== file.sha256
    )
      throw new DriveStorageError("BACKUP_INVALID");
  }
  return value;
}
export function snapshotPreview(s: DriveSnapshot) {
  return {
    exported_at: s.exported_at,
    chats: s.chats.length,
    messages: s.chats.reduce((n, c) => n + c.messages.length, 0),
    files: s.files.length,
    unfinished_messages: s.chats
      .flatMap((c) => c.messages)
      .filter((m) => m.status === "pending" || m.status === "streaming").length,
    extracted_documents: s.chats
      .flatMap((c) => c.messages)
      .flatMap((m) => m.attachments)
      .filter((a) => "source_type" in a).length,
    titles: s.chats.slice(0, 30).map((c) => c.title),
    filenames: s.files.slice(0, 30).map((f) => `${f.project} · ${f.name} · v${f.version}`)
  };
}
export function captureSnapshot(
  db: DatabaseSync,
  owner: string,
  selection: SnapshotSelection
): Buffer {
  db.exec("BEGIN IMMEDIATE");
  try {
    if ((selection.chat_ids?.length ?? 0) > 2000) throw new DriveStorageError("BACKUP_TOO_LARGE");
    const filter = selection.chat_ids
      ? selection.chat_ids.length
        ? ` AND id IN (${selection.chat_ids.map(() => "?").join(",")})`
        : " AND 0"
      : "";
    const chats = db
      .prepare(
        "SELECT id,title,mode FROM general_chats WHERE owner_id=? AND mode IN ('kosmora','work')" +
          filter +
          " ORDER BY created_at,rowid LIMIT 2001"
      )
      .all(owner, ...(selection.chat_ids ?? [])) as {
      id: string;
      title: string;
      mode: "kosmora" | "work";
    }[];
    if (chats.length > 2000) throw new DriveStorageError("BACKUP_TOO_LARGE");
    const selected = selection.chat_ids ? new Set(selection.chat_ids) : null;
    if (
      selected &&
      (selected.size !== selection.chat_ids!.length ||
        [...selected].some((x) => !chats.some((c) => c.id === x)))
    )
      throw new DriveStorageError("BACKUP_INVALID_SELECTION");
    let size = 0,
      count = 0,
      encoded = 256;
    const out: DriveSnapshot = {
      format: "kosmora-chat-backup",
      version: 1,
      exported_at: new Date().toISOString(),
      chats: [],
      files: []
    };
    for (const chat of chats.filter((c) => !selected || selected.has(c.id))) {
      const total = db
        .prepare(
          "SELECT coalesce(sum(length(CAST(content AS BLOB))+length(CAST(attachments_json AS BLOB))),0) AS bytes,count(*) AS n FROM general_chat_messages WHERE chat_id=? AND owner_id=?"
        )
        .get(chat.id, owner) as { bytes: number; n: number };
      size += total.bytes;
      count += total.n;
      if (size > SNAPSHOT_MAX_BYTES || count > 50000)
        throw new DriveStorageError("BACKUP_TOO_LARGE");
      const rows = db
        .prepare(
          "SELECT role,content,status,created_at,updated_at,attachments_json FROM general_chat_messages WHERE chat_id=? AND owner_id=? ORDER BY created_at,rowid"
        )
        .all(chat.id, owner);
      const saved = {
        source_id: chat.id,
        title: chat.title,
        mode: chat.mode,
        messages: [] as DriveSnapshot["chats"][number]["messages"]
      };
      encoded += Buffer.byteLength(JSON.stringify(saved)) + 1;
      for (const r of rows) {
        const m = {
          role: r.role,
          content: r.content,
          status: r.status,
          created_at: r.created_at,
          updated_at: r.updated_at,
          attachments: JSON.parse(r.attachments_json as string) as ChatAttachment[]
        } as DriveSnapshot["chats"][number]["messages"][number];
        encoded += Buffer.byteLength(JSON.stringify(m)) + 1;
        if (encoded > SNAPSHOT_MAX_BYTES) throw new DriveStorageError("BACKUP_TOO_LARGE");
        saved.messages.push(m);
      }
      out.chats.push(saved);
    }
    if (selection.include_results) {
      const fileQuery =
        "SELECT a.name,a.content,a.sha256,a.version,p.title AS project FROM work_artifact_versions a JOIN projects p ON p.id=a.project_id JOIN manager_work w ON w.id=a.work_id AND w.project_id=a.project_id WHERE p.owner_id=? AND w.owner_id=? AND a.published=1 UNION ALL SELECT f.name,f.content,NULL AS sha256,1 AS version,p.title AS project FROM manager_work_files f JOIN manager_work w ON w.id=f.execution_id JOIN projects p ON p.id=w.project_id WHERE p.owner_id=? AND w.owner_id=? AND json_extract(w.state_json,'$.status')='completed' AND NOT EXISTS(SELECT 1 FROM work_artifact_versions a WHERE a.work_id=w.id AND a.name=f.name AND a.published=1)";
      const totals = db
        .prepare(
          "SELECT count(*) AS n,coalesce(sum(length(CAST(content AS BLOB))),0) AS bytes FROM (" +
            fileQuery +
            ")"
        )
        .get(owner, owner, owner, owner) as { n: number; bytes: number };
      if (totals.n > 2000 || totals.bytes + size > SNAPSHOT_MAX_BYTES)
        throw new DriveStorageError("BACKUP_TOO_LARGE");
      const rows = db.prepare(fileQuery + " LIMIT 2001").all(owner, owner, owner, owner);
      if (rows.length > 2000) throw new DriveStorageError("BACKUP_TOO_LARGE");
      out.files = rows.map((r) => ({
        ...r,
        sha256: r.sha256 ?? snapshotHash(Buffer.from(r.content as string))
      })) as DriveSnapshot["files"];
      for (const f of out.files) {
        encoded += Buffer.byteLength(JSON.stringify(f)) + 1;
        if (encoded > SNAPSHOT_MAX_BYTES) throw new DriveStorageError("BACKUP_TOO_LARGE");
      }
    }
    const bytes = Buffer.from(JSON.stringify(out));
    parseSnapshot(bytes); // Fail whole capture on malformed/overlarge data; never clip silently.
    if (!out.chats.length && !out.files.length) throw new DriveStorageError("BACKUP_EMPTY");
    db.exec("COMMIT");
    return bytes;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function snapshotPart(payload: Buffer, bundleId: string, index: number): Buffer {
  const count = Math.ceil(payload.length / SNAPSHOT_CHUNK_BYTES);
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= count ||
    payload.length > SNAPSHOT_MAX_BYTES
  )
    throw new DriveStorageError("BACKUP_INVALID");
  const chunk = payload.subarray(index * SNAPSHOT_CHUNK_BYTES, (index + 1) * SNAPSHOT_CHUNK_BYTES);
  const manifest = Buffer.from(
    JSON.stringify({
      format: "kosmora-backup-part-v1",
      bundle: bundleId,
      index,
      count,
      bytes: payload.length,
      sha256: snapshotHash(payload),
      chunk_sha256: snapshotHash(chunk)
    })
  );
  return createArchive(
    [
      { path: "manifest.json", bytes: manifest },
      { path: "snapshot.part", bytes: chunk }
    ],
    4 * 1024 * 1024
  );
}
/** Only our canonical two-entry STORE ZIP is accepted. Rebuilding verifies CRC,
 * central directory and trailer without decompression or filesystem extraction. */
export function readSnapshotPart(
  bytes: Buffer,
  expected: { id: string; bytes: number; sha256: string; count: number },
  index: number
): Buffer {
  try {
    if (bytes.length > 4 * 1024 * 1024) throw Error();
    let offset = 0;
    const entries: { path: string; bytes: Buffer }[] = [];
    for (const path of ["manifest.json", "snapshot.part"]) {
      if (
        offset + 30 > bytes.length ||
        bytes.readUInt32LE(offset) !== 0x04034b50 ||
        bytes.readUInt16LE(offset + 6) !== 0x800 ||
        bytes.readUInt16LE(offset + 8) !== 0 ||
        bytes.readUInt16LE(offset + 28) !== 0
      )
        throw Error();
      const size = bytes.readUInt32LE(offset + 18),
        nameBytes = bytes.readUInt16LE(offset + 26),
        start = offset + 30 + nameBytes;
      if (
        size !== bytes.readUInt32LE(offset + 22) ||
        size > SNAPSHOT_CHUNK_BYTES ||
        start + size > bytes.length ||
        bytes.subarray(offset + 30, start).toString() !== path ||
        (path === "manifest.json" && size > 2048)
      )
        throw Error();
      entries.push({ path, bytes: bytes.subarray(start, start + size) });
      offset = start + size;
    }
    if (!createArchive(entries, 4 * 1024 * 1024).equals(bytes)) throw Error();
    const m = JSON.parse(entries[0]!.bytes.toString()) as Record<string, unknown>,
      chunk = entries[1]!.bytes;
    if (
      Object.keys(m).sort().join() !== "bundle,bytes,chunk_sha256,count,format,index,sha256" ||
      m.format !== "kosmora-backup-part-v1" ||
      m.bundle !== expected.id ||
      m.index !== index ||
      m.count !== expected.count ||
      m.bytes !== expected.bytes ||
      m.sha256 !== expected.sha256 ||
      m.chunk_sha256 !== snapshotHash(chunk)
    )
      throw Error();
    const length = Math.min(SNAPSHOT_CHUNK_BYTES, expected.bytes - index * SNAPSHOT_CHUNK_BYTES);
    if (chunk.length !== length) throw Error();
    return chunk;
  } catch {
    throw new DriveStorageError("BACKUP_INVALID_PART");
  }
}
