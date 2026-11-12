import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { DRIVE_ARCHIVE_MAX_BYTES } from "./google-drive.js";
import {
  DRIVE_BACKUP_SCHEMA_VERSION,
  type DriveBackupManifest,
  type DriveBackupOriginalManifest
} from "./google-drive-archive-builder.js";

const FORBIDDEN_RESTORE_KEYS = new Set([
  "sessions",
  "identity_sessions",
  "step_up_proofs",
  "credentials",
  "owner_credentials",
  "delete_challenges",
  "connections",
  "kosmora_drive_connections",
  "kosmora_drive_archives",
  "policies",
  "point_overrides",
  "autonomy_profiles",
  "confirmations",
  "work_runs",
  "work_dag_runs",
  "code_agent_runs",
  "computer_tasks",
  "permissions",
  "commands"
]);

const crc32 = (bytes: Buffer): number => {
  let crc = 0xffffffff;
  for (const value of bytes) {
    crc ^= value;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
};

export function readStoredZipEntries(zipBytes: Uint8Array): Map<string, Buffer> {
  const buf = Buffer.from(zipBytes);
  if (buf.byteLength < 22 || buf.byteLength > DRIVE_ARCHIVE_MAX_BYTES) {
    throw new Error("DRIVE_RESTORE_INVALID_ZIP");
  }
  // Locate End of Central Directory (0x06054b50) at end of buffer
  const eocdOffset = buf.byteLength - 22;
  if (buf.readUInt32LE(eocdOffset) !== 0x06054b50) {
    throw new Error("DRIVE_RESTORE_INVALID_ZIP");
  }
  const entryCount = buf.readUInt16LE(eocdOffset + 8);
  const centralSize = buf.readUInt32LE(eocdOffset + 12);
  const centralOffset = buf.readUInt32LE(eocdOffset + 16);
  if (centralOffset + centralSize !== eocdOffset || entryCount > 4000) {
    throw new Error("DRIVE_RESTORE_INVALID_ZIP");
  }

  const entries = new Map<string, Buffer>();
  let ptr = centralOffset;

  for (let i = 0; i < entryCount; i += 1) {
    if (ptr + 46 > eocdOffset || buf.readUInt32LE(ptr) !== 0x02014b50) {
      throw new Error("DRIVE_RESTORE_INVALID_ZIP");
    }
    const method = buf.readUInt16LE(ptr + 10);
    if (method !== 0) {
      throw new Error("DRIVE_RESTORE_UNSUPPORTED_COMPRESSION");
    }
    const expectedCrc = buf.readUInt32LE(ptr + 16);
    const compressedSize = buf.readUInt32LE(ptr + 20);
    const uncompressedSize = buf.readUInt32LE(ptr + 24);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localHeaderOffset = buf.readUInt32LE(ptr + 42);

    if (
      compressedSize !== uncompressedSize ||
      nameLen === 0 ||
      nameLen > 200 ||
      ptr + 46 + nameLen + extraLen + commentLen > eocdOffset
    ) {
      throw new Error("DRIVE_RESTORE_INVALID_ZIP");
    }

    const entryPath = buf.subarray(ptr + 46, ptr + 46 + nameLen).toString("utf8");
    if (
      !/^[a-z0-9._/-]+$/i.test(entryPath) ||
      entryPath.startsWith("/") ||
      entryPath.split("/").some((s) => s === ".." || s === "") ||
      entries.has(entryPath)
    ) {
      throw new Error("DRIVE_RESTORE_UNSAFE_PATH");
    }

    if (
      localHeaderOffset + 30 + nameLen + uncompressedSize > centralOffset ||
      buf.readUInt32LE(localHeaderOffset) !== 0x04034b50
    ) {
      throw new Error("DRIVE_RESTORE_INVALID_ZIP");
    }
    const localNameLen = buf.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + uncompressedSize;
    if (dataEnd > centralOffset) {
      throw new Error("DRIVE_RESTORE_INVALID_ZIP");
    }

    const content = Buffer.from(buf.subarray(dataStart, dataEnd));
    if (crc32(content) !== expectedCrc) {
      throw new Error("DRIVE_RESTORE_CRC_MISMATCH");
    }

    entries.set(entryPath, content);
    ptr += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}

export interface ValidatedRestorePackage {
  backupSetId: string;
  ownerId: string;
  generatedAt: string;
  totalParts: number;
  sections: Record<string, Record<string, Record<string, unknown>[]>>;
  originals: {
    manifest: DriveBackupOriginalManifest;
    bytes: Buffer;
  }[];
  excludedCategories: string[];
}

export interface DriveRestorePreview {
  valid: true;
  schemaVersion: number;
  backupSetId: string;
  ownerId: string;
  generatedAt: string;
  totalParts: number;
  counts: {
    projects: number;
    generalChats: number;
    generalMessages: number;
    projectMessages: number;
    documents: number;
    canvasArtifacts: number;
    researchRuns: number;
    originals: number;
  };
  excludedCategories: string[];
}

export interface DriveRestoreResult {
  restored: true;
  backupSetId: string;
  ownerId: string;
  restoredAt: string;
  counts: DriveRestorePreview["counts"];
  idMapping: {
    projects: Record<string, string>;
    generalChats: Record<string, string>;
    documents: Record<string, string>;
    canvasArtifacts: Record<string, string>;
    researchRuns: Record<string, string>;
  };
  restoredOriginals: {
    store: string;
    oldId: string;
    newId: string;
    filename: string;
    sizeBytes: number;
    sha256: string;
  }[];
}

export function validateAndUnpackRestoreParts(
  expectedOwnerId: string,
  partBuffers: readonly Uint8Array[]
): ValidatedRestorePackage {
  if (!Array.isArray(partBuffers) || partBuffers.length === 0) {
    throw new Error("DRIVE_RESTORE_EMPTY_PARTS");
  }

  const parsedParts: {
    manifest: DriveBackupManifest;
    entries: Map<string, Buffer>;
  }[] = [];

  for (const rawPart of partBuffers) {
    const entries = readStoredZipEntries(rawPart);
    const manifestBuf = entries.get("manifest.json");
    if (!manifestBuf) {
      throw new Error("DRIVE_RESTORE_MISSING_MANIFEST");
    }
    let manifest: DriveBackupManifest;
    try {
      manifest = JSON.parse(manifestBuf.toString("utf8")) as DriveBackupManifest;
    } catch {
      throw new Error("DRIVE_RESTORE_INVALID_MANIFEST");
    }
    if (
      manifest.schemaVersion !== DRIVE_BACKUP_SCHEMA_VERSION ||
      typeof manifest.backupSetId !== "string" ||
      !manifest.backupSetId ||
      manifest.ownerId !== expectedOwnerId ||
      !Number.isSafeInteger(manifest.partIndex) ||
      !Number.isSafeInteger(manifest.totalParts) ||
      manifest.partIndex < 1 ||
      manifest.totalParts < 1 ||
      manifest.partIndex > manifest.totalParts
    ) {
      throw new Error("DRIVE_RESTORE_SCHEMA_MISMATCH");
    }
    parsedParts.push({ manifest, entries });
  }

  parsedParts.sort((a, b) => a.manifest.partIndex - b.manifest.partIndex);
  const first = parsedParts[0]!.manifest;
  if (parsedParts.length !== first.totalParts) {
    throw new Error("DRIVE_RESTORE_INCOMPLETE_MULTIPART_SET");
  }

  const mergedSections: Record<string, Record<string, Record<string, unknown>[]>> = {};

  for (let i = 0; i < parsedParts.length; i += 1) {
    const { manifest, entries } = parsedParts[i]!;
    if (
      manifest.partIndex !== i + 1 ||
      manifest.totalParts !== first.totalParts ||
      manifest.backupSetId !== first.backupSetId ||
      manifest.ownerId !== expectedOwnerId
    ) {
      throw new Error("DRIVE_RESTORE_MULTIPART_MISMATCH");
    }

    for (const [entryPath, content] of entries.entries()) {
      if (entryPath.startsWith("records/") && entryPath.endsWith(".json")) {
        let parsedRecords: Record<string, Record<string, Record<string, unknown>[]>>;
        try {
          parsedRecords = JSON.parse(content.toString("utf8")) as Record<
            string,
            Record<string, Record<string, unknown>[]>
          >;
        } catch {
          throw new Error("DRIVE_RESTORE_CORRUPT_RECORDS");
        }
        for (const [secName, cols] of Object.entries(parsedRecords)) {
          if (FORBIDDEN_RESTORE_KEYS.has(secName)) {
            throw new Error(`DRIVE_RESTORE_FORBIDDEN_SECTION:${secName}`);
          }
          if (!mergedSections[secName]) mergedSections[secName] = {};
          for (const [colName, rows] of Object.entries(cols)) {
            if (FORBIDDEN_RESTORE_KEYS.has(colName) || !Array.isArray(rows)) {
              throw new Error(`DRIVE_RESTORE_FORBIDDEN_COLLECTION:${colName}`);
            }
            mergedSections[secName]![colName] = rows;
          }
        }
      }
    }
  }

  // Reassemble and verify all binary originals declared in the manifest
  const verifiedOriginals: { manifest: DriveBackupOriginalManifest; bytes: Buffer }[] = [];
  const declaredOriginals = first.originals ?? [];

  for (const origMeta of declaredOriginals) {
    if (!Array.isArray(origMeta.chunks) || origMeta.chunks.length === 0) {
      throw new Error("DRIVE_RESTORE_MISSING_ORIGINAL_CHUNKS");
    }
    const sortedChunks = [...origMeta.chunks].sort((a, b) => a.chunkIndex - b.chunkIndex);
    const chunkBuffers: Buffer[] = [];
    let totalSize = 0;

    for (let idx = 0; idx < sortedChunks.length; idx += 1) {
      const ch = sortedChunks[idx]!;
      if (ch.chunkIndex !== idx + 1 || ch.partIndex < 1 || ch.partIndex > parsedParts.length) {
        throw new Error("DRIVE_RESTORE_MISSING_ORIGINAL_CHUNKS");
      }
      const partEntries = parsedParts[ch.partIndex - 1]!.entries;
      const chunkBytes = partEntries.get(ch.entryPath);
      if (!chunkBytes || chunkBytes.byteLength !== ch.sizeBytes) {
        throw new Error("DRIVE_RESTORE_MISSING_ORIGINAL_CHUNKS");
      }
      const chunkSha = createHash("sha256").update(chunkBytes).digest("hex");
      if (chunkSha !== ch.sha256.toLowerCase()) {
        throw new Error("DRIVE_RESTORE_ORIGINAL_HASH_MISMATCH");
      }
      chunkBuffers.push(chunkBytes);
      totalSize += chunkBytes.byteLength;
    }

    const fullOriginal = Buffer.concat(chunkBuffers, totalSize);
    const fullSha = createHash("sha256").update(fullOriginal).digest("hex");
    if (
      fullOriginal.byteLength !== origMeta.sizeBytes ||
      fullSha !== origMeta.sha256.toLowerCase()
    ) {
      throw new Error("DRIVE_RESTORE_ORIGINAL_HASH_MISMATCH");
    }
    verifiedOriginals.push({ manifest: origMeta, bytes: fullOriginal });
  }

  return {
    backupSetId: first.backupSetId,
    ownerId: first.ownerId,
    generatedAt: first.generatedAt,
    totalParts: first.totalParts,
    sections: mergedSections,
    originals: verifiedOriginals,
    excludedCategories: first.excludedCategories ?? []
  };
}

function summarizePackageCounts(pkg: ValidatedRestorePackage): DriveRestorePreview["counts"] {
  const core = pkg.sections["account-core"] ?? {};
  const docs = pkg.sections["documents"] ?? {};
  const canvas = pkg.sections["canvas"] ?? {};
  const research = pkg.sections["research"] ?? {};

  return {
    projects: (core.projects ?? []).length,
    generalChats: (core.general_chats ?? []).length,
    generalMessages: (core.general_chat_messages ?? []).length,
    projectMessages: (core.project_messages ?? []).length,
    documents: (docs.files ?? []).length,
    canvasArtifacts: (canvas.artifacts ?? []).length,
    researchRuns: (research.runs ?? research.research_runs ?? []).length,
    originals: pkg.originals.length
  };
}

export function previewDriveRestore(
  expectedOwnerId: string,
  partBuffers: readonly Uint8Array[]
): DriveRestorePreview {
  const pkg = validateAndUnpackRestoreParts(expectedOwnerId, partBuffers);
  return {
    valid: true,
    schemaVersion: DRIVE_BACKUP_SCHEMA_VERSION,
    backupSetId: pkg.backupSetId,
    ownerId: pkg.ownerId,
    generatedAt: pkg.generatedAt,
    totalParts: pkg.totalParts,
    counts: summarizePackageCounts(pkg),
    excludedCategories: pkg.excludedCategories
  };
}

function tableExists(db: DatabaseSync, tableName: string): boolean {
  const row = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
    .get(tableName);
  return Boolean(row);
}

function columnExists(db: DatabaseSync, tableName: string, columnName: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return cols.some((c) => c.name === columnName);
}

export function executeTransactionalDriveRestore(
  db: DatabaseSync,
  ownerId: string,
  partBuffers: readonly Uint8Array[],
  options: {
    now?: () => string;
    onRestoreBinary?: (item: {
      store: string;
      oldId: string;
      newId: string;
      projectId?: string;
      filename: string;
      contentType: string;
      bytes: Buffer;
    }) => void;
  } = {}
): DriveRestoreResult {
  const pkg = validateAndUnpackRestoreParts(ownerId, partBuffers);
  const nowIso = options.now ? options.now() : new Date().toISOString();

  const lifecycle = db
    .prepare("SELECT state FROM kosmora_owner_data_lifecycle WHERE owner_id=?")
    .get(ownerId) as { state: string } | undefined;
  if (lifecycle && lifecycle.state !== "active") {
    throw new Error("OWNER_DATA_FENCED");
  }

  const projectMap: Record<string, string> = {};
  const generalChatMap: Record<string, string> = {};
  const documentMap: Record<string, string> = {};
  const canvasMap: Record<string, string> = {};
  const researchMap: Record<string, string> = {};

  const counts: DriveRestorePreview["counts"] = {
    projects: 0,
    generalChats: 0,
    generalMessages: 0,
    projectMessages: 0,
    documents: 0,
    canvasArtifacts: 0,
    researchRuns: 0,
    originals: 0
  };

  const restoredOriginals: DriveRestoreResult["restoredOriginals"] = [];

  db.exec("BEGIN IMMEDIATE");
  try {
    const core = pkg.sections["account-core"] ?? {};

    // 1. Restore projects into new IDs without touching existing projects
    if (Array.isArray(core.projects) && tableExists(db, "projects")) {
      const insertProject = db.prepare(
        `INSERT INTO projects (id, owner_id, name, description, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      for (const proj of core.projects) {
        const oldId = String(proj.id ?? "");
        if (!oldId) throw new Error("DRIVE_RESTORE_INVALID_ENTITY_ID");
        const newId = randomUUID();
        projectMap[oldId] = newId;
        const baseName = String(proj.name ?? "Проект");
        const restoredName = baseName.endsWith(" (из архива)")
          ? baseName
          : `${baseName} (из архива)`;
        insertProject.run(
          newId,
          ownerId,
          restoredName,
          proj.description ?? null,
          "active",
          String(proj.created_at ?? nowIso),
          nowIso
        );
        counts.projects += 1;
      }
    }

    // 2. Restore general_chats into new IDs
    if (Array.isArray(core.general_chats) && tableExists(db, "general_chats")) {
      const insertChat = db.prepare(
        `INSERT INTO general_chats (id, owner_id, title, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      );
      for (const chat of core.general_chats) {
        const oldId = String(chat.id ?? "");
        if (!oldId) throw new Error("DRIVE_RESTORE_INVALID_ENTITY_ID");
        const newId = randomUUID();
        generalChatMap[oldId] = newId;
        const baseTitle = String(chat.title ?? "Чат");
        const restoredTitle = baseTitle.endsWith(" (из архива)")
          ? baseTitle
          : `${baseTitle} (из архива)`;
        insertChat.run(newId, ownerId, restoredTitle, String(chat.created_at ?? nowIso), nowIso);
        counts.generalChats += 1;
      }
    }

    // 3. Restore general_chat_messages mapped to the new chat IDs
    if (Array.isArray(core.general_chat_messages) && tableExists(db, "general_chat_messages")) {
      const insertMsg = db.prepare(
        `INSERT INTO general_chat_messages (id, chat_id, owner_id, role, content, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      for (const msg of core.general_chat_messages) {
        const oldChatId = String(msg.chat_id ?? "");
        const newChatId = generalChatMap[oldChatId];
        if (!newChatId) {
          throw new Error("DRIVE_RESTORE_ORPHAN_CHAT_MESSAGE");
        }
        insertMsg.run(
          randomUUID(),
          newChatId,
          ownerId,
          String(msg.role ?? "user"),
          String(msg.content ?? ""),
          String(msg.created_at ?? nowIso)
        );
        counts.generalMessages += 1;
      }
    }

    // 4. Restore project_messages mapped to the new project IDs
    if (Array.isArray(core.project_messages) && tableExists(db, "project_messages")) {
      const insertProjMsg = db.prepare(
        `INSERT INTO project_messages (id, project_id, role, content, created_at)
         VALUES (?, ?, ?, ?, ?)`
      );
      for (const msg of core.project_messages) {
        const oldProjId = String(msg.project_id ?? "");
        const newProjId = projectMap[oldProjId];
        if (!newProjId) {
          throw new Error("DRIVE_RESTORE_ORPHAN_PROJECT_MESSAGE");
        }
        insertProjMsg.run(
          randomUUID(),
          newProjId,
          String(msg.role ?? "user"),
          String(msg.content ?? ""),
          String(msg.created_at ?? nowIso)
        );
        counts.projectMessages += 1;
      }
    }

    // 5. Restore documents metadata if table exists
    const docs = pkg.sections["documents"] ?? {};
    if (Array.isArray(docs.files) && tableExists(db, "document_library_files")) {
      const insertDoc = db.prepare(
        `INSERT INTO document_library_files
         (id, project_id, owner_id, name, media_type, bytes, sha256, extracted_text, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const doc of docs.files) {
        const oldId = String(doc.id ?? "");
        if (!oldId) throw new Error("DRIVE_RESTORE_INVALID_ENTITY_ID");
        const oldProjId = String(doc.project_id ?? "");
        const newProjId = projectMap[oldProjId] ?? oldProjId;
        const newId = randomUUID();
        documentMap[oldId] = newId;
        insertDoc.run(
          newId,
          newProjId,
          ownerId,
          String(doc.name ?? "document.txt"),
          String(doc.media_type ?? "text/plain"),
          Number(doc.bytes ?? 0),
          String(doc.sha256 ?? ""),
          String(doc.extracted_text ?? ""),
          String(doc.created_at ?? nowIso)
        );
        counts.documents += 1;
      }
    }

    // 6. Restore canvas artifacts into new IDs if table exists
    const canvas = pkg.sections["canvas"] ?? {};
    if (Array.isArray(canvas.artifacts) && tableExists(db, "canvas_artifacts")) {
      const insertCanvas = db.prepare(
        `INSERT INTO canvas_artifacts
         (id, owner_id, project_id, title, kind, content, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const art of canvas.artifacts) {
        const oldId = String(art.id ?? "");
        if (!oldId) throw new Error("DRIVE_RESTORE_INVALID_ENTITY_ID");
        const newId = randomUUID();
        canvasMap[oldId] = newId;
        const oldProjId = art.project_id ? String(art.project_id) : null;
        const mappedProjId = oldProjId ? (projectMap[oldProjId] ?? null) : null;
        insertCanvas.run(
          newId,
          ownerId,
          mappedProjId,
          String(art.title ?? "Холст (из архива)"),
          String(art.kind ?? "markdown"),
          String(art.content ?? ""),
          String(art.created_at ?? nowIso),
          nowIso
        );
        counts.canvasArtifacts += 1;
      }
    }

    // 7. Restore research runs (and step/source/claim checkpoints if present) into new IDs
    const research = pkg.sections["research"] ?? {};
    const rawRuns = Array.isArray(research.runs)
      ? research.runs
      : Array.isArray(research.research_runs)
        ? research.research_runs
        : null;
    if (rawRuns && tableExists(db, "research_runs")) {
      const hasExtendedCheckpointCols = columnExists(db, "research_runs", "next_index");
      if (!hasExtendedCheckpointCols) {
        const insertResearch = db.prepare(
          `INSERT INTO research_runs
           (id, owner_id, project_id, query, status, report_markdown, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (const run of rawRuns) {
          const oldId = String(run.id ?? "");
          if (!oldId) throw new Error("DRIVE_RESTORE_INVALID_ENTITY_ID");
          const newId = randomUUID();
          researchMap[oldId] = newId;
          const oldProjId = run.project_id ? String(run.project_id) : null;
          const mappedProjId = oldProjId ? (projectMap[oldProjId] ?? null) : null;
          insertResearch.run(
            newId,
            ownerId,
            mappedProjId,
            String(run.query ?? ""),
            "completed",
            run.report_markdown ? String(run.report_markdown) : null,
            String(run.created_at ?? nowIso),
            nowIso
          );
          counts.researchRuns += 1;
        }
      } else {
        const insertExtendedRun = db.prepare(
          `INSERT INTO research_runs (
            id, owner_id, project_id, query, normalized_query, client_request_id,
            status, next_index, checkpoint_json, current_step_index, total_steps,
            max_depth, max_sources, max_runtime_ms, elapsed_ms, depth_reached,
            expected_targets_json, report_markdown, report_json, error_code, error_message,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (const run of rawRuns) {
          const oldId = String(run.id ?? "");
          if (!oldId) throw new Error("DRIVE_RESTORE_INVALID_ENTITY_ID");
          const newId = `res_run_${randomUUID()}`;
          researchMap[oldId] = newId;
          const oldProjId = run.project_id ? String(run.project_id) : null;
          const mappedProjId = oldProjId ? (projectMap[oldProjId] ?? oldProjId) : null;
          const rawStatus = String(run.status ?? "completed");
          const restoredStatus =
            rawStatus === "running" || rawStatus === "queued" ? "paused" : rawStatus;
          const queryText = String(run.query ?? "");
          insertExtendedRun.run(
            newId,
            ownerId,
            mappedProjId,
            queryText,
            String(run.normalized_query ?? queryText.trim().toLowerCase()),
            null,
            restoredStatus,
            Number(run.next_index ?? 0),
            String(run.checkpoint_json ?? "{}"),
            Number(run.current_step_index ?? 0),
            Number(run.total_steps ?? 0),
            Number(run.max_depth ?? 2),
            Number(run.max_sources ?? 6),
            Number(run.max_runtime_ms ?? 15000),
            Number(run.elapsed_ms ?? 0),
            Number(run.depth_reached ?? 0),
            String(run.expected_targets_json ?? "[]"),
            run.report_markdown ? String(run.report_markdown) : null,
            run.report_json ? String(run.report_json) : null,
            run.error_code ? String(run.error_code) : null,
            run.error_message ? String(run.error_message) : null,
            String(run.created_at ?? nowIso),
            nowIso
          );
          counts.researchRuns += 1;
        }

        const rawSteps = Array.isArray(research.steps)
          ? research.steps
          : Array.isArray(research.research_run_steps)
            ? research.research_run_steps
            : [];
        if (rawSteps.length > 0 && tableExists(db, "research_run_steps")) {
          const insertStep = db.prepare(
            `INSERT INTO research_run_steps (
              run_id, step_index, step_key, step_kind, target_url, depth, status, attempts, checkpoint_json, error_code, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          );
          for (const st of rawSteps) {
            const mappedRunId = researchMap[String(st.run_id ?? "")];
            if (!mappedRunId) continue;
            const rawStepStatus = String(st.status ?? "pending");
            const stepStatus = rawStepStatus === "running" ? "pending" : rawStepStatus;
            insertStep.run(
              mappedRunId,
              Number(st.step_index ?? 0),
              String(st.step_key ?? ""),
              String(st.step_kind ?? "read_source"),
              st.target_url ? String(st.target_url) : null,
              Number(st.depth ?? 1),
              stepStatus,
              Number(st.attempts ?? 0),
              String(st.checkpoint_json ?? "{}"),
              st.error_code ? String(st.error_code) : null,
              nowIso
            );
          }
        }

        const rawSources = Array.isArray(research.sources)
          ? research.sources
          : Array.isArray(research.research_sources)
            ? research.research_sources
            : [];
        if (rawSources.length > 0 && tableExists(db, "research_sources")) {
          const insertSource = db.prepare(
            `INSERT INTO research_sources (
              source_id, run_id, owner_id, original_url, canonical_url, title, domain,
              fetched_at, published_at, page_version, previous_page_version, page_changed,
              content_sha256, content_text, extracted_claims_json, depth, http_status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          );
          for (const src of rawSources) {
            const mappedRunId = researchMap[String(src.run_id ?? "")];
            if (!mappedRunId) continue;
            insertSource.run(
              `src_${randomUUID().slice(0, 12)}`,
              mappedRunId,
              ownerId,
              String(src.original_url ?? ""),
              String(src.canonical_url ?? ""),
              String(src.title ?? ""),
              String(src.domain ?? "local.fixture"),
              String(src.fetched_at ?? nowIso),
              src.published_at ? String(src.published_at) : null,
              String(src.page_version ?? ""),
              src.previous_page_version ? String(src.previous_page_version) : null,
              Number(src.page_changed ? 1 : 0),
              String(src.content_sha256 ?? ""),
              String(src.content_text ?? ""),
              String(src.extracted_claims_json ?? "[]"),
              Number(src.depth ?? 1),
              Number(src.http_status ?? 200)
            );
          }
        }

        const rawClaims = Array.isArray(research.claims)
          ? research.claims
          : Array.isArray(research.research_claims)
            ? research.research_claims
            : [];
        if (rawClaims.length > 0 && tableExists(db, "research_claims")) {
          const insertClaim = db.prepare(
            `INSERT INTO research_claims (
              claim_id, run_id, owner_id, subject, criterion, category,
              resolved_value, conflict_summary, unconfirmed_reason, citations_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          );
          for (const clm of rawClaims) {
            const mappedRunId = researchMap[String(clm.run_id ?? "")];
            if (!mappedRunId) continue;
            insertClaim.run(
              `clm_${mappedRunId}_${randomUUID().slice(0, 8)}`,
              mappedRunId,
              ownerId,
              String(clm.subject ?? ""),
              String(clm.criterion ?? ""),
              String(clm.category ?? "unconfirmed"),
              String(clm.resolved_value ?? ""),
              clm.conflict_summary ? String(clm.conflict_summary) : null,
              clm.unconfirmed_reason ? String(clm.unconfirmed_reason) : null,
              String(clm.citations_json ?? "[]"),
              String(clm.created_at ?? nowIso)
            );
          }
        }
      }
    }

    // 8. Materialize verified binary originals with fresh IDs
    for (const orig of pkg.originals) {
      const newId = documentMap[orig.manifest.id] ?? randomUUID();
      if (options.onRestoreBinary) {
        options.onRestoreBinary({
          store: orig.manifest.store,
          oldId: orig.manifest.id,
          newId,
          filename: orig.manifest.filename,
          contentType: orig.manifest.contentType,
          bytes: orig.bytes
        });
      }
      restoredOriginals.push({
        store: orig.manifest.store,
        oldId: orig.manifest.id,
        newId,
        filename: orig.manifest.filename,
        sizeBytes: orig.manifest.sizeBytes,
        sha256: orig.manifest.sha256
      });
      counts.originals += 1;
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return {
    restored: true,
    backupSetId: pkg.backupSetId,
    ownerId,
    restoredAt: nowIso,
    counts,
    idMapping: {
      projects: projectMap,
      generalChats: generalChatMap,
      documents: documentMap,
      canvasArtifacts: canvasMap,
      researchRuns: researchMap
    },
    restoredOriginals
  };
}
