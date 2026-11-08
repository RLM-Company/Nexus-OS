import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { isValidChatAttachments, type ChatAttachment } from "@cosmora/contracts";
import { createArchive } from "../account-settings/privacy/archive.js";
import { DriveStorageError } from "./google-drive.js";

export const SNAPSHOT_MAX_BYTES = 32 * 1024 * 1024;
export const SNAPSHOT_CHUNK_BYTES = 2 * 1024 * 1024;
export const snapshotHash = (b: Uint8Array | string) =>
  createHash("sha256").update(b).digest("hex");
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
export type SnapshotSelection = {
  chat_ids?: string[];
  file_ids?: string[];
  include_results: boolean;
};

/** Metadata-only, owner-bound local Work results. Published Kosmora artifacts
 * carry a stored checksum/version. Completed legacy Work files carry the Work
 * version and byte length as their available immutable identity. No Drive list,
 * cloud model context, credentials or unselected file bodies are read here.
 * The legacy no-file_ids include_results=true selection keeps all completed Work
 * results; a request that supplies file_ids is a distinct explicit selection.
 */
const RESULT_METADATA_SQL = `
  SELECT 'kosmora' AS kind, a.id AS source_key, a.name AS name,
         CAST(a.version AS INTEGER) AS version, p.title AS project,
         a.sha256 AS sha256, length(CAST(a.content AS BLOB)) AS bytes
    FROM work_artifact_versions a
    JOIN projects p ON p.id=a.project_id
    JOIN manager_work w ON w.id=a.work_id AND w.project_id=a.project_id
   WHERE p.owner_id=? AND w.owner_id=? AND a.published=1
   UNION ALL
  SELECT 'user' AS kind,
         f.execution_id || char(31) || f.name || char(31) || coalesce(CAST(w.version AS TEXT),'') AS source_key,
         f.name AS name, CAST(coalesce(w.version,1) AS INTEGER) AS version,
         p.title AS project, NULL AS sha256,
         length(CAST(f.content AS BLOB)) AS bytes
    FROM manager_work_files f
    JOIN manager_work w ON w.id=f.execution_id
    JOIN projects p ON p.id=w.project_id
   WHERE p.owner_id=? AND w.owner_id=?
     AND json_extract(w.state_json,'$.status')='completed'
     AND NOT EXISTS(SELECT 1 FROM work_artifact_versions a
                    WHERE a.work_id=w.id AND a.name=f.name AND a.published=1)
`;
export type DriveResultSource = {
  id: string;
  kind: "kosmora" | "user";
  name: string;
  content: string | null;
  sha256: string | null;
  version: number;
  project: string;
  bytes: number;
  sourceKey: string;
  fingerprint: string;
};
type ResultSourceRow = {
  kind: unknown;
  source_key: unknown;
  name: unknown;
  version: unknown;
  project: unknown;
  sha256: unknown;
  bytes: unknown;
};
type SourceBase = Omit<DriveResultSource, "id" | "content" | "fingerprint">;
const fingerprintOf = (r: SourceBase) =>
  snapshotHash(
    [r.kind, r.sourceKey, String(r.version), String(r.bytes), r.sha256 ?? ""].join("\0")
  );
const resultSourceId = (r: SourceBase) => `${r.kind}_${fingerprintOf(r).slice(0, 32)}`;

function loadResultMetadata(db: DatabaseSync, owner: string): DriveResultSource[] {
  const rows = db
    .prepare(`${RESULT_METADATA_SQL} ORDER BY name, kind, project, source_key LIMIT 2001`)
    .all(owner, owner, owner, owner) as ResultSourceRow[];
  return rows.map((r) => {
    if (
      (r.kind !== "kosmora" && r.kind !== "user") ||
      typeof r.source_key !== "string" ||
      !r.source_key.length ||
      r.source_key.length > 1024 ||
      typeof r.name !== "string" ||
      !r.name.length ||
      r.name.length > 160 ||
      typeof r.project !== "string" ||
      r.project.length > 200
    )
      throw new DriveStorageError("BACKUP_INVALID");
    const bytes = Number(r.bytes),
      version = Number(r.version);
    if (!Number.isSafeInteger(bytes) || bytes < 0 || !Number.isSafeInteger(version) || version < 1)
      throw new DriveStorageError("BACKUP_INVALID");
    const base: SourceBase = {
      kind: r.kind,
      sourceKey: r.source_key,
      name: r.name,
      version,
      project: r.project,
      bytes,
      sha256: typeof r.sha256 === "string" ? r.sha256 : null
    };
    const fingerprint = fingerprintOf(base);
    return { ...base, id: resultSourceId(base), content: null, fingerprint };
  });
}

type ResultBody = { content: string; sha256: string; bytes: number; version: number };
function readSelectedResultBody(
  db: DatabaseSync,
  owner: string,
  source: DriveResultSource
): ResultBody {
  // Compare the exact owner-bound row, without rescanning every other source.
  const current = source;
  const row = (
    source.kind === "kosmora"
      ? db
          .prepare(
            `SELECT a.content AS content, CAST(a.version AS INTEGER) AS version,
                  a.sha256 AS sha256, length(CAST(a.content AS BLOB)) AS bytes
             FROM work_artifact_versions a
             JOIN projects p ON p.id=a.project_id
             JOIN manager_work w ON w.id=a.work_id AND w.project_id=a.project_id
            WHERE p.owner_id=? AND w.owner_id=? AND a.published=1 AND a.id=? LIMIT 1`
          )
          .get(owner, owner, source.sourceKey)
      : db
          .prepare(
            `SELECT f.content AS content, CAST(coalesce(w.version,1) AS INTEGER) AS version,
                  NULL AS sha256, length(CAST(f.content AS BLOB)) AS bytes
             FROM manager_work_files f
             JOIN manager_work w ON w.id=f.execution_id
             JOIN projects p ON p.id=w.project_id
            WHERE p.owner_id=? AND w.owner_id=?
              AND json_extract(w.state_json,'$.status')='completed'
              AND f.execution_id || char(31) || f.name || char(31) || coalesce(CAST(w.version AS TEXT),'')=?
              AND NOT EXISTS(SELECT 1 FROM work_artifact_versions a
                             WHERE a.work_id=w.id AND a.name=f.name AND a.published=1) LIMIT 1`
          )
          .get(owner, owner, source.sourceKey)
  ) as { content: unknown; version: unknown; sha256: unknown; bytes: unknown } | undefined;
  if (!row) throw new DriveStorageError("DRIVE_OPERATION_CONFLICT");
  const version = Number(row.version),
    bytes = Number(row.bytes);
  if (
    version !== current.version ||
    bytes !== current.bytes ||
    (current.sha256 !== null && row.sha256 !== current.sha256)
  )
    throw new DriveStorageError("DRIVE_OPERATION_CONFLICT");
  const content =
    typeof row.content === "string"
      ? row.content
      : row.content instanceof Uint8Array
        ? Buffer.from(row.content).toString("utf8")
        : null;
  if (content === null || Buffer.byteLength(content, "utf8") !== bytes)
    throw new DriveStorageError("BACKUP_INVALID");
  const computed = snapshotHash(Buffer.from(content, "utf8"));
  let sha256 = typeof row.sha256 === "string" ? row.sha256 : null;
  if (sha256 !== null) {
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new DriveStorageError("BACKUP_INVALID");
  } else {
    sha256 = computed;
  }
  if (sha256 !== computed) throw new DriveStorageError("BACKUP_INVALID");
  return { content, sha256, bytes, version };
}

export function listDriveResultSources(
  db: DatabaseSync,
  owner: string,
  withContent = false
): DriveResultSource[] {
  const sources = loadResultMetadata(db, owner);
  if (sources.length > 2000) throw new DriveStorageError("BACKUP_TOO_LARGE");
  if (!withContent) return sources.map((s) => ({ ...s, content: null }));
  if (sources.reduce((bytes, s) => bytes + s.bytes, 0) > SNAPSHOT_MAX_BYTES)
    throw new DriveStorageError("BACKUP_TOO_LARGE");
  return sources.map((s) => {
    const body = readSelectedResultBody(db, owner, s);
    return { ...s, content: body.content, sha256: body.sha256 };
  });
}

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
    if (
      !selection ||
      typeof selection.include_results !== "boolean" ||
      (selection.chat_ids?.length ?? 0) > 2000 ||
      (selection.file_ids?.length ?? 0) > 2000
    )
      throw new DriveStorageError("BACKUP_INVALID_SELECTION");
    const chatIds = selection.chat_ids ?? [];
    const chatFilter = selection.chat_ids
      ? chatIds.length
        ? ` AND c.id IN (${chatIds.map(() => "?").join(",")})`
        : " AND 0"
      : "";
    const chats = db
      .prepare(
        `SELECT c.id AS id,c.title AS title,c.mode AS mode
           FROM general_chats c
          WHERE c.owner_id=? AND c.mode IN ('kosmora','work')${chatFilter}
          ORDER BY c.created_at,c.rowid LIMIT 2001`
      )
      .all(owner, ...chatIds) as { id: string; title: string; mode: "kosmora" | "work" }[];
    if (chats.length > 2000) throw new DriveStorageError("BACKUP_TOO_LARGE");
    const selectedChats = selection.chat_ids ? new Set(chatIds) : null;
    if (
      selectedChats &&
      (selectedChats.size !== chatIds.length ||
        [...selectedChats].some((x) => !chats.some((c) => c.id === x)))
    )
      throw new DriveStorageError("BACKUP_INVALID_SELECTION");
    const explicitFiles = selection.file_ids ? new Set(selection.file_ids) : null;
    if (
      explicitFiles &&
      (explicitFiles.size !== selection.file_ids!.length ||
        selection.file_ids!.some((v) => !/^(kosmora|user)_[a-f0-9]{32}$/.test(v)))
    )
      throw new DriveStorageError("BACKUP_INVALID_SELECTION");
    const needsFiles = Boolean(explicitFiles) || selection.include_results;
    const sources = needsFiles ? loadResultMetadata(db, owner) : [];
    if (needsFiles && sources.length > 2000) throw new DriveStorageError("BACKUP_TOO_LARGE");
    if (explicitFiles) {
      const found = new Set(sources.filter((s) => explicitFiles.has(s.id)).map((s) => s.id));
      if (found.size !== explicitFiles.size)
        throw new DriveStorageError("DRIVE_OPERATION_CONFLICT");
    }
    const selectedFiles = needsFiles
      ? sources.filter((s) =>
          explicitFiles
            ? explicitFiles.has(s.id) || (selection.include_results && s.kind === "kosmora")
            : selection.include_results
        )
      : [];
    const fileTotal = selectedFiles.reduce((n, s) => n + s.bytes, 0);
    if (selectedFiles.length > 2000 || fileTotal > SNAPSHOT_MAX_BYTES)
      throw new DriveStorageError("BACKUP_TOO_LARGE");
    const totals = db
      .prepare(
        `SELECT coalesce(sum(length(CAST(m.content AS BLOB))+length(CAST(m.attachments_json AS BLOB))),0) AS bytes,
                count(*) AS n
           FROM general_chat_messages m
           JOIN general_chats c ON c.id=m.chat_id AND c.owner_id=m.owner_id
          WHERE c.owner_id=? AND c.mode IN ('kosmora','work')${chatFilter}`
      )
      .get(owner, ...chatIds) as { bytes: number | null; n: number | null } | undefined;
    const chatBytes = Number(totals?.bytes ?? 0),
      messageCount = Number(totals?.n ?? 0);
    if (
      !Number.isSafeInteger(chatBytes) ||
      !Number.isSafeInteger(messageCount) ||
      messageCount > 50000 ||
      chatBytes + fileTotal > SNAPSHOT_MAX_BYTES
    )
      throw new DriveStorageError("BACKUP_TOO_LARGE");
    const out: DriveSnapshot = {
      format: "kosmora-chat-backup",
      version: 1,
      exported_at: new Date().toISOString(),
      chats: [],
      files: []
    };
    let encoded = 256;
    for (const s of selectedFiles) {
      const body = readSelectedResultBody(db, owner, s);
      const file = {
        name: s.name,
        content: body.content,
        sha256: body.sha256,
        version: body.version,
        project: s.project
      };
      encoded += Buffer.byteLength(JSON.stringify(file)) + 1;
      if (encoded > SNAPSHOT_MAX_BYTES) throw new DriveStorageError("BACKUP_TOO_LARGE");
      out.files.push(file);
    }
    for (const chat of chats) {
      const saved = {
        source_id: chat.id,
        title: chat.title,
        mode: chat.mode,
        messages: [] as DriveSnapshot["chats"][number]["messages"]
      };
      encoded += Buffer.byteLength(JSON.stringify(saved)) + 1;
      if (encoded > SNAPSHOT_MAX_BYTES) throw new DriveStorageError("BACKUP_TOO_LARGE");
      const rows = db
        .prepare(
          `SELECT role,content,status,created_at,updated_at,attachments_json
             FROM general_chat_messages
            WHERE chat_id=? AND owner_id=?
            ORDER BY created_at,rowid`
        )
        .all(chat.id, owner);
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
    const bytes = Buffer.from(JSON.stringify(out));
    parseSnapshot(bytes);
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
