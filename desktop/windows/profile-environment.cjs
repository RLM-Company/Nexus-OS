"use strict";

const fs = require("node:fs");
const path = require("node:path");

// Startup-time diagnostics for the application profile. This module never
// migrates, moves or rewrites anything: it only reports what the profile
// directory supports so the shell can show a working window or an explicit
// recovery message. Path guards, reparse/junction checks and sandboxing inside
// the workspace belong to workspace/path-guard.cjs and stay untouched.
const PROBE_NAME = "profile-write-probe";

function segmentsOf(directory) {
  return path
    .normalize(String(directory || ""))
    .replace(/[\\/]+/g, "/")
    .toLowerCase()
    .split("/")
    .filter(Boolean);
}

function isRedirectedDirectory(directory) {
  const segments = segmentsOf(directory);
  const packages = segments.indexOf("packages");
  if (packages < 0) return false;
  return segments.slice(packages + 1).some((value) => value === "localcache");
}

function evaluateProfile(profileDirectory) {
  const redirected = isRedirectedDirectory(profileDirectory);
  const result = {
    profileDirectory: String(profileDirectory || ""),
    redirected,
    writable: false,
    ok: false,
    reason: ""
  };
  try {
    fs.mkdirSync(profileDirectory, { recursive: true });
  } catch {
    result.reason =
      "Каталог профиля приложения недоступен: операционная система не дала создать каталог.";
    return result;
  }
  const probe = path.join(profileDirectory, `${PROBE_NAME}-${process.pid}`);
  let opened;
  try {
    opened = fs.openSync(probe, "wx", 0o600);
    fs.writeFileSync(opened, "probe");
  } catch {
    if (opened !== undefined)
      try {
        fs.closeSync(opened);
      } catch {
        /* already closed */
      }
    result.reason =
      "Каталог профиля приложения не позволяет запись. Настройки и подключение не могут сохраняться.";
    return result;
  } finally {
    try {
      if (opened !== undefined) fs.closeSync(opened);
    } catch {
      /* already closed */
    }
    try {
      fs.unlinkSync(probe);
    } catch {
      /* probe could not be created */
    }
  }
  result.writable = true;
  result.ok = true;
  if (redirected) {
    // Explanatory, not blocking: the relocated profile is supported as-is.
    result.reason =
      "Приложение запущено в упакованной среде Windows (MSIX): профиль размещён в изолированном каталоге LocalCache. Существующие данные не переносятся.";
  }
  return result;
}

function profileStatusText(status) {
  if (!status || typeof status !== "object") return "Состояние профиля неизвестно.";
  const lines = [];
  if (status.profileDirectory) lines.push(`Профиль: ${status.profileDirectory}`);
  if (status.redirected) lines.push("Профиль перенаправлен упакованной средой (MSIX/LocalCache).");
  if (status.ok) {
    lines.push("Каталог профиля доступен для записи; настройки сохраняются обычным образом.");
    if (status.reason) lines.push(status.reason);
  } else if (status.reason) {
    lines.push(`Профиль недоступен: ${status.reason}`);
  }
  if (Array.isArray(status.faults) && status.faults.length)
    for (const fault of status.faults)
      lines.push(
        typeof fault === "string" && fault
          ? `Дополнительная проблема: ${fault}`
          : "Дополнительная проблема зафиксирована."
      );
  return lines.join("\n");
}

module.exports = { evaluateProfile, isRedirectedDirectory, profileStatusText };
