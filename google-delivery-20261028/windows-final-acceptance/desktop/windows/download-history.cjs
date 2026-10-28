"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { safeDownloadFilename } = require("./connection-policy.cjs");
const { writeAtomicJson } = require("./desktop-state.cjs");

const FILE_NAME = "download-history.json";
const MAX_ENTRIES = 50;
const MAX_FILE_SIZE = 131072;
const SCOPE = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUS = new Set(["active", "completed", "cancelled", "interrupted"]);

function cleanBytes(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function cleanTotal(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function validPath(value) {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= 520 &&
    path.isAbsolute(value) &&
    !value.includes("\0")
    ? value
    : null;
}

function validIso(value) {
  return typeof value === "string" &&
    value.length <= 40 &&
    Number.isFinite(Date.parse(value))
    ? value
    : null;
}

function sanitizeRecord(item) {
  if (!item || typeof item !== "object") return null;
  if (!UUID.test(item.id) || !SCOPE.test(item.scope) || !STATUS.has(item.status)) return null;
  const startedAt = validIso(item.startedAt);
  if (!startedAt) return null;
  let status = item.status === "active" ? "interrupted" : item.status;
  let savePath = status === "completed" ? validPath(item.savePath) : null;
  if (status === "completed" && !savePath) {
    status = "interrupted";
  }
  const finishedAt =
    status === "active" ? null : validIso(item.finishedAt) || new Date().toISOString();
  return {
    id: item.id.toLowerCase(),
    scope: item.scope,
    name: safeDownloadFilename(item.name),
    status,
    receivedBytes: cleanBytes(item.receivedBytes),
    totalBytes: cleanTotal(item.totalBytes),
    startedAt,
    finishedAt,
    savePath
  };
}

function publicEntry(entry) {
  return {
    id: entry.id,
    name: entry.name,
    status: entry.status,
    receivedBytes: entry.receivedBytes,
    totalBytes: entry.totalBytes,
    startedAt: entry.startedAt,
    finishedAt: entry.finishedAt
  };
}

function createDownloadHistoryStore(profileDirectory) {
  const filePath = path.join(profileDirectory, FILE_NAME);
  let records = [];

  function save() {
    try {
      writeAtomicJson(filePath, { version: 1, records });
    } catch {
      /* never crash the shell on history I/O */
    }
  }

  function loadInitial() {
    let hadFile = false;
    try {
      const stat = fs.statSync(filePath);
      hadFile = true;
      if (!stat.isFile() || stat.size > MAX_FILE_SIZE) {
        records = [];
        save();
        return;
      }
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (parsed?.version !== 1 || !Array.isArray(parsed.records)) {
        records = [];
        save();
        return;
      }
      const seen = new Set();
      const cleaned = [];
      for (const raw of parsed.records) {
        const record = sanitizeRecord(raw);
        if (!record) continue;
        const key = `${record.scope}:${record.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        cleaned.push(record);
        if (cleaned.length >= MAX_ENTRIES) break;
      }
      records = cleaned;
      save();
    } catch {
      records = [];
      if (hadFile) save();
    }
  }

  loadInitial();

  function find(scope, id) {
    if (!SCOPE.test(scope) || typeof id !== "string" || !UUID.test(id)) return null;
    const normalizedId = id.toLowerCase();
    return records.find((entry) => entry.scope === scope && entry.id === normalizedId) || null;
  }

  function start(scope, id, name, received = 0, total = null) {
    if (!SCOPE.test(scope) || typeof id !== "string" || !UUID.test(id) || find(scope, id))
      return false;
    while (records.length >= MAX_ENTRIES) {
      let removableIndex = -1;
      for (let idx = records.length - 1; idx >= 0; idx -= 1) {
        if (records[idx].status !== "active") {
          removableIndex = idx;
          break;
        }
      }
      if (removableIndex === -1) return false;
      records.splice(removableIndex, 1);
    }
    records.unshift({
      id: id.toLowerCase(),
      scope,
      name: safeDownloadFilename(name),
      status: "active",
      receivedBytes: cleanBytes(received),
      totalBytes: cleanTotal(total),
      startedAt: new Date().toISOString(),
      finishedAt: null,
      savePath: null
    });
    save();
    return true;
  }

  function progress(scope, id, received, total) {
    const entry = find(scope, id);
    if (!entry || entry.status !== "active") return false;
    entry.receivedBytes = cleanBytes(received);
    const cleanedTotal = cleanTotal(total);
    if (cleanedTotal !== null) entry.totalBytes = cleanedTotal;
    return true;
  }

  function finish(scope, id, state, received, total, savePath) {
    const entry = find(scope, id);
    if (!entry) return false;
    entry.status =
      state === "completed" ? "completed" : state === "cancelled" ? "cancelled" : "interrupted";
    entry.receivedBytes = cleanBytes(received);
    const cleanedTotal = cleanTotal(total);
    if (cleanedTotal !== null) entry.totalBytes = cleanedTotal;
    entry.finishedAt = new Date().toISOString();
    entry.savePath = entry.status === "completed" ? validPath(savePath) : null;
    if (entry.status === "completed" && !entry.savePath) {
      entry.status = "interrupted";
    }
    save();
    return true;
  }

  function list(scope) {
    if (!SCOPE.test(scope)) return [];
    return records.filter((entry) => entry.scope === scope).map(publicEntry);
  }

  function resolvePath(scope, id) {
    const entry = find(scope, id);
    if (!entry || entry.status !== "completed" || !entry.savePath) return null;
    return entry.savePath;
  }

  function remove(scope, id) {
    const entry = find(scope, id);
    if (!entry || entry.status === "active") return false;
    records = records.filter((item) => item !== entry);
    save();
    return true;
  }

  function clearCompleted(scope) {
    if (!SCOPE.test(scope)) return false;
    records = records.filter((entry) => entry.scope !== scope || entry.status === "active");
    save();
    return true;
  }

  function clearScope(scope) {
    if (!SCOPE.test(scope)) return false;
    records = records.filter((entry) => entry.scope !== scope);
    save();
    return true;
  }

  function clearAll() {
    records = [];
    save();
  }

  return {
    start,
    progress,
    finish,
    list,
    resolvePath,
    remove,
    clearCompleted,
    clearScope,
    clearAll
  };
}

module.exports = {
  createDownloadHistoryStore,
  MAX_ENTRIES
};
