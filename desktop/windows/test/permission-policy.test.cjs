"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  devicePermissionDecision,
  normalizedOrigin,
  permissionDecision
} = require("../permission-policy.cjs");

test("normalizes web origins without accepting non-web schemes", () => {
  assert.equal(normalizedOrigin("https://cosmora.example/path"), "https://cosmora.example");
  assert.equal(normalizedOrigin("http://127.0.0.1:3000/chat"), "http://127.0.0.1:3000");
  assert.equal(normalizedOrigin("file:///tmp/index.html"), null);
  assert.equal(normalizedOrigin("not-a-url"), null);
});

test("denies sensitive web permissions even for the active Cosmora origin", () => {
  for (const permission of [
    "media",
    "geolocation",
    "notifications",
    "hid",
    "serial",
    "usb",
    "midi",
    "midiSysex",
    "sensors",
    "local-fonts",
    "idle-detection",
    "screen-wake-lock",
    "window-management",
    "openExternal"
  ]) {
    const decision = permissionDecision({
      permission,
      requestingOrigin: "https://cosmora.example",
      activeOrigin: "https://cosmora.example"
    });
    assert.deepEqual(decision, { allowed: false, reason: "not_enabled" });
  }
});

test("denies permission checks from subdomains and credential lookalikes", () => {
  assert.equal(
    permissionDecision({
      permission: "notifications",
      requestingOrigin: "https://cdn.cosmora.example",
      activeOrigin: "https://cosmora.example"
    }).reason,
    "untrusted_origin"
  );
  assert.equal(
    permissionDecision({
      permission: "notifications",
      requestingOrigin: "https://cosmora.example.evil.test",
      activeOrigin: "https://cosmora.example"
    }).reason,
    "untrusted_origin"
  );
});

test("denies persisted device permissions by default", () => {
  assert.deepEqual(
    devicePermissionDecision({
      origin: "https://cosmora.example",
      activeOrigin: "https://cosmora.example"
    }),
    { allowed: false, reason: "device_access_not_enabled" }
  );
  assert.equal(
    devicePermissionDecision({
      origin: "https://evil.test",
      activeOrigin: "https://cosmora.example"
    }).reason,
    "untrusted_origin"
  );
});
