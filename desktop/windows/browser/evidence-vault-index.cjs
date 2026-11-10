"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { writeAtomicJson, readJsonFileSafe } = require("../desktop-state.cjs");
const { canonicalizeSourceUrl } = require("./provenance-journal.cjs");

/**
 * Koswork Cross-Session Evidence Vault & Deduplicated Excerpt Index
 * (`desktop/windows/browser/evidence-vault-index.cjs`).
 *
 * Persists verified `(claim -> UTF-16 excerpt -> source snapshot)` triples across
 * research runs in `<workspaceRoot>/.koswork-research/evidence-vault.json`:
 * 1. Prevents redundant re-downloads across related multi-site research runs within
 *    configurable `maxAgeMs` TTL.
 * 2. Verifies that every stored excerpt still matches its recorded UTF-16 code unit
 *    length (`endUtf16 - startUtf16 === quote.length`) before returning it.
 * 3. Supports querying verified evidence by `optionName`, `criterion`, or `canonicalUrl`.
 */
class KosworkBrowserEvidenceVault {
  constructor(options = {}) {
    if (!options.workspaceRoot) {
      throw new Error("EVIDENCE_VAULT_REQUIRES_WORKSPACE_ROOT");
    }
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.vaultDir = path.join(this.workspaceRoot, ".koswork-research");
    fs.mkdirSync(this.vaultDir, { recursive: true });
    this.vaultPath = path.join(this.vaultDir, "evidence-vault.json");
    this.defaultTtlMs = Math.max(1000, Number(options.defaultTtlMs ?? 300_000));
    this.state = this._load();
  }

  _load() {
    const loaded = readJsonFileSafe(this.vaultPath, null);
    if (loaded && Array.isArray(loaded.entries)) {
      return loaded;
    }
    return {
      schemaVersion: "koswork.browser-research.evidence-vault.v1",
      updatedAt: new Date().toISOString(),
      entries: []
    };
  }

  _save() {
    this.state.updatedAt = new Date().toISOString();
    writeAtomicJson(this.vaultPath, this.state);
  }

  ingestVerifiedClaims(claims = [], { sessionId = null, nowMs = Date.now() } = {}) {
    let addedCount = 0;
    let updatedCount = 0;

    for (const c of claims) {
      if (!c || !c.excerpt || !c.source || !c.source.url) continue;
      const quote = String(c.excerpt.quote || "");
      const spanLen = Number(c.excerpt.endUtf16) - Number(c.excerpt.startUtf16);
      if (!quote || spanLen !== quote.length) {
        continue;
      }

      const canonicalUrl = canonicalizeSourceUrl(c.source.url);
      const dedupeKey = `${canonicalUrl}|${c.optionName || ""}|${c.criterion || ""}|${c.excerpt.startUtf16}..${c.excerpt.endUtf16}`;

      const record = {
        dedupeKey,
        sessionId,
        optionName: c.optionName || null,
        criterion: c.criterion || null,
        value: c.value || quote,
        claim: c.claim || quote,
        excerpt: {
          excerptId: c.excerpt.excerptId || `vault-exc-${this.state.entries.length + 1}`,
          quote,
          startUtf16: c.excerpt.startUtf16,
          endUtf16: c.excerpt.endUtf16,
          lengthUtf16: quote.length,
          snapshotSha256: c.excerpt.snapshotSha256 || null
        },
        source: {
          url: c.source.url,
          canonicalUrl,
          title: c.source.title || c.source.url,
          pageDate: c.source.pageDate || null,
          eventDate: c.source.eventDate || null,
          fetchedAt: c.source.fetchedAt || new Date(nowMs).toISOString()
        },
        storedAtMs: nowMs
      };

      const existingIdx = this.state.entries.findIndex((e) => e.dedupeKey === dedupeKey);
      if (existingIdx >= 0) {
        this.state.entries[existingIdx] = record;
        updatedCount += 1;
      } else {
        this.state.entries.push(record);
        addedCount += 1;
      }
    }

    this._save();
    return {
      addedCount,
      updatedCount,
      totalEntries: this.state.entries.length
    };
  }

  queryVerifiedEvidence({
    optionName = null,
    criterion = null,
    url = null,
    maxAgeMs = this.defaultTtlMs,
    nowMs = Date.now()
  } = {}) {
    const targetCanonicalUrl = url ? canonicalizeSourceUrl(url) : null;
    const freshHits = [];
    const staleHits = [];

    for (const entry of this.state.entries) {
      if (
        optionName &&
        String(entry.optionName || "").toLowerCase() !== String(optionName).toLowerCase()
      ) {
        continue;
      }
      if (
        criterion &&
        String(entry.criterion || "").toLowerCase() !== String(criterion).toLowerCase()
      ) {
        continue;
      }
      if (targetCanonicalUrl && entry.source.canonicalUrl !== targetCanonicalUrl) {
        continue;
      }

      // Verify UTF-16 length invariant on read
      const spanLen = Number(entry.excerpt.endUtf16) - Number(entry.excerpt.startUtf16);
      if (spanLen !== entry.excerpt.quote.length) {
        continue;
      }

      const ageMs = Math.max(0, nowMs - Number(entry.storedAtMs || 0));
      if (ageMs <= maxAgeMs) {
        freshHits.push({ ...entry, ageMs, fresh: true });
      } else {
        staleHits.push({ ...entry, ageMs, fresh: false });
      }
    }

    return {
      freshCount: freshHits.length,
      staleCount: staleHits.length,
      freshHits,
      staleHits
    };
  }

  clearVault() {
    this.state.entries = [];
    this._save();
    return { cleared: true };
  }
}

module.exports = {
  KosworkBrowserEvidenceVault
};
