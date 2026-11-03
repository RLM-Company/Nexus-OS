import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export const MAX_SNAPSHOT_RECORDS = 1000;
export const MAX_SNAPSHOT_SETTINGS = 1000;
export const MAX_SNAPSHOT_JSON_BYTES = 4 * 1024 * 1024; // 4 MiB hard ceiling (no silent truncation)
export const DEFAULT_SLICE_LIMIT = 50;
export const MAX_SLICE_LIMIT = 200;

const FORBIDDEN_SECRET_PATTERN =
  /(?:password|passwd|session_?token|access_?token|refresh_?token|grant_ciphertext|private_?key|secret_?key|bearer\s+\S+)/i;

export type MemoryScopeKind = "personal" | "chat" | "project";

export interface VaultMemorySourceRef {
  sourceId: string;
  title: string;
  status: "available" | "missing" | "revoked" | "updated";
  sha256?: string;
}

export interface VaultMemorySnapshotRecord {
  id: string;
  ownerId: string;
  scope: MemoryScopeKind;
  scopeId: string | null;
  recordType: string;
  key: string;
  title: string;
  content: string;
  version: number;
  baseServerVersion?: number | null;
  sha256: string;
  mandatory?: boolean;
  expiresAt: string | null;
  sources: VaultMemorySourceRef[];
  updatedAt: string;
}

export interface VaultMemorySettingEntry {
  key: string;
  scope: MemoryScopeKind;
  scopeId: string | null;
  value: boolean | number | string | null;
  version: number;
  updatedAt: string;
}

export interface VaultMemorySnapshotEnvelope {
  schemaVersion: 1;
  ownerId: string;
  generatedAt: string;
  records: VaultMemorySnapshotRecord[];
  settings: VaultMemorySettingEntry[];
}

export interface AddressableSnapshotSliceQuery {
  scope?: MemoryScopeKind;
  scopeId?: string | null;
  recordType?: string;
  query?: string;
  cursor?: number;
  limit?: number;
}

export interface AddressableSnapshotSliceResult {
  snapshotDigest: string;
  ownerId: string;
  generatedAt: string;
  cursor: number;
  limit: number;
  nextCursor: number | null;
  totalRecordsInSnapshot: number;
  totalMatching: number;
  truncatedSilently: false;
  items: VaultMemorySnapshotRecord[];
  settingsSlice: VaultMemorySettingEntry[];
}

export type ConflictResolutionAction =
  | "keep_server"
  | "replace_with_client"
  | "fork_as_new_record";

export interface ConflictResolutionDecision {
  action: ConflictResolutionAction;
  expectedServerVersion?: number;
}

export interface MemoryRecordDiffItem {
  recordId: string;
  key: string;
  scope: MemoryScopeKind;
  scopeId: string | null;
  status: "unchanged" | "create" | "fast_forward" | "conflict";
  clientVersion: number;
  clientSha256: string;
  serverRecordId: string | null;
  serverVersion: number | null;
  serverSha256: string | null;
  reason?: string;
}

export interface MemorySnapshotRestorePlan {
  snapshotDigest: string;
  ownerId: string;
  canApplyWithoutDecisions: boolean;
  counts: {
    unchanged: number;
    create: number;
    fastForward: number;
    conflict: number;
  };
  items: MemoryRecordDiffItem[];
  conflicts: MemoryRecordDiffItem[];
}

export interface MemorySnapshotRestoreResult {
  restored: true;
  snapshotDigest: string;
  ownerId: string;
  appliedCounts: {
    unchanged: number;
    created: number;
    updated: number;
    forked: number;
    keptServer: number;
    settingsUpdated: number;
  };
  idMapping: Record<string, string>;
}

export function computeRecordContentSha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function validateAndParseMemorySnapshot(
  rawInput: string | VaultMemorySnapshotEnvelope,
  expectedOwnerId: string
): { envelope: VaultMemorySnapshotEnvelope; snapshotDigest: string; byteLength: number } {
  const rawJson = typeof rawInput === "string" ? rawInput : JSON.stringify(rawInput);
  const byteLength = Buffer.byteLength(rawJson, "utf8");
  if (byteLength === 0) {
    throw new Error("SNAPSHOT_EMPTY");
  }
  if (byteLength > MAX_SNAPSHOT_JSON_BYTES) {
    throw new Error("SNAPSHOT_BYTE_LIMIT_EXCEEDED");
  }

  let parsed: VaultMemorySnapshotEnvelope;
  try {
    parsed = (typeof rawInput === "string" ? JSON.parse(rawJson) : rawInput) as VaultMemorySnapshotEnvelope;
  } catch {
    throw new Error("SNAPSHOT_INVALID_JSON");
  }

  if (
    !parsed ||
    parsed.schemaVersion !== 1 ||
    typeof parsed.ownerId !== "string" ||
    parsed.ownerId !== expectedOwnerId ||
    !Array.isArray(parsed.records) ||
    !Array.isArray(parsed.settings)
  ) {
    throw new Error("SNAPSHOT_SCHEMA_MISMATCH");
  }

  if (parsed.records.length > MAX_SNAPSHOT_RECORDS) {
    throw new Error("SNAPSHOT_RECORD_LIMIT_EXCEEDED");
  }
  if (parsed.settings.length > MAX_SNAPSHOT_SETTINGS) {
    throw new Error("SNAPSHOT_SETTINGS_LIMIT_EXCEEDED");
  }

  const seenIds = new Set<string>();
  for (const rec of parsed.records) {
    if (
      !rec ||
      typeof rec.id !== "string" ||
      !rec.id.trim() ||
      rec.ownerId !== expectedOwnerId ||
      !["personal", "chat", "project"].includes(rec.scope) ||
      typeof rec.key !== "string" ||
      !rec.key.trim() ||
      typeof rec.content !== "string" ||
      !Number.isSafeInteger(rec.version) ||
      rec.version < 1
    ) {
      throw new Error("SNAPSHOT_INVALID_RECORD");
    }
    if (FORBIDDEN_SECRET_PATTERN.test(rec.key) || FORBIDDEN_SECRET_PATTERN.test(rec.content)) {
      throw new Error("SNAPSHOT_SECRET_REJECTED");
    }
    const actualSha = computeRecordContentSha256(rec.content);
    if (typeof rec.sha256 === "string" && rec.sha256.toLowerCase() !== actualSha) {
      throw new Error(`SNAPSHOT_RECORD_HASH_MISMATCH:${rec.id}`);
    }
    if (seenIds.has(rec.id)) {
      throw new Error(`SNAPSHOT_DUPLICATE_RECORD_ID:${rec.id}`);
    }
    seenIds.add(rec.id);
  }

  for (const setting of parsed.settings) {
    if (
      !setting ||
      typeof setting.key !== "string" ||
      !setting.key.trim() ||
      FORBIDDEN_SECRET_PATTERN.test(setting.key) ||
      (typeof setting.value === "string" && FORBIDDEN_SECRET_PATTERN.test(setting.value))
    ) {
      throw new Error("SNAPSHOT_SECRET_REJECTED");
    }
  }

  const snapshotDigest = createHash("sha256").update(rawJson, "utf8").digest("hex");
  return {
    envelope: parsed,
    snapshotDigest,
    byteLength
  };
}

/**
 * Reads an addressable, paginated slice of a validated memory snapshot (up to 1000 records
 * and 4 MiB JSON) without silently truncating or loading the entire snapshot into context.
 */
export function readAddressableSnapshotSlice(
  rawInput: string | VaultMemorySnapshotEnvelope,
  expectedOwnerId: string,
  query: AddressableSnapshotSliceQuery = {}
): AddressableSnapshotSliceResult {
  const { envelope, snapshotDigest } = validateAndParseMemorySnapshot(rawInput, expectedOwnerId);
  const cursor = Number.isSafeInteger(query.cursor) && (query.cursor ?? 0) >= 0 ? query.cursor! : 0;
  const limit = Math.max(
    1,
    Math.min(
      Number.isSafeInteger(query.limit) && (query.limit ?? 0) > 0
        ? query.limit!
        : DEFAULT_SLICE_LIMIT,
      MAX_SLICE_LIMIT
    )
  );
  const needle = typeof query.query === "string" ? query.query.trim().toLowerCase() : "";

  const filtered = envelope.records.filter((rec) => {
    if (query.scope && rec.scope !== query.scope) return false;
    if (query.scopeId !== undefined && rec.scopeId !== query.scopeId) return false;
    if (query.recordType && rec.recordType !== query.recordType) return false;
    if (needle) {
      const hay = `${rec.key}\n${rec.title}\n${rec.content}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });

  const items = filtered.slice(cursor, cursor + limit);
  const nextCursor = cursor + items.length < filtered.length ? cursor + items.length : null;

  const settingsSlice = envelope.settings.filter((s) => {
    if (query.scope && s.scope !== query.scope) return false;
    if (query.scopeId !== undefined && s.scopeId !== query.scopeId) return false;
    return true;
  });

  return {
    snapshotDigest,
    ownerId: expectedOwnerId,
    generatedAt: envelope.generatedAt,
    cursor,
    limit,
    nextCursor,
    totalRecordsInSnapshot: envelope.records.length,
    totalMatching: filtered.length,
    truncatedSilently: false,
    items,
    settingsSlice
  };
}

interface ServerMemoryRow {
  id: string;
  owner_id: string;
  scope: MemoryScopeKind;
  scope_id: string | null;
  record_type: string;
  key: string;
  title: string;
  content: string;
  version: number;
  sha256: string;
  mandatory: number;
  expires_at: string | null;
  sources_json: string;
  updated_at: string;
}

function assertOwnerReadyForMemoryMutation(db: DatabaseSync, ownerId: string): void {
  const lifecycle = db
    .prepare("SELECT state FROM kosmora_owner_data_lifecycle WHERE owner_id=?")
    .get(ownerId) as { state: string } | undefined;
  if (lifecycle && lifecycle.state !== "active") {
    throw new Error("OWNER_DATA_FENCED");
  }

  // Check if any active model/work/computer run is currently in flight for this owner
  const hasActiveTable = db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='general_chat_runs'"
    )
    .get();
  if (hasActiveTable) {
    const activeRun = db
      .prepare(
        "SELECT 1 FROM general_chat_runs WHERE owner_id=? AND status IN ('queued','running') LIMIT 1"
      )
      .get(ownerId);
    if (activeRun) {
      throw new Error("MEMORY_RUN_ACTIVE");
    }
  }
}

export function ensureContextMemoryTables(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS context_memory_records (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      scope TEXT NOT NULL CHECK(scope IN ('personal','chat','project')),
      scope_id TEXT,
      record_type TEXT NOT NULL,
      key TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
      sha256 TEXT NOT NULL,
      mandatory INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT,
      sources_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS context_memory_records_owner_scope
      ON context_memory_records(owner_id, scope, scope_id, key);

    CREATE TABLE IF NOT EXISTS context_memory_settings (
      owner_id TEXT NOT NULL,
      scope TEXT NOT NULL CHECK(scope IN ('personal','chat','project')),
      scope_id TEXT NOT NULL DEFAULT '',
      key TEXT NOT NULL,
      value_json TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
      updated_at TEXT NOT NULL,
      PRIMARY KEY (owner_id, scope, scope_id, key)
    );
  `);
}

export function planMemorySnapshotRestore(
  db: DatabaseSync,
  ownerId: string,
  rawInput: string | VaultMemorySnapshotEnvelope
): MemorySnapshotRestorePlan {
  ensureContextMemoryTables(db);
  const { envelope, snapshotDigest } = validateAndParseMemorySnapshot(rawInput, ownerId);

  const existingRows = db
    .prepare("SELECT * FROM context_memory_records WHERE owner_id=?")
    .all(ownerId) as unknown as ServerMemoryRow[];

  const byId = new Map<string, ServerMemoryRow>();
  const byScopeKey = new Map<string, ServerMemoryRow>();
  for (const row of existingRows) {
    byId.set(row.id, row);
    byScopeKey.set(`${row.scope}:${row.scope_id ?? ""}:${row.key}`, row);
  }

  const items: MemoryRecordDiffItem[] = [];
  const conflicts: MemoryRecordDiffItem[] = [];
  const counts = {
    unchanged: 0,
    create: 0,
    fastForward: 0,
    conflict: 0
  };

  for (const rec of envelope.records) {
    const scopeKey = `${rec.scope}:${rec.scopeId ?? ""}:${rec.key}`;
    const serverById = byId.get(rec.id);
    const serverByKey = byScopeKey.get(scopeKey);
    const serverRow = serverById ?? serverByKey ?? null;

    if (!serverRow) {
      const diff: MemoryRecordDiffItem = {
        recordId: rec.id,
        key: rec.key,
        scope: rec.scope,
        scopeId: rec.scopeId,
        status: "create",
        clientVersion: rec.version,
        clientSha256: rec.sha256.toLowerCase(),
        serverRecordId: null,
        serverVersion: null,
        serverSha256: null
      };
      counts.create += 1;
      items.push(diff);
      continue;
    }

    const clientSha = rec.sha256.toLowerCase();
    const serverSha = serverRow.sha256.toLowerCase();
    const serverVer = Number(serverRow.version);

    if (serverRow.id === rec.id && serverSha === clientSha) {
      counts.unchanged += 1;
      items.push({
        recordId: rec.id,
        key: rec.key,
        scope: rec.scope,
        scopeId: rec.scopeId,
        status: "unchanged",
        clientVersion: rec.version,
        clientSha256: clientSha,
        serverRecordId: serverRow.id,
        serverVersion: serverVer,
        serverSha256: serverSha
      });
      continue;
    }

    // Fast-forward is safe only if same record ID and client explicitly knows the current serverVersion as its baseServerVersion
    if (
      serverRow.id === rec.id &&
      rec.baseServerVersion !== undefined &&
      rec.baseServerVersion !== null &&
      rec.baseServerVersion === serverVer &&
      rec.version > serverVer
    ) {
      counts.fastForward += 1;
      items.push({
        recordId: rec.id,
        key: rec.key,
        scope: rec.scope,
        scopeId: rec.scopeId,
        status: "fast_forward",
        clientVersion: rec.version,
        clientSha256: clientSha,
        serverRecordId: serverRow.id,
        serverVersion: serverVer,
        serverSha256: serverSha
      });
      continue;
    }

    const conflictItem: MemoryRecordDiffItem = {
      recordId: rec.id,
      key: rec.key,
      scope: rec.scope,
      scopeId: rec.scopeId,
      status: "conflict",
      clientVersion: rec.version,
      clientSha256: clientSha,
      serverRecordId: serverRow.id,
      serverVersion: serverVer,
      serverSha256: serverSha,
      reason:
        serverRow.id !== rec.id
          ? "KEY_COLLISION_WITH_DIFFERENT_ID"
          : "SERVER_RECORD_DIVERGED"
    };
    counts.conflict += 1;
    items.push(conflictItem);
    conflicts.push(conflictItem);
  }

  return {
    snapshotDigest,
    ownerId,
    canApplyWithoutDecisions: conflicts.length === 0,
    counts,
    items,
    conflicts
  };
}

export function executeMemorySnapshotRestore(
  db: DatabaseSync,
  ownerId: string,
  rawInput: string | VaultMemorySnapshotEnvelope,
  options: {
    resolutions?: Record<string, ConflictResolutionDecision>;
    now?: () => string;
  } = {}
): MemorySnapshotRestoreResult {
  ensureContextMemoryTables(db);
  assertOwnerReadyForMemoryMutation(db, ownerId);

  const { envelope, snapshotDigest } = validateAndParseMemorySnapshot(rawInput, ownerId);
  const plan = planMemorySnapshotRestore(db, ownerId, envelope);
  const resolutions = options.resolutions ?? {};
  const nowIso = options.now ? options.now() : new Date().toISOString();

  // Verify every conflict has an explicit owner decision before beginning transaction
  for (const conflict of plan.conflicts) {
    const decision = resolutions[conflict.recordId];
    if (!decision || !["keep_server", "replace_with_client", "fork_as_new_record"].includes(decision.action)) {
      throw new Error(`MEMORY_RESTORE_UNRESOLVED_CONFLICT:${conflict.recordId}`);
    }
    if (
      decision.action === "replace_with_client" &&
      decision.expectedServerVersion !== conflict.serverVersion
    ) {
      throw new Error(`MEMORY_VERSION_CONFLICT:${conflict.recordId}`);
    }
  }

  const recordById = new Map<string, VaultMemorySnapshotRecord>();
  for (const r of envelope.records) {
    recordById.set(r.id, r);
  }

  const appliedCounts = {
    unchanged: 0,
    created: 0,
    updated: 0,
    forked: 0,
    keptServer: 0,
    settingsUpdated: 0
  };
  const idMapping: Record<string, string> = {};

  db.exec("BEGIN IMMEDIATE");
  try {
    assertOwnerReadyForMemoryMutation(db, ownerId);

    const insertStmt = db.prepare(`
      INSERT INTO context_memory_records
      (id, owner_id, scope, scope_id, record_type, key, title, content, version, sha256, mandatory, expires_at, sources_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const updateStmt = db.prepare(`
      UPDATE context_memory_records
      SET record_type=?, key=?, title=?, content=?, version=version+1, sha256=?, mandatory=?, expires_at=?, sources_json=?, updated_at=?
      WHERE id=? AND owner_id=? AND version=?
    `);

    for (const diff of plan.items) {
      const rec = recordById.get(diff.recordId)!;
      const sourcesJson = JSON.stringify(rec.sources ?? []);
      const mandatoryInt = rec.mandatory ? 1 : 0;

      if (diff.status === "unchanged") {
        appliedCounts.unchanged += 1;
        idMapping[rec.id] = diff.serverRecordId!;
        continue;
      }

      if (diff.status === "create") {
        insertStmt.run(
          rec.id,
          ownerId,
          rec.scope,
          rec.scopeId,
          rec.recordType,
          rec.key,
          rec.title,
          rec.content,
          rec.version,
          rec.sha256.toLowerCase(),
          mandatoryInt,
          rec.expiresAt,
          sourcesJson,
          nowIso
        );
        appliedCounts.created += 1;
        idMapping[rec.id] = rec.id;
        continue;
      }

      if (diff.status === "fast_forward") {
        const res = updateStmt.run(
          rec.recordType,
          rec.key,
          rec.title,
          rec.content,
          rec.sha256.toLowerCase(),
          mandatoryInt,
          rec.expiresAt,
          sourcesJson,
          nowIso,
          diff.serverRecordId!,
          ownerId,
          diff.serverVersion!
        );
        if (Number(res.changes) !== 1) {
          throw new Error(`MEMORY_VERSION_CONFLICT:${rec.id}`);
        }
        appliedCounts.updated += 1;
        idMapping[rec.id] = diff.serverRecordId!;
        continue;
      }

      // Conflict handling with explicit owner decision
      const decision = resolutions[diff.recordId]!;
      if (decision.action === "keep_server") {
        appliedCounts.keptServer += 1;
        idMapping[rec.id] = diff.serverRecordId!;
      } else if (decision.action === "replace_with_client") {
        const res = updateStmt.run(
          rec.recordType,
          rec.key,
          rec.title,
          rec.content,
          rec.sha256.toLowerCase(),
          mandatoryInt,
          rec.expiresAt,
          sourcesJson,
          nowIso,
          diff.serverRecordId!,
          ownerId,
          decision.expectedServerVersion!
        );
        if (Number(res.changes) !== 1) {
          throw new Error(`MEMORY_VERSION_CONFLICT:${rec.id}`);
        }
        appliedCounts.updated += 1;
        idMapping[rec.id] = diff.serverRecordId!;
      } else if (decision.action === "fork_as_new_record") {
        const forkedId = `mem_fork_${randomUUID()}`;
        const forkedKey = `${rec.key}:fork:${forkedId.slice(-6)}`;
        const forkedTitle = rec.title.endsWith(" (копия из снимка)")
          ? rec.title
          : `${rec.title} (копия из снимка)`;
        insertStmt.run(
          forkedId,
          ownerId,
          rec.scope,
          rec.scopeId,
          rec.recordType,
          forkedKey,
          forkedTitle,
          rec.content,
          1,
          rec.sha256.toLowerCase(),
          mandatoryInt,
          rec.expiresAt,
          sourcesJson,
          nowIso
        );
        appliedCounts.forked += 1;
        idMapping[rec.id] = forkedId;
      }
    }

    // Restore non-conflicting or newer settings
    for (const setting of envelope.settings) {
      const scopeIdKey = setting.scopeId ?? "";
      const existingSetting = db
        .prepare(
          "SELECT version FROM context_memory_settings WHERE owner_id=? AND scope=? AND scope_id=? AND key=?"
        )
        .get(ownerId, setting.scope, scopeIdKey, setting.key) as { version: number } | undefined;

      if (!existingSetting) {
        db.prepare(
          `INSERT INTO context_memory_settings (owner_id, scope, scope_id, key, value_json, version, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(
          ownerId,
          setting.scope,
          scopeIdKey,
          setting.key,
          JSON.stringify(setting.value),
          setting.version,
          nowIso
        );
        appliedCounts.settingsUpdated += 1;
      } else if (setting.version > Number(existingSetting.version)) {
        db.prepare(
          `UPDATE context_memory_settings
           SET value_json=?, version=?, updated_at=?
           WHERE owner_id=? AND scope=? AND scope_id=? AND key=? AND version=?`
        ).run(
          JSON.stringify(setting.value),
          setting.version,
          nowIso,
          ownerId,
          setting.scope,
          scopeIdKey,
          setting.key,
          Number(existingSetting.version)
        );
        appliedCounts.settingsUpdated += 1;
      }
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return {
    restored: true,
    snapshotDigest,
    ownerId,
    appliedCounts,
    idMapping
  };
}
