"use strict";

const WRITE_ONLY_PERMISSIONS = new Set(["clipboard-sanitized-write"]);

function normalizeOrigin(value) {
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function isAllowedDesktopPermission({ permission, requestingUrl, connectedOrigin }) {
  if (!WRITE_ONLY_PERMISSIONS.has(permission)) return false;

  const requestOrigin = normalizeOrigin(requestingUrl);
  const trustedOrigin = normalizeOrigin(connectedOrigin);
  return Boolean(requestOrigin && trustedOrigin && requestOrigin === trustedOrigin);
}

module.exports = {
  WRITE_ONLY_PERMISSIONS,
  isAllowedDesktopPermission,
  normalizeOrigin
};
