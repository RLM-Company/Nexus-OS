import type { DatabaseSync } from "node:sqlite";
import type { OwnerPrivacyCoordinator } from "../account-settings/privacy/coordinator.js";
import {
  DRIVE_ARCHIVE_MAX_BYTES,
  DRIVE_FILE_SCOPE,
  DriveStorageError,
  GoogleDriveArchiveTransport,
  readBoundedDriveBody,
  type DriveArchiveReceipt
} from "./google-drive.js";
import {
  GoogleDriveAuthorization,
  validDriveGrant,
  type DriveGrant
} from "./google-drive-authorization.js";
import {
  DRIVE_BACKUP_SCHEMA_VERSION,
  buildDriveArchiveSetFromCoordinator,
  formatBackupSetOperationId,
  parseBackupSetOperationId,
  sanitizeExportSectionsForDrive,
  type AssembledDriveArchivePart,
  type AssembledDriveBackupSet,
  type DriveBackupManifest,
  type DriveBackupOriginalChunkRef,
  type DriveBackupOriginalManifest,
  type DriveBackupPartSummary
} from "./google-drive-archive-builder.js";
import { GoogleDriveBackups } from "./google-drive-backups.js";
import {
  GoogleDriveController,
  aggregateMultipartBackupSets,
  type DriveOwnerOverview,
  type MultipartBackupSetState,
  type MultipartBackupSetView
} from "./google-drive-controller.js";
import { DriveGrantCipher } from "./google-drive-grant-cipher.js";
import { googleDrivePrivacyAdapter } from "./google-drive-privacy.js";
import {
  executeTransactionalDriveRestore,
  previewDriveRestore,
  readStoredZipEntries,
  validateAndUnpackRestoreParts,
  type DriveRestorePreview,
  type DriveRestoreResult,
  type ValidatedRestorePackage
} from "./google-drive-restore.js";
import { registerGoogleDriveRoutes } from "./google-drive-routes.js";
import {
  GoogleDriveStore,
  type DriveArchive,
  type DriveConnectTicket,
  type DriveConnectionStatus,
  type DriveContext
} from "./google-drive-store.js";

export function parseDriveGrantKeyFromEnv(rawKey = process.env.KOSMORA_GOOGLE_DRIVE_GRANT_KEY): Uint8Array | null {
  if (!rawKey || typeof rawKey !== "string") return null;
  const trimmed = rawKey.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }
  try {
    const decoded = Buffer.from(trimmed, "base64");
    if (decoded.byteLength === 32) return decoded;
  } catch {
    /* ignore */
  }
  return null;
}

export function createConfiguredGoogleDriveStack(options: {
  db: DatabaseSync;
  privacy: OwnerPrivacyCoordinator;
  env?: Record<string, string | undefined>;
  request?: typeof fetch;
  now?: () => number;
}): {
  store: GoogleDriveStore;
  backups: GoogleDriveBackups;
  controller: GoogleDriveController;
  privacyAdapter: ReturnType<typeof googleDrivePrivacyAdapter>;
} {
  const env = options.env ?? process.env;
  const keyBytes = parseDriveGrantKeyFromEnv(env.KOSMORA_GOOGLE_DRIVE_GRANT_KEY);
  const cipher = keyBytes ? new DriveGrantCipher(keyBytes) : undefined;
  const store = new GoogleDriveStore(options.db, cipher);

  const clientId = env.KOSMORA_GOOGLE_DRIVE_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.KOSMORA_GOOGLE_DRIVE_CLIENT_SECRET?.trim() ?? "";
  const redirectUri = env.KOSMORA_GOOGLE_DRIVE_REDIRECT_URI?.trim() ?? "";

  const auth =
    clientId && clientSecret && redirectUri
      ? new GoogleDriveAuthorization({
          clientId,
          clientSecret,
          redirectUri,
          ...(options.request ? { request: options.request } : {}),
          ...(options.now ? { now: options.now } : {})
        })
      : null;

  const backups = new GoogleDriveBackups(
    store,
    auth ?? {
      refresh() {
        return Promise.reject(new Error("DRIVE_OAUTH_CONFIGURATION_REQUIRED"));
      }
    },
    options.request ?? fetch,
    options.now ?? Date.now
  );

  // Register the shared GoogleDriveBackups instance with the privacy adapter
  // so export/delete operations quiesce and halt active Drive uploads.
  const privacyAdapter = googleDrivePrivacyAdapter(options.db, backups);

  const controller = new GoogleDriveController({
    db: options.db,
    store,
    backups,
    auth,
    privacy: options.privacy,
    ...(options.request ? { request: options.request } : {}),
    ...(options.now ? { now: options.now } : {})
  });

  return {
    store,
    backups,
    controller,
    privacyAdapter
  };
}

export {
  DRIVE_ARCHIVE_MAX_BYTES,
  DRIVE_BACKUP_SCHEMA_VERSION,
  DRIVE_FILE_SCOPE,
  DriveGrantCipher,
  DriveStorageError,
  GoogleDriveArchiveTransport,
  GoogleDriveAuthorization,
  GoogleDriveBackups,
  GoogleDriveController,
  GoogleDriveStore,
  aggregateMultipartBackupSets,
  buildDriveArchiveSetFromCoordinator,
  executeTransactionalDriveRestore,
  formatBackupSetOperationId,
  googleDrivePrivacyAdapter,
  parseBackupSetOperationId,
  previewDriveRestore,
  readBoundedDriveBody,
  readStoredZipEntries,
  registerGoogleDriveRoutes,
  sanitizeExportSectionsForDrive,
  validDriveGrant,
  validateAndUnpackRestoreParts,
  type AssembledDriveArchivePart,
  type AssembledDriveBackupSet,
  type DriveArchive,
  type DriveArchiveReceipt,
  type DriveBackupManifest,
  type DriveBackupOriginalChunkRef,
  type DriveBackupOriginalManifest,
  type DriveBackupPartSummary,
  type DriveConnectTicket,
  type DriveConnectionStatus,
  type DriveContext,
  type DriveGrant,
  type DriveOwnerOverview,
  type DriveRestorePreview,
  type DriveRestoreResult,
  type MultipartBackupSetState,
  type MultipartBackupSetView,
  type ValidatedRestorePackage
};
