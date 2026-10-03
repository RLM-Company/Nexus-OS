"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  CONNECTION_STATES,
  connectionTitleSuffix,
  transitionConnectionState
} = require("../connection-state.cjs");

test("models connect, degrade and recovery lifecycle", () => {
  let state = CONNECTION_STATES.DISCONNECTED;
  state = transitionConnectionState(state, "connect_started");
  assert.equal(state, CONNECTION_STATES.CONNECTING);
  state = transitionConnectionState(state, "connect_success");
  assert.equal(state, CONNECTION_STATES.ONLINE);
  state = transitionConnectionState(state, "heartbeat_failed");
  assert.equal(state, CONNECTION_STATES.DEGRADED);
  state = transitionConnectionState(state, "recovery_started");
  assert.equal(state, CONNECTION_STATES.RECOVERING);
  state = transitionConnectionState(state, "recovery_success");
  assert.equal(state, CONNECTION_STATES.ONLINE);
});

test("keeps offline state stable until the network returns", () => {
  let state = transitionConnectionState(CONNECTION_STATES.ONLINE, "network_offline");
  assert.equal(state, CONNECTION_STATES.OFFLINE);
  state = transitionConnectionState(state, "heartbeat_failed");
  assert.equal(state, CONNECTION_STATES.OFFLINE);
  state = transitionConnectionState(state, "network_online");
  assert.equal(state, CONNECTION_STATES.RECOVERING);
});

test("does not recover disconnected or auth-required sessions automatically", () => {
  assert.equal(
    transitionConnectionState(CONNECTION_STATES.DISCONNECTED, "network_online"),
    CONNECTION_STATES.DISCONNECTED
  );
  assert.equal(
    transitionConnectionState(CONNECTION_STATES.AUTH_REQUIRED, "resume"),
    CONNECTION_STATES.AUTH_REQUIRED
  );
});

test("maps connection states to concise title suffixes", () => {
  assert.equal(connectionTitleSuffix(CONNECTION_STATES.ONLINE), "");
  assert.equal(connectionTitleSuffix(CONNECTION_STATES.OFFLINE), "нет сети");
  assert.equal(connectionTitleSuffix(CONNECTION_STATES.AUTH_REQUIRED), "нужна авторизация");
});
