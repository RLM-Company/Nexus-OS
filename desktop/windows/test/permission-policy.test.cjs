"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  isDesktopPermissionAllowed,
  isDevicePermissionAllowed,
  safeOrigin,
  safePermissionName
} = require("../permission-policy.cjs");

test("allows only sanitized clipboard writes from the exact connected origin", () => {
  assert.equal(
    isDesktopPermissionAllowed({
      permission: "clipboard-sanitized-write",
      requestingUrl: "https://cosmora.example/projects/1",
      connectedOrigin: "https://cosmora.example"
    }),
    true
  );

  for (const permission of [
    "media",
    "geolocation",
    "notifications",
    "midiSysex",
    "pointerLock",
    "fullscreen",
    "openExternal",
    "idle-detection",
    "display-capture",
    "clipboard-read"
  ]) {
    assert.equal(
      isDesktopPermissionAllowed({
        permission,
        requestingUrl: "https://cosmora.example",
        connectedOrigin: "https://cosmora.example"
      }),
      false,
      permission
    );
  }
});

test("does not grant clipboard permission across origins or without a connection", () => {
  assert.equal(
    isDesktopPermissionAllowed({
      permission: "clipboard-sanitized-write",
      requestingUrl: "https://cdn.example",
      connectedOrigin: "https://cosmora.example"
    }),
    false
  );
  assert.equal(
    isDesktopPermissionAllowed({
      permission: "clipboard-sanitized-write",
      requestingUrl: "https://cosmora.example.evil.test",
      connectedOrigin: "https://cosmora.example"
    }),
    false
  );
  assert.equal(
    isDesktopPermissionAllowed({
      permission: "clipboard-sanitized-write",
      requestingUrl: "https://cosmora.example",
      connectedOrigin: null
    }),
    false
  );
});

test("rejects credential-bearing and non-web permission origins", () => {
  assert.equal(safeOrigin("https://user:secret@cosmora.example"), null);
  assert.equal(safeOrigin("file:///tmp/index.html"), null);
  assert.equal(safeOrigin("https://cosmora.example/path"), "https://cosmora.example");
});

test("sanitizes permission names before diagnostics", () => {
  assert.equal(safePermissionName("Geolocation"), "geolocation");
  assert.equal(safePermissionName("weird permission\nsecret"), "weird_permission_secret");
  assert.equal(safePermissionName(null), "unknown");
});

test("denies all device permissions by default", () => {
  assert.equal(isDevicePermissionAllowed(), false);
});
