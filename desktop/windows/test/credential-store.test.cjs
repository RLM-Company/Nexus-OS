"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { CredentialStore } = require("../credential-store.cjs");

function fakeSafeStorage(available = true) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value) => Buffer.from("enc:" + Buffer.from(value, "utf8").toString("base64")),
    decryptString: (value) => {
      const source = value.toString("utf8");
      if (!source.startsWith("enc:")) throw new Error("invalid payload");
      return Buffer.from(source.slice(4), "base64").toString("utf8");
    }
  };
}

test("stores credentials encrypted and scopes them to an origin", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cosmora-credentials-"));
  const filePath = path.join(directory, "credentials.bin");
  const store = new CredentialStore({ filePath, safeStorage: fakeSafeStorage() });

  store.save({
    origin: "https://cosmora.example",
    username: "owner",
    password: "secret-value"
  });

  const raw = fs.readFileSync(filePath, "utf8");
  assert.equal(raw.includes("secret-value"), false);
  assert.deepEqual(store.load("https://cosmora.example"), {
    origin: "https://cosmora.example",
    username: "owner",
    password: "secret-value"
  });
  assert.equal(store.load("https://other.example"), null);

  store.clear();
  assert.equal(fs.existsSync(filePath), false);
});

test("refuses persistent credentials when protected storage is unavailable", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cosmora-credentials-"));
  const filePath = path.join(directory, "credentials.bin");
  const store = new CredentialStore({
    filePath,
    safeStorage: fakeSafeStorage(false)
  });

  assert.equal(store.isAvailable(), false);
  assert.throws(
    () =>
      store.save({
        origin: "https://cosmora.example",
        username: "owner",
        password: "secret-value"
      }),
    /unavailable/
  );
  assert.equal(fs.existsSync(filePath), false);
});
