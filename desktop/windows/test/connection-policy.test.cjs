"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const {
  connectionViewState,
  createLatestAttemptGate,
  isAllowedDownload,
  isAllowedDownloadUrl,
  isAllowedRemoteNavigation,
  isSafeExternalUrl,
  nextAvailableDownloadPath,
  normalizeServerOrigin,
  safeDownloadFilename
} = require("../connection-policy.cjs");

test("allows HTTPS origins and loopback HTTP only", () => {
  assert.equal(normalizeServerOrigin("https://13.141.51.16"), "https://13.141.51.16");
  assert.equal(normalizeServerOrigin("http://127.0.0.1:3000"), "http://127.0.0.1:3000");
  assert.throws(() => normalizeServerOrigin("http://example.com"), /HTTPS/);
});

test("rejects credentials, paths, query strings and fragments in the server address", () => {
  assert.throws(() => normalizeServerOrigin("https://user:secret@example.com"), /логин|пароль/);
  assert.throws(() => normalizeServerOrigin("https://example.com/app"), /origin/);
  assert.throws(() => normalizeServerOrigin("https://example.com/?token=secret"), /origin/);
  assert.throws(() => normalizeServerOrigin("https://example.com/#token"), /origin/);
});

test("keeps in-app navigation on the connected origin", () => {
  assert.equal(
    isAllowedRemoteNavigation("https://cosmora.example/projects/1", "https://cosmora.example"),
    true
  );
  assert.equal(isAllowedRemoteNavigation("https://example.com/", "https://cosmora.example"), false);
  assert.equal(isAllowedRemoteNavigation("javascript:alert(1)", "https://cosmora.example"), false);
});

test("opens only ordinary safe external schemes", () => {
  assert.equal(isSafeExternalUrl("https://example.com/docs"), true);
  assert.equal(isSafeExternalUrl("mailto:owner@example.com"), true);
  assert.equal(isSafeExternalUrl("file:///C:/secret.txt"), false);
  assert.equal(isSafeExternalUrl("javascript:alert(1)"), false);
  assert.equal(isSafeExternalUrl("https://user:secret@example.com"), false);
});

test("download chain must remain entirely on the active Kosmora origin", () => {
  assert.equal(
    isAllowedDownload(
      ["https://cosmora.example/a", "https://cosmora.example/b"],
      "https://cosmora.example"
    ),
    true
  );
  assert.equal(
    isAllowedDownload(
      ["https://cosmora.example/a", "https://cdn.example/b"],
      "https://cosmora.example"
    ),
    false
  );
  assert.equal(isAllowedDownload([], "https://cosmora.example"), false);
});

test("allows only same-origin blob downloads and rejects foreign/local schemes", () => {
  assert.equal(
    isAllowedDownloadUrl("blob:https://cosmora.example/8f7b", "https://cosmora.example"),
    true
  );
  assert.equal(
    isAllowedDownloadUrl("blob:https://evil.example/8f7b", "https://cosmora.example"),
    false
  );
  assert.equal(isAllowedDownloadUrl("data:text/plain,secret", "https://cosmora.example"), false);
  assert.equal(isAllowedDownloadUrl("file:///C:/secret.txt", "https://cosmora.example"), false);
  assert.equal(
    isAllowedDownload(
      ["https://cosmora.example/file", "blob:https://cosmora.example/8f7b"],
      "https://cosmora.example"
    ),
    true
  );
  assert.equal(
    isAllowedDownload(
      ["https://cosmora.example/file", "blob:https://evil.example/8f7b"],
      "https://cosmora.example"
    ),
    false
  );
});

test("sanitizes downloads and avoids overwriting existing files", () => {
  assert.equal(safeDownloadFilename('report<final>:"?.md'), "report_final____.md");
  const seen = new Set([
    path.join("Downloads", "result.md"),
    path.join("Downloads", "result (1).md")
  ]);
  const chosen = nextAvailableDownloadPath("Downloads", "result.md", (value) => seen.has(value));
  assert.equal(chosen, path.join("Downloads", "result (2).md"));
});

test("connection screen distinguishes first setup from saved-server recovery", () => {
  assert.deepEqual(connectionViewState({ hasSavedOrigin: false }), {
    mode: "setup",
    message: "",
    connecting: false
  });
  assert.deepEqual(connectionViewState({ hasSavedOrigin: true, message: "offline" }), {
    mode: "offline",
    message: "offline",
    connecting: false
  });
});

test("latest connection attempt wins and stale completion cannot clear busy state", () => {
  const gate = createLatestAttemptGate();
  const first = gate.begin();
  const second = gate.begin();
  assert.equal(gate.isCurrent(first), false);
  assert.equal(gate.isCurrent(second), true);
  assert.equal(gate.isInFlight(), true);
  gate.finish(first);
  assert.equal(gate.isInFlight(), true);
  gate.finish(second);
  assert.equal(gate.isInFlight(), false);
});
