"use strict";

// Typed recovery events for device-level failures that the native driver raises
// as plain error strings. The session uses these to tell the planner WHAT changed
// while still requiring a fresh observation — no blind replay, no new permissions.

const EVENTS = Object.freeze({
  COMPUTER_WINDOW_CHANGED: "window_changed",
  COMPUTER_OBSERVATION_STALE: "observation_stale",
  COMPUTER_USER_INPUT_ACTIVE: "user_input_active",
  COMPUTER_TARGET_OCCLUDED: "target_occluded",
  COMPUTER_APP_NOT_FOUND: "app_missing",
  COMPUTER_FILE_NOT_FOUND: "file_missing",
  COMPUTER_DESKTOP_UNAVAILABLE: "device_unavailable",
  COMPUTER_SCREEN_UNAVAILABLE: "device_unavailable",
  COMPUTER_NATIVE_INTERRUPTED: "device_disconnected",
  // Device-wide lease: human takeover and disconnect must be typed recovery
  // events so the planner replans from a fresh observation instead of blindly
  // retrying an input whose effect may be uncertain.
  DEVICE_LEASE_TAKEN_OVER: "user_input_active",
  DEVICE_LEASE_LOST: "user_input_active",
  DEVICE_LEASE_ABORTED: "device_disconnected",
  DEVICE_STOPPED: "device_disconnected"
});

/** Return a typed event for a known device failure, or null for unknown errors. */
function classifyDeviceFailure(error) {
  if (!error) return null;
  const code = typeof error.code === "string" ? error.code : "";
  const message = typeof error.message === "string" ? error.message : "";
  const key = Object.keys(EVENTS).find((name) => name === code || name === message);
  return key
    ? { kind: EVENTS[key], reason: key, retryable: EVENTS[key] !== "device_disconnected" }
    : null;
}

module.exports = { EVENTS, classifyDeviceFailure };
