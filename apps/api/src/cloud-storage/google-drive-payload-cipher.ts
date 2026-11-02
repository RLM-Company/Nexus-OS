import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { DriveStorageError } from "./google-drive.js";
import { SNAPSHOT_MAX_BYTES } from "./google-drive-snapshot.js";
export class DrivePayloadCipher {
  readonly #key: Buffer;
  constructor(master: Uint8Array) {
    if (master.length !== 32) throw new DriveStorageError("DRIVE_KEY_CONFIGURATION_REQUIRED");
    this.#key = createHmac("sha256", master).update("kosmora-drive-snapshot-v1").digest();
  }
  seal(owner: string, id: string, bytes: Buffer): Buffer {
    if (bytes.length > SNAPSHOT_MAX_BYTES) throw new DriveStorageError("BACKUP_TOO_LARGE");
    const nonce = randomBytes(12),
      c = createCipheriv("aes-256-gcm", this.#key, nonce);
    c.setAAD(Buffer.from(JSON.stringify(["snapshot-v1", owner, id])));
    return Buffer.concat([nonce, c.update(bytes), c.final(), c.getAuthTag()]);
  }
  open(owner: string, id: string, bytes: Uint8Array): Buffer {
    try {
      if (bytes.length < 29 || bytes.length > SNAPSHOT_MAX_BYTES + 28) throw Error();
      const b = Buffer.from(bytes),
        c = createDecipheriv("aes-256-gcm", this.#key, b.subarray(0, 12));
      c.setAAD(Buffer.from(JSON.stringify(["snapshot-v1", owner, id])));
      c.setAuthTag(b.subarray(-16));
      return Buffer.concat([c.update(b.subarray(12, -16)), c.final()]);
    } catch {
      throw new DriveStorageError("BACKUP_CACHE_UNREADABLE");
    }
  }
}
