"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  parseDiagnosticRecords,
  redactString,
  serializeSupportBundle
} = require("../support-bundle.cjs");

test("redacts auth headers, URL credentials and sensitive query parameters", () => {
  const source =
    "Authorization: Bearer header-secret Cookie: session=cookie-secret " +
    "Bearer abc.def https://owner:secret@example.test/path?token=abc&safe=1 Basic Zm9vOmJhcg==";
  const redacted = redactString(source);
  assert.equal(redacted.includes("header-secret"), false);
  assert.equal(redacted.includes("cookie-secret"), false);
  assert.equal(redacted.includes("abc.def"), false);
  assert.equal(redacted.includes("owner:secret"), false);
  assert.equal(redacted.includes("token=abc"), false);
  assert.equal(redacted.includes("safe=1"), true);
});

test("sanitizes sensitive diagnostic object keys", () => {
  const records = parseDiagnosticRecords(
    JSON.stringify({
      event: "example",
      password: "do-not-export",
      nested: { authorization: "Basic abc", safe: "ok" }
    })
  );
  assert.equal(records[0].password, "[REDACTED]");
  assert.equal(records[0].nested.authorization, "[REDACTED]");
  assert.equal(records[0].nested.safe, "ok");
});

test("support bundle contains lifecycle metadata but not secrets", () => {
  const output = serializeSupportBundle({
    generatedAt: "2026-10-03T10:00:00.000Z",
    appVersion: "0.3.0",
    electronVersion: "44.5.1",
    chromeVersion: "151",
    nodeVersion: "24",
    platform: "win32",
    release: "10.0",
    arch: "x64",
    origin: "https://cosmora.example",
    connectionState: "online",
    lastRoute: "https://cosmora.example/project/1?token=hidden",
    rememberedCredentials: true,
    diagnosticText:
      '{"event":"auth","authorization":"Basic abc","message":"password=do-not-export"}'
  });

  assert.equal(output.includes("do-not-export"), false);
  assert.equal(output.includes("Basic abc"), false);
  assert.equal(output.includes("token=hidden"), false);
  assert.equal(output.includes('"rememberedCredentials": true'), true);
  assert.equal(output.includes('"state": "online"'), true);
});
