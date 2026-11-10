"use strict";

const path = require("node:path");
const crypto = require("node:crypto");
const { readJsonFileSafe, writeAtomicJson } = require("../desktop-state.cjs");

const TRACKING_QUERY_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "fbclid",
  "gclid",
  "yclid",
  "ysclid",
  "mc_cid",
  "mc_eid",
  "ref",
  "_ga",
  "_gl",
  "ref_src"
]);

/**
 * Normalizes a source URL for provenance deduplication while preserving all meaningful
 * document parameters (`id`, `page`, `q`, `section`, `version`, etc.) and stripping
 * only known advertising/tracking parameters.
 */
function canonicalizeSourceUrl(rawUrl) {
  const input = String(rawUrl || "").trim();
  if (!input) return "";
  if (/^koswork:\/\//i.test(input)) return input;

  try {
    const parsed = new URL(input);
    parsed.hash = "";
    const keysToDelete = [];
    for (const key of parsed.searchParams.keys()) {
      if (TRACKING_QUERY_PARAMS.has(key.toLowerCase())) {
        keysToDelete.push(key);
      }
    }
    for (const k of keysToDelete) {
      parsed.searchParams.delete(k);
    }
    parsed.searchParams.sort();
    return parsed.toString();
  } catch {
    return input;
  }
}

/**
 * Durable Research Provenance Journal (`desktop/windows/browser/provenance-journal.cjs`).
 *
 * Persists the verifiable chain:
 * `searchQuery (providerId) -> openedSource (url, canonicalUrl, title, pageDate, eventDate, fetchedAt) -> excerpt (startUtf16..endUtf16, quoteSha256)`
 */
class KosworkResearchProvenanceJournal {
  constructor(options = {}) {
    this.journalFilePath = options.journalFilePath
      ? path.resolve(String(options.journalFilePath))
      : null;
    this.searches = [];
    this.sources = new Map(); // sourceKey -> sourceEntry
    this.excerpts = new Map(); // excerptId -> excerptEntry

    if (this.journalFilePath) {
      this.loadFromDisk();
    }
  }

  loadFromDisk() {
    if (!this.journalFilePath) return false;
    const saved = readJsonFileSafe(this.journalFilePath, null);
    if (!saved || typeof saved !== "object") return false;

    if (Array.isArray(saved.searches)) {
      this.searches = saved.searches;
    }
    if (Array.isArray(saved.sources)) {
      for (const s of saved.sources) {
        if (s && s.sourceKey) {
          this.sources.set(s.sourceKey, s);
        }
      }
    }
    if (Array.isArray(saved.excerpts)) {
      for (const e of saved.excerpts) {
        if (e && e.excerptId) {
          this.excerpts.set(e.excerptId, e);
        }
      }
    }
    return true;
  }

  flushToDisk() {
    if (!this.journalFilePath) return null;
    const payload = {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      searches: this.searches.slice(-200),
      sources: Array.from(this.sources.values()),
      excerpts: Array.from(this.excerpts.values())
    };
    return writeAtomicJson(this.journalFilePath, payload);
  }

  recordSearch(searchEntry = {}) {
    const record = {
      searchId: String(searchEntry.searchId || `srch-${Date.now()}`),
      query: String(searchEntry.query || ""),
      providerId: String(searchEntry.providerId || "unknown"),
      providerEndpoint: String(searchEntry.providerEndpoint || ""),
      actor: searchEntry.actor === "user" ? "user" : "agent",
      totalResults: Number(searchEntry.totalResults ?? 0),
      searchedAt: searchEntry.searchedAt || new Date().toISOString()
    };
    this.searches.push(record);
    this.flushToDisk();
    return record;
  }

  recordSourceOpen(source = {}) {
    const url = String(source.url || "");
    const canonicalUrl = canonicalizeSourceUrl(source.canonicalUrl || url);
    const sourceKey = `${canonicalUrl}#v${source.pageVersion ?? 1}`;
    const existing = this.sources.get(sourceKey);

    const entry = {
      sourceKey,
      url,
      canonicalUrl,
      title: String(source.title || url),
      httpStatus: Number(source.httpStatus ?? 200),
      available: Boolean(source.available !== false),
      pageVersion: Number(source.pageVersion ?? 1),
      snapshotId: source.snapshotId || null,
      tabReceiptId: source.tabReceiptId || null,
      pageDate: source.pageDate || null,
      eventDate: source.eventDate || null,
      fetchedAt: source.fetchedAt || new Date().toISOString(),
      searchId: source.searchId || existing?.searchId || null,
      serpRank: source.serpRank ?? existing?.serpRank ?? null,
      excerptIds: existing ? Array.from(new Set(existing.excerptIds)) : []
    };

    this.sources.set(sourceKey, entry);
    this.flushToDisk();
    return entry;
  }

  recordExcerpt(excerpt = {}) {
    if (!excerpt || !excerpt.excerptId) return null;
    const canonicalUrl = canonicalizeSourceUrl(excerpt.canonicalUrl || excerpt.url);
    const sourceKey = `${canonicalUrl}#v${excerpt.pageVersion ?? 1}`;

    const entry = {
      excerptId: excerpt.excerptId,
      sourceKey,
      snapshotId: excerpt.snapshotId || null,
      tabReceiptId: excerpt.tabReceiptId || null,
      pageVersion: Number(excerpt.pageVersion ?? 1),
      url: excerpt.url,
      canonicalUrl,
      title: excerpt.title || "",
      pageDate: excerpt.pageDate || null,
      eventDate: excerpt.eventDate || null,
      fetchedAt: excerpt.fetchedAt || null,
      startUtf16: excerpt.startUtf16,
      endUtf16: excerpt.endUtf16,
      lengthUtf16: excerpt.lengthUtf16,
      quote: excerpt.quote,
      quoteSha256:
        excerpt.quoteSha256 ||
        crypto.createHash("sha256").update(String(excerpt.quote || ""), "utf8").digest("hex")
    };

    this.excerpts.set(entry.excerptId, entry);
    const sourceEntry = this.sources.get(sourceKey);
    if (sourceEntry && !sourceEntry.excerptIds.includes(entry.excerptId)) {
      sourceEntry.excerptIds.push(entry.excerptId);
    }
    this.flushToDisk();
    return entry;
  }

  getProvenanceSummary() {
    return {
      totalSearches: this.searches.length,
      totalSources: this.sources.size,
      totalExcerpts: this.excerpts.size,
      searches: [...this.searches],
      sources: Array.from(this.sources.values()),
      excerpts: Array.from(this.excerpts.values())
    };
  }
}

module.exports = {
  KosworkResearchProvenanceJournal,
  canonicalizeSourceUrl
};
