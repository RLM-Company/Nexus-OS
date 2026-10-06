"use strict";

const path = require("node:path");

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const EXTERNAL_PROTOCOLS = new Set(["https:", "http:", "mailto:"]);

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
    return (parsed.protocol === "https:" || parsed.protocol === "http:") && parsed.origin === origin;
  } catch {
    return false;
  }
}

function isSafeExternalUrl(value) {
  try {
    const parsed = new URL(value);
    return EXTERNAL_PROTOCOLS.has(parsed.protocol) && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function isAllowedDownloadUrl(value, origin) {
  if (isAllowedRemoteNavigation(value, origin)) return true;
  if (!origin) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "blob:" && parsed.origin === origin;
  } catch {
    return false;
  }
}

function isAllowedDownload(urlChain, origin) {
  if (!origin || !Array.isArray(urlChain) || urlChain.length === 0) return false;
  return urlChain.every((value) => isAllowedDownloadUrl(value, origin));
}

function safeDownloadFilename(value) {
  const fallback = "cosmora-result";
  const source = typeof value === "string" && value.trim() ? value.trim() : fallback;
  const cleaned = source
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 180);
  return cleaned || fallback;
}

function nextAvailableDownloadPath(directory, filename, existsSync, pathApi = path) {
  const safe = safeDownloadFilename(filename);
  const extension = pathApi.extname(safe);
  const stem = extension ? safe.slice(0, -extension.length) : safe;
  let candidate = pathApi.join(directory, safe);
  let suffix = 1;
  while (existsSync(candidate)) {
    candidate = pathApi.join(directory, `${stem} (${suffix})${extension}`);
    suffix += 1;
  }
  return candidate;
}

function createLatestAttemptGate() {
  let generation = 0;
  let inFlight = false;
  return {
    begin() {
      generation += 1;
      inFlight = true;
      return generation;
    },
    finish(value) {
      if (value === generation) inFlight = false;
    },
    isCurrent(value) {
      return value === generation;
    },
    isInFlight() {
      return inFlight;
    }
  };
}

function connectionViewState({ hasSavedOrigin, message = "", connecting = false } = {}) {
  return {
    mode: hasSavedOrigin ? "offline" : "setup",
    message: typeof message === "string" ? message.slice(0, 500) : "",
    connecting: Boolean(connecting)
  };
}

module.exports = {
  connectionViewState,
  createLatestAttemptGate,
  isAllowedDownload,
  isAllowedDownloadUrl,
  isAllowedRemoteNavigation,
  isSafeExternalUrl,
  nextAvailableDownloadPath,
  normalizeServerOrigin,
  safeDownloadFilename
};
