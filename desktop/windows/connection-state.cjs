"use strict";

const CONNECTION_STATES = Object.freeze({
  DISCONNECTED: "disconnected",
  CONNECTING: "connecting",
  ONLINE: "online",
  DEGRADED: "degraded",
  RECOVERING: "recovering",
  OFFLINE: "offline",
  AUTH_REQUIRED: "auth_required"
});

function transitionConnectionState(current, event) {
  switch (event) {
    case "connect_started":
      return CONNECTION_STATES.CONNECTING;
    case "connect_success":
    case "recovery_success":
      return CONNECTION_STATES.ONLINE;
    case "heartbeat_failed":
    case "renderer_unresponsive":
      return current === CONNECTION_STATES.OFFLINE
        ? CONNECTION_STATES.OFFLINE
        : CONNECTION_STATES.DEGRADED;
    case "recovery_started":
    case "network_online":
    case "resume":
      return current === CONNECTION_STATES.DISCONNECTED ||
        current === CONNECTION_STATES.AUTH_REQUIRED
        ? current
        : CONNECTION_STATES.RECOVERING;
    case "network_offline":
      return CONNECTION_STATES.OFFLINE;
    case "auth_failed":
      return CONNECTION_STATES.AUTH_REQUIRED;
    case "manual_disconnect":
      return CONNECTION_STATES.DISCONNECTED;
    case "renderer_responsive":
      return current === CONNECTION_STATES.DEGRADED
        ? CONNECTION_STATES.ONLINE
        : current;
    default:
      return current;
  }
}

function connectionTitleSuffix(state) {
  switch (state) {
    case CONNECTION_STATES.CONNECTING:
      return "подключение…";
    case CONNECTION_STATES.DEGRADED:
      return "соединение нестабильно";
    case CONNECTION_STATES.RECOVERING:
      return "переподключение…";
    case CONNECTION_STATES.OFFLINE:
      return "нет сети";
    case CONNECTION_STATES.AUTH_REQUIRED:
      return "нужна авторизация";
    default:
      return "";
  }
}

module.exports = {
  CONNECTION_STATES,
  connectionTitleSuffix,
  transitionConnectionState
};
