import { createHash, randomUUID } from "node:crypto";
import { createArchive, verifiedOriginal } from "../account-settings/privacy/archive.js";
import type {
  OriginalBinary,
  OwnerPrivacyCoordinator,
  PrivacySection
} from "../account-settings/privacy/coordinator.js";
import { DRIVE_ARCHIVE_MAX_BYTES } from "./google-drive.js";

export const DRIVE_BACKUP_SCHEMA_VERSION = 1;
const MAX_PART_PAYLOAD_BYTES = 3 * 1024 * 1024; // 3 MiB payload budget so ZIP + manifest stays well below 4 MiB
const ORIGINAL_CHUNK_BYTES = 2 * 1024 * 1024; // 2 MiB per binary chunk

const FORBIDDEN_SECTIONS = new Set([
  "cloud-storage",
  "policy-projects",
  "agent-studio",
  "code",
  "work",
  "computer-control"
]);

const FORBIDDEN_COLLECTIONS = new Set([
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
  "computer_tasks"
]);

const SENSITIVE_KEY_PATTERN =
  /(?:grant_ciphertext|access_?token|refresh_?token|password|passwd|secret|api_?key|private_?key|session_?token|confirmation_?token|bearer|authorization|cookie)/i;

const FORBIDDEN_FILENAME_PATTERN = /\.(?:sqlite|sqlite3|db|db-wal|db-shm|pem|key|pfx|p12|env)$/i;

export interface DriveBackupOriginalChunkRef {
  chunkIndex: number;
  totalChunks: number;
  partIndex: number;
  entryPath: string;
  sizeBytes: number;
  sha256: string;
}

export interface DriveBackupOriginalManifest {
  store: string;
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  chunks: DriveBackupOriginalChunkRef[];
}

export interface DriveBackupPartSummary {
  partIndex: number;
  totalParts: number;
  operationId: string;
  sizeBytes: number;
  sha256: string;
}

export interface DriveBackupManifest {
  schemaVersion: typeof DRIVE_BACKUP_SCHEMA_VERSION;
  backupSetId: string;
  ownerId: string;
  generatedAt: string;
  partIndex: number;
  totalParts: number;
  operationId: string;
  restorableCollections: Record<string, Record<string, number>>;
  originals: DriveBackupOriginalManifest[];
  excludedCategories: string[];
  parts?: DriveBackupPartSummary[];
}

export interface AssembledDriveArchivePart {
  backupSetId: string;
  partIndex: number;
  totalParts: number;
  operationId: string;
  bytes: Buffer;
  sizeBytes: number;
  sha256: string;
  manifest: DriveBackupManifest;
}

export interface AssembledDriveBackupSet {
  backupSetId: string;
  ownerId: string;
  generatedAt: string;
  totalParts: number;
  totalBytes: number;
  parts: AssembledDriveArchivePart[];
}

function sanitizeRecordValue(value: unknown, keyName = ""): unknown {
  if (keyName && SENSITIVE_KEY_PATTERN.test(keyName)) {
    throw new Error(`DRIVE_ARCHIVE_SECRET_REJECTED:${keyName}`);
  }
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    if (
      /^(?:Bearer\s+\S+|v1:[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(
        value
      )
    ) {
      throw new Error("DRIVE_ARCHIVE_SECRET_VALUE_REJECTED");
    }
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeRecordValue(item));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(k)) {
        continue;
      }
      out[k] = sanitizeRecordValue(v, k);
    }
    return out;
  }
  return String(value);
}

export function sanitizeExportSectionsForDrive(
  sections: Record<string, PrivacySection>
): {
  restorableSections: Record<string, Record<string, Record<string, unknown>[]>>;
  originalsToPack: { store: string; descriptor: OriginalBinary }[];
} {
  const restorableSections: Record<string, Record<string, Record<string, unknown>[]>> = {};
  const originalsToPack: { store: string; descriptor: OriginalBinary }[] = [];

  for (const [sectionName, section] of Object.entries(sections)) {
    if (!section.complete) {
      throw new Error(`DRIVE_ARCHIVE_INCOMPLETE_SECTION:${sectionName}`);
    }
    if (FORBIDDEN_SECTIONS.has(sectionName)) {
      continue;
    }

    const cleanedCollections: Record<string, Record<string, unknown>[]> = {};
    for (const [collectionName, rows] of Object.entries(section.records)) {
      if (FORBIDDEN_COLLECTIONS.has(collectionName)) {
        continue;
      }
      cleanedCollections[collectionName] = rows.map(
        (row) => sanitizeRecordValue(row) as Record<string, unknown>
      );
    }

    if (Object.keys(cleanedCollections).length > 0) {
      restorableSections[sectionName] = cleanedCollections;
    }

    for (const orig of section.originals) {
      if (FORBIDDEN_FILENAME_PATTERN.test(orig.filename)) {
        throw new Error(`DRIVE_ARCHIVE_FORBIDDEN_BINARY:${orig.filename}`);
      }
      originalsToPack.push({ store: sectionName, descriptor: orig });
    }
  }

  return { restorableSections, originalsToPack };
}

export function formatBackupSetOperationId(
  backupSetId: string,
  partIndex: number,
  totalParts: number
): string {
  return `set_${backupSetId}_part_${String(partIndex).padStart(3, "0")}_of_${String(totalParts).padStart(3, "0")}`;
}

export function parseBackupSetOperationId(operationId: string): {
  backupSetId: string;
  partIndex: number;
  totalParts: number;
} | null {
  const match = /^set_([a-zA-Z0-9_-]{6,64})_part_(\d{3})_of_(\d{3})$/.exec(operationId);
  if (!match) return null;
  const partIndex = Number(match[2]);
  const totalParts = Number(match[3]);
  if (
    !Number.isSafeInteger(partIndex) ||
    !Number.isSafeInteger(totalParts) ||
    partIndex < 1 ||
    totalParts < 1 ||
    partIndex > totalParts
  ) {
    return null;
  }
  return {
    backupSetId: match[1]!,
    partIndex,
    totalParts
  };
}

export async function buildDriveArchiveSetFromCoordinator(
  coordinator: Pick<OwnerPrivacyCoordinator, "export" | "binary">,
  ownerId: string,
  options: {
    backupSetId?: string;
    maxOriginalBytes?: number;
    now?: () => string;
  } = {}
): Promise<AssembledDriveBackupSet> {
  const exported = await coordinator.export(ownerId);
  if (!exported.complete) {
    throw new Error("DRIVE_ARCHIVE_EXPORT_INCOMPLETE");
  }

  const backupSetId = options.backupSetId ?? randomUUID().replace(/-/g, "").slice(0, 16);
  if (!/^[a-zA-Z0-9_-]{6,64}$/.test(backupSetId)) {
    throw new Error("INVALID_BACKUP_SET_ID");
  }
  const generatedAt = options.now ? options.now() : exported.generated_at;
  const maxOriginalBytes = options.maxOriginalBytes ?? 25 * 1024 * 1024;

  const { restorableSections, originalsToPack } = sanitizeExportSectionsForDrive(exported.sections);

  const restorableCollections: Record<string, Record<string, number>> = {};
  for (const [sec, cols] of Object.entries(restorableSections)) {
    restorableCollections[sec] = Object.fromEntries(
      Object.entries(cols).map(([col, rows]) => [col, rows.length])
    );
  }

  // Stage payload items: first records.json, then verified original chunks
  const stagedPayloads: {
    path: string;
    bytes: Buffer;
    originalMeta?: {
      store: string;
      descriptor: OriginalBinary;
      chunkIndex: number;
      totalChunks: number;
      chunkSha256: string;
    };
  }[] = [];

  const recordsBytes = Buffer.from(JSON.stringify(restorableSections, null, 2), "utf8");
  if (recordsBytes.byteLength > MAX_PART_PAYLOAD_BYTES) {
    // Split sections across separate JSON files if records alone are large
    for (const [sectionName, cols] of Object.entries(restorableSections)) {
      const secBytes = Buffer.from(JSON.stringify({ [sectionName]: cols }, null, 2), "utf8");
      if (secBytes.byteLength > MAX_PART_PAYLOAD_BYTES) {
        throw new Error("DRIVE_ARCHIVE_SECTION_TOO_LARGE");
      }
      stagedPayloads.push({
        path: `records/${sectionName}.json`,
        bytes: secBytes
      });
    }
  } else {
    stagedPayloads.push({
      path: "records/all.json",
      bytes: recordsBytes
    });
  }

  const originalManifestMap = new Map<string, DriveBackupOriginalManifest>();

  for (const { store, descriptor } of originalsToPack) {
    const bin = await coordinator.binary(ownerId, store, descriptor.id);
    if (!bin) {
      throw new Error(`DRIVE_ARCHIVE_MISSING_ORIGINAL:${store}/${descriptor.id}`);
    }
    const verifiedBytes = await verifiedOriginal(bin.stream, descriptor, maxOriginalBytes);
    const totalChunks = Math.max(1, Math.ceil(verifiedBytes.byteLength / ORIGINAL_CHUNK_BYTES));
    const safeId = descriptor.id.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
    const key = `${store}:${descriptor.id}`;

    originalManifestMap.set(key, {
      store,
      id: descriptor.id,
      filename: descriptor.filename,
      contentType: descriptor.content_type,
      sizeBytes: verifiedBytes.byteLength,
      sha256: descriptor.sha256.toLowerCase(),
      chunks: []
    });

    for (let idx = 0; idx < totalChunks; idx += 1) {
      const start = idx * ORIGINAL_CHUNK_BYTES;
      const end = Math.min(start + ORIGINAL_CHUNK_BYTES, verifiedBytes.byteLength);
      const chunkBuf = verifiedBytes.subarray(start, end);
      const chunkSha256 = createHash("sha256").update(chunkBuf).digest("hex");
      const entryPath = `originals/${store}/${safeId}.part${String(idx + 1).padStart(3, "0")}`;
      stagedPayloads.push({
        path: entryPath,
        bytes: chunkBuf,
        originalMeta: {
          store,
          descriptor,
          chunkIndex: idx + 1,
          totalChunks,
          chunkSha256
        }
      });
    }
  }

  // Group staged payloads into bins of <= MAX_PART_PAYLOAD_BYTES
  const bins: (typeof stagedPayloads)[] = [];
  let currentBin: typeof stagedPayloads = [];
  let currentBinBytes = 0;

  for (const item of stagedPayloads) {
    if (
      currentBin.length > 0 &&
      currentBinBytes + item.bytes.byteLength > MAX_PART_PAYLOAD_BYTES
    ) {
      bins.push(currentBin);
      currentBin = [];
      currentBinBytes = 0;
    }
    currentBin.push(item);
    currentBinBytes += item.bytes.byteLength;
  }
  if (currentBin.length > 0 || bins.length === 0) {
    bins.push(currentBin);
  }

  const totalParts = bins.length;

  // Record which partIndex each original chunk landed in
  bins.forEach((bin, binIdx) => {
    const partIndex = binIdx + 1;
    for (const item of bin) {
      if (item.originalMeta) {
        const key = `${item.originalMeta.store}:${item.originalMeta.descriptor.id}`;
        const manifestEntry = originalManifestMap.get(key);
        manifestEntry?.chunks.push({
          chunkIndex: item.originalMeta.chunkIndex,
          totalChunks: item.originalMeta.totalChunks,
          partIndex,
          entryPath: item.path,
          sizeBytes: item.bytes.byteLength,
          sha256: item.originalMeta.chunkSha256
        });
      }
    }
  });

  const originalsManifestList = [...originalManifestMap.values()];
  const excludedCategories = [
    "sqlite_database_files",
    "oauth_and_session_tokens",
    "system_secrets",
    "permissions_and_policy_grants",
    "active_background_tasks",
    "drive_connection_grants",
    "computer_execution_commands"
  ];

  const assembledParts: AssembledDriveArchivePart[] = [];
  let totalBytes = 0;

  for (let i = 0; i < totalParts; i += 1) {
    const partIndex = i + 1;
    const operationId = formatBackupSetOperationId(backupSetId, partIndex, totalParts);
    const manifest: DriveBackupManifest = {
      schemaVersion: DRIVE_BACKUP_SCHEMA_VERSION,
      backupSetId,
      ownerId,
      generatedAt,
      partIndex,
      totalParts,
      operationId,
      restorableCollections,
      originals: originalsManifestList,
      excludedCategories
    };
    const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2), "utf8");
    const zipEntries = [
      { path: "manifest.json", bytes: manifestBytes },
      ...bins[i]!.map((item) => ({ path: item.path, bytes: item.bytes }))
    ];
    const zipBuffer = createArchive(zipEntries, DRIVE_ARCHIVE_MAX_BYTES);
    const sha256 = createHash("sha256").update(zipBuffer).digest("hex");
    totalBytes += zipBuffer.byteLength;

    assembledParts.push({
      backupSetId,
      partIndex,
      totalParts,
      operationId,
      bytes: zipBuffer,
      sizeBytes: zipBuffer.byteLength,
      sha256,
      manifest
    });
  }

  return {
    backupSetId,
    ownerId,
    generatedAt,
    totalParts,
    totalBytes,
    parts: assembledParts
  };
}
