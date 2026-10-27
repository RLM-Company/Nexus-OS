"use strict";

const crypto = require("node:crypto");

const MAX_INSTALLER_BYTES = 300 * 1024 * 1024;
const MANIFEST_PATH = "/.well-known/kosmora/windows-update.json";

function canonicalJson(value) {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value))
  )
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype)
    throw new Error("Invalid signed data");
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function compareVersions(a, b) {
  if (!/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(a) || !/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(b))
    throw new Error("Invalid version");
  const av = a.split(".").map(Number);
  const bv = b.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (av[index] !== bv[index]) return Math.sign(av[index] - bv[index]);
  }
  return 0;
}

function validateSignedManifest(document, { publicKeyPem, origin, now = Date.now() }) {
  if (!publicKeyPem || typeof publicKeyPem !== "string")
    throw new Error("Ключ проверки релизов не настроен. Обновления отключены.");
  if (!document || typeof document !== "object" || Array.isArray(document))
    throw new Error("Неверный манифест обновления.");
  const { signature, ...payload } = document;
  const required = [
    "schemaVersion",
    "version",
    "platform",
    "arch",
    "assetPath",
    "sha256",
    "size",
    "expiresAt"
  ];
  if (Object.keys(payload).sort().join() !== required.sort().join())
    throw new Error("Неизвестные поля манифеста.");
  if (payload.schemaVersion !== 1 || payload.platform !== "win32" || payload.arch !== "x64")
    throw new Error("Неподдерживаемый релиз.");
  compareVersions(payload.version, "0.0.0");
  if (typeof payload.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(payload.sha256))
    throw new Error("Неверный SHA-256 релиза.");
  if (!Number.isSafeInteger(payload.size) || payload.size < 1 || payload.size > MAX_INSTALLER_BYTES)
    throw new Error("Неверный размер релиза.");
  if (
    typeof payload.expiresAt !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(payload.expiresAt) ||
    !Number.isFinite(Date.parse(payload.expiresAt)) ||
    Date.parse(payload.expiresAt) <= now
  )
    throw new Error("Манифест обновления просрочен.");
  if (typeof signature !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(signature))
    throw new Error("Отсутствует подпись релиза.");
  let url;
  try {
    url = new URL(payload.assetPath, origin);
  } catch {
    throw new Error("Неверный URL релиза.");
  }
  if (
    !payload.assetPath.startsWith("/") ||
    payload.assetPath.startsWith("//") ||
    !url.pathname.toLowerCase().endsWith(".exe") ||
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    url.origin !== origin
  )
    throw new Error("Релиз должен находиться на том же сервере.");
  let key;
  try {
    key = crypto.createPublicKey(publicKeyPem);
  } catch {
    throw new Error("Неверный закреплённый ключ релизов.");
  }
  if (
    key.asymmetricKeyType !== "ed25519" ||
    !crypto.verify(null, Buffer.from(canonicalJson(payload)), key, Buffer.from(signature, "base64"))
  )
    throw new Error("Подпись релиза недействительна.");
  return { ...payload, assetUrl: url.toString() };
}

module.exports = {
  canonicalJson,
  compareVersions,
  validateSignedManifest,
  MANIFEST_PATH,
  MAX_INSTALLER_BYTES
};
