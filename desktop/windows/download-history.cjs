"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { safeDownloadFilename } = require("./connection-policy.cjs");

const STATES = new Set(["active", "completed", "cancelled", "interrupted"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SCOPE = /^[0-9a-f]{64}$/;
const MAX_ENTRIES = 50;
const MAX_FILE_SIZE = 131072;

function downloadScope(origin, owner) {
  if (typeof origin !== "string" || !/^https?:\/\//.test(origin) ||
      typeof owner !== "string" || owner.length === 0 || owner.length > 512)
    throw new TypeError("A verified server origin and owner are required.");
  return crypto.createHash("sha256").update(`${origin}\0${owner}`).digest("hex");
}

function bytes(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
function totalBytes(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
function safeRecordName(value) {
  const raw = typeof value === "string" ? value : "";
  // A server-supplied Content-Disposition filename may itself encode a URL or credential.
  // Prefer a generic name rather than persist a likely query string or bearer token.
  if (/https?:\/\/|[?&#]|(?:access[_-]?token|id[_-]?token|api[_-]?key|authorization|auth|session)[=:]/i.test(raw))
    return "cosmora-download";
  return safeDownloadFilename(raw);
}
function cleanEntry(value) {
  if (!value || typeof value !== "object" || !UUID.test(value.id) ||
      !SCOPE.test(value.scope) || !STATES.has(value.status) ||
      typeof value.name !== "string" || value.name.length > 180 ||
      !Number.isSafeInteger(value.startedAt) || value.startedAt < 0) return null;
  const name = safeRecordName(value.name);
  if (name !== value.name) return null;
  const savePath = typeof value.savePath === "string" && value.savePath.length <= 4096 &&
    path.isAbsolute(value.savePath) && !value.savePath.includes("\0") ? value.savePath : null;
  return {
    id: value.id, scope: value.scope, name, status: value.status,
    receivedBytes: bytes(value.receivedBytes), totalBytes: totalBytes(value.totalBytes),
    startedAt: value.startedAt,
    finishedAt: Number.isSafeInteger(value.finishedAt) && value.finishedAt >= 0 ? value.finishedAt : null,
    savePath: value.status === "completed" ? savePath : null
  };
}
function publicEntry(entry) {
  const { id, name, status, receivedBytes, totalBytes, startedAt, finishedAt } = entry;
  return { id, name, status, receivedBytes, totalBytes, startedAt, finishedAt };
}
function createDownloadHistoryStore(directory) {
  const filename = path.join(directory, "download-history.json");
  let records = [];
  try {
    if (fs.statSync(filename).size <= MAX_FILE_SIZE) {
      const parsed = JSON.parse(fs.readFileSync(filename, "utf8"));
      if (parsed?.version === 1 && Array.isArray(parsed.records))
        records = parsed.records.slice(0, MAX_ENTRIES).map(cleanEntry).filter(Boolean);
    }
  } catch { /* Missing or invalid metadata must never enable a download or reveal a file. */ }
  const seen = new Set();
  records = records.filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    if (entry.status === "active") {
      entry.status = "interrupted";
      entry.finishedAt = Date.now();
      entry.savePath = null;
    }
    if (entry.status === "completed" && !entry.savePath) {
      entry.status = "interrupted";
      entry.finishedAt = Date.now();
    }
    return true;
  });
  const save = () => {
    fs.mkdirSync(directory, { recursive: true });
    const temp = `${filename}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temp, JSON.stringify({ version: 1, records }) + "\n", {
        mode: 0o600, encoding: "utf8", flag: "w"
      });
      fs.renameSync(temp, filename);
    } finally { try { fs.unlinkSync(temp); } catch { /* renamed */ } }
  };
  // Durable recovery: even an otherwise idle next process records a crash/interruption.
  save();
  const find = (scope, id) => records.find((e) => e.scope === scope && e.id === id);
  const bounded = () => {
    while (records.length > MAX_ENTRIES) {
      const index = records.findLastIndex((e) => e.status !== "active");
      if (index === -1) return false;
      records.splice(index, 1);
    }
    return true;
  };
  return {
    list(scope) {
      if (!SCOPE.test(scope)) return [];
      return records.filter((e) => e.scope === scope).map(publicEntry);
    },
    start(scope, id, name, received = 0, total = null) {
      if (!SCOPE.test(scope) || !UUID.test(id) || find(scope, id) ||
          records.filter((e) => e.status === "active").length >= MAX_ENTRIES) return false;
      records.unshift({ id, scope, name: safeRecordName(name), status: "active",
        receivedBytes: bytes(received), totalBytes: totalBytes(total),
        startedAt: Date.now(), finishedAt: null, savePath: null });
      bounded();
      save();
      return true;
    },
    progress(scope, id, received, total) {
      const record = find(scope, id);
      if (!record || record.status !== "active") return false;
      record.receivedBytes = Math.max(record.receivedBytes, bytes(received));
      record.totalBytes = totalBytes(total);
      save();
      return true;
    },
    finish(scope, id, status, received, total, savePath = null) {
      const record = find(scope, id);
      if (!record || record.status !== "active" || !STATES.has(status) || status === "active") return false;
      record.receivedBytes = Math.max(record.receivedBytes, bytes(received));
      record.totalBytes = totalBytes(total);
      const validPath = typeof savePath === "string" && path.isAbsolute(savePath) &&
        savePath.length <= 4096 && !savePath.includes("\0") ? savePath : null;
      record.status = status === "completed" && !validPath ? "interrupted" : status;
      record.savePath = record.status === "completed" ? validPath : null;
      record.finishedAt = Date.now();
      save();
      return true;
    },
    savedPath(scope, id) {
      const record = find(scope, id);
      return record?.status === "completed" ? record.savePath : null;
    },
    clearFinished(scope) {
      records = records.filter((e) => e.scope !== scope || e.status === "active");
      save();
    },
    forgetScope(scope) {
      records = records.filter((e) => e.scope !== scope);
      save();
    }
  };
}

module.exports = { MAX_ENTRIES, createDownloadHistoryStore, downloadScope };
