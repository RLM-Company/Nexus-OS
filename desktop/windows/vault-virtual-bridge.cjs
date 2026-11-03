"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { extractVaultDocument } = require("./vault-document-extractor.cjs");

const MAX_UTF16_SLICE_UNITS = 6000;
const MAX_SERIALIZED_RESPONSE_BYTES = 24000;
const DEFAULT_GRANT_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Slices a string by UTF-16 code units (`offset`, `maxUnits <= 6000`) while guaranteeing
 * that surrogate pairs (`0xD800..0xDBFF` followed by `0xDC00..0xDFFF`) are NEVER split
 * at the start or end boundary (as required by PR #421 `KOSWORK_VAULT_AGENT_SEARCH_2026-10-31_RU.md`).
 */
function sliceUtf16SurrogateSafe(text, rawOffset = 0, rawMaxUnits = MAX_UTF16_SLICE_UNITS) {
  const str = String(text ?? "");
  const len = str.length;
  if (len === 0) {
    return { slice: "", startOffset: 0, endOffset: 0, nextOffset: null, totalUnits: 0 };
  }

  let start = Math.max(0, Math.min(Number(rawOffset) || 0, len));
  const maxUnits = Math.max(2, Math.min(Number(rawMaxUnits) || MAX_UTF16_SLICE_UNITS, MAX_UTF16_SLICE_UNITS));

  // If `start` lands on a low surrogate (0xDC00..0xDFFF) preceded by a high surrogate, step back 1 unit
  if (start > 0 && start < len) {
    const code = str.charCodeAt(start);
    const prev = str.charCodeAt(start - 1);
    if (code >= 0xdc00 && code <= 0xdfff && prev >= 0xd800 && prev <= 0xdbff) {
      start -= 1;
    }
  }

  let end = Math.min(start + maxUnits, len);
  // If `end - 1` lands on a high surrogate (0xD800..0xDBFF) that has a matching low surrogate at `end`, step back 1 unit
  if (end > start && end < len) {
    const lastCode = str.charCodeAt(end - 1);
    const nextCode = str.charCodeAt(end);
    if (lastCode >= 0xd800 && lastCode <= 0xdbff && nextCode >= 0xdc00 && nextCode <= 0xdfff) {
      end -= 1;
    }
  }

  return {
    slice: str.slice(start, end),
    startOffset: start,
    endOffset: end,
    nextOffset: end < len ? end : null,
    totalUnits: len
  };
}

/**
 * Parses a virtual `.kosmora-vault/<SHA256>/<offset>` URI into its components.
 */
function parseVirtualVaultUri(uri) {
  const clean = String(uri ?? "").trim().replace(/^\/+/, "");
  const match = /^\.kosmora-vault\/([a-f0-9]{64})(?:\/(\d+))?$/i.exec(clean);
  if (!match) {
    const err = new Error(`INVALID_VIRTUAL_VAULT_URI: "${uri}"`);
    err.code = "INVALID_VIRTUAL_VAULT_URI";
    throw err;
  }
  return {
    sha256: match[1].toLowerCase(),
    offset: match[2] !== undefined ? Number.parseInt(match[2], 10) : 0
  };
}

/**
 * Coordinates task-scoped `.kosmora-vault` read-only grants alongside regular Koswork workspace folders,
 * supporting binary Office/PDF extraction, surrogate-safe `.kosmora-vault/<SHA256>/<offset>` reads,
 * strict serialized response size guards, and preservation of vault grants when switching workspace folders.
 */
class VaultVirtualBridge {
  constructor(options = {}) {
    this.maxSerializedBytes = options.maxSerializedBytes ?? MAX_SERIALIZED_RESPONSE_BYTES;
    this.filesBySha256 = new Map();
    this.taskGrants = new Map();
    this.activeWorkspaceFolder = null;
  }

  indexVaultDirectory(vaultRootPath) {
    const resolvedRoot = path.resolve(vaultRootPath);
    if (!fs.existsSync(resolvedRoot)) {
      throw new Error("VAULT_ROOT_NOT_FOUND");
    }

    this.filesBySha256.clear();
    const entries = fs.readdirSync(resolvedRoot, { withFileTypes: true });
    let indexedCount = 0;

    for (const entry of entries) {
      if (indexedCount >= 500) break;
      if (!entry.isFile() || entry.isSymbolicLink()) continue;

      const fullPath = path.join(resolvedRoot, entry.name);
      const rawBuf = fs.readFileSync(fullPath);
      if (rawBuf.byteLength === 0 || rawBuf.byteLength > 10 * 1024 * 1024) continue;

      const sha256 = crypto.createHash("sha256").update(rawBuf).digest("hex");
      const ext = path.extname(entry.name).toLowerCase().replace(/^\./, "");

      let extractedText = "";
      let format = ext || "txt";

      if (["pdf", "docx", "xlsx", "pptx"].includes(ext)) {
        const doc = extractVaultDocument(rawBuf, { filename: entry.name });
        extractedText = doc.text;
        format = doc.format;
      } else {
        // Reject raw binary files with NUL bytes unless they are supported Office/PDF formats
        if (rawBuf.includes(0x00)) continue;
        extractedText = rawBuf.toString("utf8");
      }

      this.filesBySha256.set(sha256, {
        sha256,
        filename: entry.name,
        format,
        sizeBytes: rawBuf.byteLength,
        text: extractedText,
        utf16Units: extractedText.length
      });
      indexedCount++;
    }

    return { indexedCount };
  }

  issueTaskScopedGrant(taskId, options = {}) {
    const now = options.nowMs ?? Date.now();
    const ttlMs = options.ttlMs ?? DEFAULT_GRANT_TTL_MS;
    const preserveAcrossWorkspaceSwitch = Boolean(options.preserveAcrossWorkspaceSwitch ?? true);

    const grant = {
      taskId: String(taskId),
      issuedAtMs: now,
      expiresAtMs: now + ttlMs,
      preserveAcrossWorkspaceSwitch,
      revoked: false
    };
    this.taskGrants.set(String(taskId), grant);
    return grant;
  }

  connectRegularWorkspaceFolder(folderPath, options = {}) {
    this.activeWorkspaceFolder = path.resolve(folderPath);
    const revokeVaultGrants = Boolean(options.revokeVaultGrants ?? false);
    if (revokeVaultGrants) {
      for (const grant of this.taskGrants.values()) {
        if (!grant.preserveAcrossWorkspaceSwitch) {
          grant.revoked = true;
        }
      }
    }
    return {
      activeWorkspaceFolder: this.activeWorkspaceFolder,
      activeVaultGrants: Array.from(this.taskGrants.values()).filter((g) => !g.revoked).length
    };
  }

   assertValidTaskGrant(taskId, nowMs = Date.now()) {
    const grant = this.taskGrants.get(String(taskId));
    if (!grant || grant.revoked) {
      const err = new Error("VAULT_TASK_GRANT_REVOKED_OR_MISSING");
      err.code = "VAULT_TASK_GRANT_REVOKED_OR_MISSING";
      throw err;
    }
    if (nowMs > grant.expiresAtMs) {
      const err = new Error("VAULT_TASK_GRANT_EXPIRED");
      err.code = "VAULT_TASK_GRANT_EXPIRED";
      throw err;
    }
    return grant;
  }

  readVirtualUri(taskId, uri, options = {}) {
    this.assertValidTaskGrant(taskId, options.nowMs);
    const { sha256, offset } = parseVirtualVaultUri(uri);
    const record = this.filesBySha256.get(sha256);
    if (!record) {
      const err = new Error(`VAULT_ENTRY_NOT_FOUND: ${sha256}`);
      err.code = "VAULT_ENTRY_NOT_FOUND";
      throw err;
    }

    const maxUnits = Math.min(options.maxUnits ?? MAX_UTF16_SLICE_UNITS, MAX_UTF16_SLICE_UNITS);
    const sliced = sliceUtf16SurrogateSafe(record.text, offset, maxUnits);

    const payload = {
      uri: `.kosmora-vault/${sha256}/${sliced.startOffset}`,
      nextUri: sliced.nextOffset !== null ? `.kosmora-vault/${sha256}/${sliced.nextOffset}` : null,
      sha256,
      format: record.format,
      startOffset: sliced.startOffset,
      endOffset: sliced.endOffset,
      totalUnits: sliced.totalUnits,
      truncated: sliced.nextOffset !== null,
      content: sliced.slice
    };

    const serializedBytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
    if (serializedBytes > this.maxSerializedBytes) {
      const err = new Error(
        `VAULT_SERIALIZED_RESPONSE_TOO_LARGE: ${serializedBytes} > ${this.maxSerializedBytes}`
      );
      err.code = "VAULT_SERIALIZED_RESPONSE_TOO_LARGE";
      throw err;
    }

    return payload;
  }
}

module.exports = {
   MAX_SERIALIZED_RESPONSE_BYTES,
  MAX_UTF16_SLICE_UNITS,
  VaultVirtualBridge,
  parseVirtualVaultUri,
  sliceUtf16SurrogateSafe
};
