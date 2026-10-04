"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  isAllowedDesktopPermission,
  normalizeOrigin
} = require("../permission-policy.cjs");

test("allows only write-only clipboard permission on the exact connected origin", () => {
  const connectedOrigin = "https://cosmora.example";

  assert.equal(
    isAllowedDesktopPermission({
      permission: "clipboard-sanitized-write",
      requestingUrl: "https://cosmora.example/project/alpha",
      connectedOrigin
    }),
    true
  );
  assert.equal(
    isAllowedDesktopPermission({
      permission: "clipboard-sanitized-write",
      requestingUrl: "https://cdn.cosmora.example/",
      connectedOrigin
    }),
    false
  );
  assert.equal(
    isAllowedDesktopPermission({
      permission: "clipboard-sanitized-write",
      requestingUrl: "https://cosmora.example.evil.test/",
      connectedOrigin
    }),
    false
  );
});

test("denies sensitive browser and device permissions by default", () => {
  for (const permission of [
    "media",
    "geolocation",
    "notifications",
    "display-capture",
    "midi",
    "midiSysex",
    "pointerLock",
    "fullscreen",
    "hid",
    "serial",
    "usb",
    "fileSystem",
    "window-management",
    "unknown"
  ]) {
    assert.equal(
      isAllowedDesktopPermission({
        permission,
        requestingUrl: "https://cosmora.example/",
        connectedOrigin: "https://cosmora.example"
      }),
      false,
      permission
    );
  }
});

test("denies clipboard writes when no trusted remote origin is connected", () => {
  assert.equal(
    isAllowedDesktopPermission({
      permission: "clipboard-sanitized-write",
      requestingUrl: "file:///connection.html",
      connectedOrigin: null
    }),
    false
  );
});

test("normalizes only credential-free HTTP(S) origins", () => {
  assert.equal(normalizeOrigin("https://cosmora.example/path?q=1"), "https://cosmora.example");
  assert.equal(normalizeOrigin("http://127.0.0.1:3100/path"), "http://127.0.0.1:3100");
  assert.equal(normalizeOrigin("https://user:secret@cosmora.example"), null);
  assert.equal(normalizeOrigin("file:///tmp/index.html"), null);
});
