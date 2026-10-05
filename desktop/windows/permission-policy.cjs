"use strict";

const SAFE_SAME_ORIGIN_PERMISSIONS = new Set(["clipboard-sanitized-write"]);

function safeOrigin(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function safePermissionName(value) {
  if (typeof value !== "string") return "unknown";
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "_")
    .slice(0, 64);
  return normalized || "unknown";
}

function isDesktopPermissionAllowed({ permission, requestingUrl, connectedOrigin }) {
  const name = safePermissionName(permission);
  if (!SAFE_SAME_ORIGIN_PERMISSIONS.has(name)) return false;

  const requestingOrigin = safeOrigin(requestingUrl);
  const trustedOrigin = safeOrigin(connectedOrigin);
  return Boolean(requestingOrigin && trustedOrigin && requestingOrigin === trustedOrigin);
}

function isDevicePermissionAllowed() {
  return false;
}

module.exports = {
  SAFE_SAME_ORIGIN_PERMISSIONS,
  isDesktopPermissionAllowed,
  isDevicePermissionAllowed,
  safeOrigin,
  safePermissionName
};
