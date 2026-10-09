"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { writeAtomicJson } = require("./desktop-state.cjs");

const MAX_TEXT = 128_000;
const MAX_ENTRIES = 40;
const MAX_FILE_BYTES = 5_300_000;
const MAX_AGE_MS = 30 * 86400_000;
const IDENTIFIER = /^[a-f0-9-]{8,64}$/i;
const SCOPE = /^(?:new-chat|(?:chat|project):[a-f0-9-]{8,64})$/i;
const SENSITIVE = /(?:\bBearer\s+\S+|(?:\b(?:password|passwd|api[_-]?key|access[_-]?token|secret)|пароль)\s*[:=]\s*\S+|(?:ghp_|gho_|ghu_|ghs_|ghr_|github_pat_|sk-[a-z0-9_-]{12,})\S*|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/i;

function validIdentity(ownerId, origin) {
  if (typeof ownerId !== "string" || !IDENTIFIER.test(ownerId)) throw new Error("Нет подтверждённого пользователя.");
  if (typeof origin !== "string" || !/^https?:\/\/[a-z0-9.:[\]-]+$/i.test(origin)) throw new Error("Недопустимый сервер.");
}

function validateDraft(scope, text) {
  if (typeof scope !== "string" || !SCOPE.test(scope)) throw new Error("Недопустимая область черновика.");
  if (typeof text !== "string" || text.length > MAX_TEXT) throw new Error("Текст черновика превышает лимит 128 000 символов.");
  if (SENSITIVE.test(text)) throw new Error("Черновик похож на пароль или ключ доступа. Локальное сохранение отключено для этого текста.");
}

function filename(ownerId, origin) {
  validIdentity(ownerId, origin);
  return crypto.createHash("sha256").update(origin + "\0" + ownerId).digest("hex") + ".json";
}

function createDraftStore(userData, { now = () => Date.now(), codec } = {}) {
  if (!codec || typeof codec.seal !== "function" || typeof codec.open !== "function")
    throw new Error("Для локальных черновиков требуется защищённое хранилище Windows.");
  const directory = path.join(userData, "desktop-text-drafts-v1");
  function target(ownerId, origin) { return path.join(directory, filename(ownerId, origin)); }
  function read(ownerId, origin) {
    let records = {};
    try {
      const file = target(ownerId, origin);
      if (fs.statSync(file).size > MAX_FILE_BYTES) return records;
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      if (data?.version !== 1 || !data.records || typeof data.records !== "object") return records;
      for (const [scope, entry] of Object.entries(data.records)) {
        if (!SCOPE.test(scope) || typeof entry?.sealed !== "string" || entry.sealed.length > 400000 ||
            !Number.isSafeInteger(entry.savedAt) || entry.savedAt > now() || now() - entry.savedAt > MAX_AGE_MS) continue;
        try {
          const text = codec.open(entry.sealed);
          validateDraft(scope, text);
          records[scope] = { text, savedAt: entry.savedAt };
        } catch { /* Incorrect OS user / tampered ciphertext: never recover. */ }
      }
    } catch { /* Absent or corrupt draft file: fail closed. */ }
    return records;
  }
  function write(ownerId, origin, records) {
    const ordered = Object.entries(records).sort((a, b) => b[1].savedAt - a[1].savedAt).slice(0, MAX_ENTRIES);
    const file = target(ownerId, origin);
    if (!ordered.length) { try { fs.unlinkSync(file); } catch { /* absent */ } return; }
    const sealed = {};
    let occupied = 64;
    for (const [scope, entry] of ordered) {
      const payload = { savedAt: entry.savedAt, sealed: codec.seal(entry.text) };
      const size = Buffer.byteLength(JSON.stringify({ [scope]: payload }), "utf8") + 4;
      if (occupied + size > MAX_FILE_BYTES) continue; // keep newest bounded records
      sealed[scope] = payload;
      occupied += size;
    }
    if (!Object.keys(sealed).length) throw new Error("Недостаточно места для защищённого черновика.");
    writeAtomicJson(file, { version: 1, records: sealed });
  }
  return {
    load(ownerId, origin, scope) {
      validateDraft(scope, "");
      return read(ownerId, origin)[scope]?.text ?? "";
    },
    save(ownerId, origin, scope, text) {
      validateDraft(scope, text);
      const records = read(ownerId, origin);
      if (text) records[scope] = { text, savedAt: now() }; else delete records[scope];
      write(ownerId, origin, records);
      return { ok: true };
    },
    clearScope(ownerId, origin, scope) {
      validateDraft(scope, "");
      const records = read(ownerId, origin);
      delete records[scope];
      write(ownerId, origin, records);
    },
    clearOwner(ownerId, origin) {
      try { fs.unlinkSync(target(ownerId, origin)); } catch { /* absent */ }
    },
    clearAll() {
      try {
        for (const file of fs.readdirSync(directory)) if (/^[0-9a-f]{64}\.json$/.test(file)) fs.unlinkSync(path.join(directory, file));
      } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
  };
}

function activeOwnerFromSessions(value) {
  if (!value || !Array.isArray(value.items)) return null;
  const current = value.items.filter((item) => item && item.current === true && item.status === "active" && item.actor_kind === "owner" && typeof item.owner_id === "string" && IDENTIFIER.test(item.owner_id));
  return current.length === 1 ? current[0].owner_id : null;
}

module.exports = { createDraftStore, activeOwnerFromSessions, validateDraft, SCOPE };
