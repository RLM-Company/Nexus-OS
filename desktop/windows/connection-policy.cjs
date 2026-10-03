"use strict";

const path = require("node:path");

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const RETRY_DELAYS_MS = [1000, 2000, 5000, 10000, 30000];

function normalizeServerOrigin(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("Укажите адрес Cosmora.");
  }

  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error("Адрес Cosmora имеет неверный формат.");
  }

  const isSecureRemote = parsed.protocol === "https:";
  const isLocalHttp = parsed.protocol === "http:" && LOOPBACK_HOSTS.has(parsed.hostname);
  if (!isSecureRemote && !isLocalHttp) {
    throw new Error("Для удалённого сервера требуется HTTPS. HTTP разрешён только для localhost.");
  }

  if (parsed.username || parsed.password) {
    throw new Error("Не помещайте логин или пароль в адрес сервера.");
  }

  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("Укажите только origin сервера без пути, query-параметров и fragment.");
  }

  return parsed.origin;
}

function isAllowedRemoteNavigation(value, origin) {
  if (!origin) return false;
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) return false;
    return (
      (parsed.protocol === "https:" || parsed.protocol === "http:") && parsed.origin === origin
    );
  } catch {
    return false;
  }
}

function safeExternalNavigationUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function isAllowedCredentialChallenge(value, origin, isProxy) {
  if (!origin || isProxy) return false;
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) return false;
    return parsed.origin === origin;
  } catch {
    return false;
  }
}

function retryDelayMs(attempt) {
  const normalized = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0;
  return RETRY_DELAYS_MS[Math.min(normalized, RETRY_DELAYS_MS.length - 1)];
}

function safeLogUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.origin + parsed.pathname;
  } catch {
    return "<invalid-url>";
  }
}

function safeDownloadFilename(value) {
  const fallback = "cosmora-result";
  const source = typeof value === "string" && value.trim() ? value.trim() : fallback;
  const cleaned = source
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 180);
  if (!cleaned) return fallback;

  const deviceStem = cleaned.split(".")[0].toUpperCase();
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(deviceStem)) {
    return "_" + cleaned;
  }

  return cleaned;
}

function nextAvailableDownloadPath(directory, filename, existsSync) {
  const safe = safeDownloadFilename(filename);
  const extension = path.extname(safe);
  const stem = extension ? safe.slice(0, -extension.length) : safe;
  let candidate = path.join(directory, safe);
  let suffix = 1;

  while (existsSync(candidate)) {
    candidate = path.join(directory, stem + " (" + suffix + ")" + extension);
    suffix += 1;
  }

  return candidate;
}

module.exports = {
  isAllowedCredentialChallenge,
  isAllowedRemoteNavigation,
  nextAvailableDownloadPath,
  normalizeServerOrigin,
  retryDelayMs,
  safeDownloadFilename,
  safeExternalNavigationUrl,
  safeLogUrl
};
