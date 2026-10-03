"use strict";

const fs = require("node:fs");
const path = require("node:path");

class CredentialStore {
  constructor({ filePath, safeStorage, fsImpl = fs }) {
    this.filePath = filePath;
    this.safeStorage = safeStorage;
    this.fs = fsImpl;
  }

  isAvailable() {
    return Boolean(
      this.safeStorage &&
        typeof this.safeStorage.isEncryptionAvailable === "function" &&
        this.safeStorage.isEncryptionAvailable()
    );
  }

  load(origin) {
    if (!this.isAvailable()) return null;

    try {
      const encrypted = this.fs.readFileSync(this.filePath);
      const parsed = JSON.parse(this.safeStorage.decryptString(encrypted));
      if (
        parsed &&
        parsed.origin === origin &&
        typeof parsed.username === "string" &&
        typeof parsed.password === "string"
      ) {
        return {
          origin: parsed.origin,
          username: parsed.username,
          password: parsed.password
        };
      }
    } catch {
      return null;
    }

    return null;
  }

  save({ origin, username, password }) {
    if (!this.isAvailable()) {
      throw new Error("Windows protected credential storage is unavailable.");
    }

    const encrypted = this.safeStorage.encryptString(JSON.stringify({ origin, username, password }));
    const temporary = this.filePath + ".tmp";

    this.fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    this.fs.writeFileSync(temporary, encrypted, { mode: 0o600 });
    this.fs.rmSync(this.filePath, { force: true });
    this.fs.renameSync(temporary, this.filePath);
  }

  clear() {
    try {
      this.fs.rmSync(this.filePath, { force: true });
    } catch {
      // Best-effort removal. A later save will replace the file.
    }
  }

  has(origin) {
    return this.load(origin) !== null;
  }
}

module.exports = { CredentialStore };
