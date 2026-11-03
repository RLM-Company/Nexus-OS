import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { DriveStorageError } from "./google-drive.js";
import { validDriveGrant, type DriveGrant } from "./google-drive-authorization.js";

/** At-rest protection, NOT end-to-end encryption. The master key belongs outside
 * the application database and its exports/backups, supplied by deployment secrets.
 */
export class DriveGrantCipher {
  readonly #key: Buffer;
  constructor(key: Uint8Array) {
    if (key.byteLength !== 32) throw new DriveStorageError("DRIVE_KEY_CONFIGURATION_REQUIRED");
    this.#key = Buffer.from(key);
  }
  private aad(ownerId: string) {
    if (!ownerId || ownerId.length > 128) throw new DriveStorageError("DRIVE_AUTH_REQUIRED");
    return Buffer.from(`kosmora-drive-grant-v1\0${ownerId}`);
  }
  seal(ownerId: string, grant: DriveGrant): string {
    if (!validDriveGrant(grant)) throw new DriveStorageError("DRIVE_AUTH_INVALID_GRANT");
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#key, nonce);
    cipher.setAAD(this.aad(ownerId));
    // Serialize only approved fields even when a caller supplies an extended object.
    const plain = JSON.stringify({
      accessToken: grant.accessToken,
      refreshToken: grant.refreshToken,
      expiresAt: grant.expiresAt,
      scope: grant.scope
    });
    const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return [
      "v1",
      nonce.toString("base64url"),
      encrypted.toString("base64url"),
      cipher.getAuthTag().toString("base64url")
    ].join(".");
  }
  open(ownerId: string, envelope: string): DriveGrant {
    try {
      if (envelope.length > 24_000) throw Error();
      const [version, n, data, tag, extra] = envelope.split(".");
      if (
        version !== "v1" ||
        !n ||
        !data ||
        !tag ||
        extra !== undefined ||
        ![n, data, tag].every((s) => /^[A-Za-z0-9_-]+$/.test(s))
      )
        throw Error();
      const nonce = Buffer.from(n, "base64url"),
        ciphertext = Buffer.from(data, "base64url"),
        authTag = Buffer.from(tag, "base64url");
      if (
        nonce.length !== 12 ||
        authTag.length !== 16 ||
        nonce.toString("base64url") !== n ||
        ciphertext.toString("base64url") !== data ||
        authTag.toString("base64url") !== tag
      )
        throw Error();
      const decipher = createDecipheriv("aes-256-gcm", this.#key, nonce);
      decipher.setAAD(this.aad(ownerId));
      decipher.setAuthTag(authTag);
      const value: unknown = JSON.parse(
        Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")
      );
      if (!validDriveGrant(value)) throw Error();
      return value;
    } catch {
      throw new DriveStorageError("DRIVE_GRANT_UNREADABLE");
    }
  }
}
