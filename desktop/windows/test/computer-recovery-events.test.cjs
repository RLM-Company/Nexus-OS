"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { EVENTS, classifyDeviceFailure } = require("../computer-recovery-events.cjs");

test("classifies window change and user input as retryable events", () => {
  assert.deepEqual(classifyDeviceFailure(Error("COMPUTER_WINDOW_CHANGED")), {
    kind: "window_changed",
    reason: "COMPUTER_WINDOW_CHANGED",
    retryable: true
  });
  assert.equal(
    classifyDeviceFailure({ code: "COMPUTER_USER_INPUT_ACTIVE" }).kind,
    "user_input_active"
  );
});

test("classifies missing app/file and unavailable desktop", () => {
  assert.deepEqual(classifyDeviceFailure(Error("COMPUTER_APP_NOT_FOUND")), {
    kind: "app_missing",
    reason: "COMPUTER_APP_NOT_FOUND",
    retryable: true
  });
  assert.equal(classifyDeviceFailure(Error("COMPUTER_FILE_NOT_FOUND")).kind, "file_missing");
  assert.equal(
    classifyDeviceFailure(Error("COMPUTER_DESKTOP_UNAVAILABLE")).kind,
    "device_unavailable"
  );
  assert.equal(
    classifyDeviceFailure(Error("COMPUTER_SCREEN_UNAVAILABLE")).kind,
    "device_unavailable"
  );
});

test("device disconnection is non-retryable so no blind replay occurs", () => {
  const event = classifyDeviceFailure(Error("COMPUTER_NATIVE_INTERRUPTED"));
  assert.equal(event.kind, "device_disconnected");
  assert.equal(event.retryable, false);
});

test("unknown errors are not classified and remain fail-closed", () => {
  assert.equal(classifyDeviceFailure(Error("COMPUTER_INPUT_REJECTED")), null);
  assert.equal(classifyDeviceFailure(null), null);
  assert.equal(EVENTS.COMPUTER_WINDOW_CHANGED, "window_changed");
});
