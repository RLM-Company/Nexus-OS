"use strict";

const path = require("node:path");

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

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

function safeDownloadFilename(value) {
  const fallback = "cosmora-result";
  const source = typeof value === "string" && value.trim() ? value.trim() : fallback;
  const cleaned = source
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 180);
  return cleaned || fallback;
}

function nextAvailableDownloadPath(directory, filename, existsSync) {
  const safe = safeDownloadFilename(filename);
  const extension = path.extname(safe);
  const stem = extension ? safe.slice(0, -extension.length) : safe;
  let candidate = path.join(directory, safe);
  let suffix = 1;

  while (existsSync(candidate)) {
    candidate = path.join(directory, `${stem} (${suffix})${extension}`);
    suffix += 1;
  }

  return candidate;
}

module.exports = {
  isAllowedRemoteNavigation,
  nextAvailableDownloadPath,
  normalizeServerOrigin,
  safeDownloadFilename
};
