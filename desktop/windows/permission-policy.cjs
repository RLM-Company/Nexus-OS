"use strict";

function normalizedOrigin(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function permissionDecision({ permission, requestingOrigin, activeOrigin }) {
  const requestedOrigin = normalizedOrigin(requestingOrigin);
  const trustedOrigin = normalizedOrigin(activeOrigin);

  if (!requestedOrigin || !trustedOrigin || requestedOrigin !== trustedOrigin) {
    return {
      allowed: false,
      reason: "untrusted_origin"
    };
  }

  return {
    allowed: false,
    reason: typeof permission === "string" && permission ? "not_enabled" : "invalid_permission"
  };
}

function devicePermissionDecision({ origin, activeOrigin }) {
  const requestedOrigin = normalizedOrigin(origin);
  const trustedOrigin = normalizedOrigin(activeOrigin);

  return {
    allowed: false,
    reason:
      requestedOrigin && trustedOrigin && requestedOrigin === trustedOrigin
        ? "device_access_not_enabled"
        : "untrusted_origin"
  };
}

module.exports = {
  devicePermissionDecision,
  normalizedOrigin,
  permissionDecision
};
