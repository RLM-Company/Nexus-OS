import { isIP } from "node:net";
import type { DatabaseSync } from "node:sqlite";
import { DriveStorageError } from "./google-drive.js";
import { DriveGrantCipher } from "./google-drive-grant-cipher.js";
import { GoogleDriveAuthorization } from "./google-drive-authorization.js";
import { GoogleDriveStore } from "./google-drive-store.js";
import { GoogleDriveBackups } from "./google-drive-backups.js";
import { GoogleDriveConnection } from "./google-drive-connection.js";

export function configuredGoogleDrive(
  db: DatabaseSync,
  origin: string,
  env: NodeJS.ProcessEnv = process.env,
  request: typeof fetch = fetch
) {
  if (env.KOSMORA_DRIVE_ENABLED !== "1")
    return { store: new GoogleDriveStore(db), connection: null, origin };
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new DriveStorageError("DRIVE_OAUTH_CONFIGURATION_REQUIRED");
  }
  const key = env.KOSMORA_DRIVE_ENCRYPTION_KEY ?? "";
  const decoded = Buffer.from(key, "base64");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    isIP(url.hostname.replace(/^\[|\]$/g, "")) ||
    !env.KOSMORA_DRIVE_CLIENT_ID ||
    !env.KOSMORA_DRIVE_CLIENT_SECRET ||
    decoded.length !== 32 ||
    decoded.toString("base64") !== key
  )
    throw new DriveStorageError("DRIVE_OAUTH_CONFIGURATION_REQUIRED");
  const store = new GoogleDriveStore(db, new DriveGrantCipher(decoded));
  const authorization = new GoogleDriveAuthorization(
    {
      clientId: env.KOSMORA_DRIVE_CLIENT_ID,
      clientSecret: env.KOSMORA_DRIVE_CLIENT_SECRET,
      redirectUri: `${url.origin}/api/v1/storage/drive/callback`
    },
    request
  );
  const backups = new GoogleDriveBackups(store, authorization, request);
  const connection = new GoogleDriveConnection(store, authorization, backups, url.origin, request);
  return { store, connection, origin: url.origin };
}
export type GoogleDriveRuntime = ReturnType<typeof configuredGoogleDrive>;
