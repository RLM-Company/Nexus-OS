import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { DRIVE_FILE_SCOPE } from "./google-drive.js";
import type { DriveGrant } from "./google-drive-authorization.js";
import { validDriveGrant } from "./google-drive-authorization.js";

const CIPHER_PREFIX = "v1:";

export class DriveGrantCipher {
  private readonly key: Buffer;

  constructor(key: Uint8Array) {
    if (!(key instanceof Uint8Array) || key.byteLength !== 32) {
      throw new Error("DRIVE_KEY_CONFIGURATION_REQUIRED");
    }
    this.key = Buffer.from(key);
  }

  seal(ownerId: string, grant: DriveGrant): string {
    if (typeof ownerId !== "string" || !ownerId.trim()) {
      throw new Error("INVALID_OWNER");
    }
    if (!validDriveGrant(grant)) {
      throw new Error("INVALID_DRIVE_GRANT");
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(`kosmora-drive-grant-v1:${ownerId}`, "utf8"));
    const plaintext = Buffer.from(
      JSON.stringify({
        accessToken: grant.accessToken,
        refreshToken: grant.refreshToken,
        expiresAt: grant.expiresAt,
        scope: DRIVE_FILE_SCOPE
      }),
      "utf8"
    );
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${CIPHER_PREFIX}${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
  }

  open(ownerId: string, envelope: string): DriveGrant {
    if (typeof ownerId !== "string" || !ownerId.trim()) {
      throw new Error("INVALID_OWNER");
    }
    if (typeof envelope !== "string" || !envelope.startsWith(CIPHER_PREFIX)) {
      throw new Error("DRIVE_GRANT_CORRUPTED");
    }
    const parts = envelope.slice(CIPHER_PREFIX.length).split(".");
    if (parts.length !== 3) {
      throw new Error("DRIVE_GRANT_CORRUPTED");
    }
    try {
      const iv = Buffer.from(parts[0]!, "base64url");
      const tag = Buffer.from(parts[1]!, "base64url");
      const ciphertext = Buffer.from(parts[2]!, "base64url");
      if (iv.byteLength !== 12 || tag.byteLength !== 16 || ciphertext.byteLength === 0) {
        throw new Error("DRIVE_GRANT_CORRUPTED");
      }
      const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
      decipher.setAAD(Buffer.from(`kosmora-drive-grant-v1:${ownerId}`, "utf8"));
      decipher.setAuthTag(tag);
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      const parsed: unknown = JSON.parse(decrypted.toString("utf8"));
      if (!validDriveGrant(parsed)) {
        throw new Error("DRIVE_GRANT_CORRUPTED");
      }
      return parsed;
    } catch {
      throw new Error("DRIVE_GRANT_CORRUPTED");
    }
  }
}
