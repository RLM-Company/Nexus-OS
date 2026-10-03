"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  isAllowedRemoteNavigation,
  nextAvailableDownloadPath,
  normalizeServerOrigin,
  retryDelayMs,
  safeDownloadFilename,
  safeLogUrl
} = require("../connection-policy.cjs");

test("allows HTTPS origins and loopback HTTP only", () => {
  assert.equal(normalizeServerOrigin("https://13.141.51.16"), "https://13.141.51.16");
  assert.equal(normalizeServerOrigin("http://127.0.0.1:3000"), "http://127.0.0.1:3000");
  assert.throws(() => normalizeServerOrigin("http://example.com"), /HTTPS/);
});

test("rejects credentials, paths and query strings in the server address", () => {
  assert.throws(() => normalizeServerOrigin("https://user:secret@example.com"), /логин|пароль/);
  assert.throws(() => normalizeServerOrigin("https://example.com/app"), /origin/);
  assert.throws(() => normalizeServerOrigin("https://example.com/?token=secret"), /origin/);
});

test("keeps in-app navigation on the connected origin", () => {
  assert.equal(
    isAllowedRemoteNavigation("https://cosmora.example/projects/1", "https://cosmora.example"),
    true
  );
  assert.equal(isAllowedRemoteNavigation("https://example.com/", "https://cosmora.example"), false);
});

test("uses bounded reconnect backoff", () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 50].map((attempt) => retryDelayMs(attempt)),
    [1000, 2000, 5000, 10000, 30000, 30000, 30000]
  );
});

test("removes query parameters and fragments from diagnostic URLs", () => {
  assert.equal(
    safeLogUrl("https://user:secret@cosmora.example/projects/1?token=secret#result"),
    "https://cosmora.example/projects/1"
  );
  assert.equal(safeLogUrl("not a url"), "<invalid-url>");
});

test("sanitizes downloads and avoids overwriting existing files", () => {
  assert.equal(safeDownloadFilename('report<final>:"?.md'), "report_final____.md");
  const seen = new Set(["C:\\Downloads\\result.md", "C:\\Downloads\\result (1).md"]);
  const chosen = nextAvailableDownloadPath("C:\\Downloads", "result.md", (value) =>
    seen.has(value)
  );
  assert.equal(chosen, "C:\\Downloads\\result (2).md");
});
