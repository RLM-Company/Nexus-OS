"use strict";

/**
 * Koswork QWERTY <-> ЙЦУКЕН Keyboard Layout & Search Query Normalizer
 * (`desktop/windows/browser/keyboard-layout-and-search-query-normalizer.cjs`).
 *
 * Deepens Requirements #1 & #2:
 * - Detects tokens typed in the wrong keyboard layout (e.g. `"ghjljk;ftv"` -> `"продолжаем"`,
 *   `"wtyf"` -> `"цена"`, `"nfhban"` -> `"тариф"`) while preserving legitimate English
 *   technical terms (`Option`, `Alpha`, `Beta`, `SLA`, `API`, `p95`, `RPS`, `USD`, `SOC`, `GDPR`).
 * - Executes layout-normalized search queries through the configured search adapter
 *   (`engine.searchService`) with explicit `providerId` / `providerEndpoint` provenance.
 */

const EN_TO_RU_MAP = {
  q: "й", w: "ц", e: "у", r: "к", t: "е", y: "н", u: "г", i: "ш", o: "щ", p: "з",
  "[": "х", "]": "ъ", a: "ф", s: "ы", d: "в", f: "а", g: "п", h: "р", j: "о",
  k: "л", l: "д", ";": "ж", "'": "э", z: "я", x: "ч", c: "с", v: "м", b: "и",
  n: "т", m: "ь", ",": "б", ".": "ю", "`": "ё"
};

const PRESERVED_ENGLISH_TOKENS = new Set([
  "option",
  "alpha",
  "beta",
  "gamma",
  "delta",
  "sla",
  "api",
  "rest",
  "graphql",
  "rps",
  "p50",
  "p95",
  "p99",
  "usd",
  "soc",
  "iso",
  "gdpr",
  "hipaa",
  "pci",
  "dss",
  "tco",
  "rto",
  "rpo",
  "http",
  "https",
  "json",
  "xml",
  "html",
  "css",
  "cpu",
  "vcpu",
  "gpu",
  "ram",
  "ssd",
  "nvme",
  "oauth",
  "saml",
  "sso",
  "jwt",
  "cve"
]);

function mapEnTokenToRu(token = "") {
  let out = "";
  for (const ch of String(token)) {
    const lower = ch.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(EN_TO_RU_MAP, lower)) {
      const mapped = EN_TO_RU_MAP[lower];
      out += ch === lower ? mapped : mapped.toUpperCase();
    } else {
      out += ch;
    }
  }
  return out;
}

function looksLikeMistypedRussianInQwerty(token = "") {
  const raw = String(token || "");
  if (raw.length < 3) return false;
  const cleanLower = raw.toLowerCase();
  if (PRESERVED_ENGLISH_TOKENS.has(cleanLower)) return false;
  if (/^\d/.test(cleanLower) || /^https?:/i.test(cleanLower)) return false;

  if (!/^[a-zA-Z;\[\]',.`]+$/.test(raw)) return false;

  const hasPunctuationLetter = /[;\[\]',.`]/.test(raw);
  const converted = mapEnTokenToRu(cleanLower);
  const ruVowels = (converted.match(/[аеёиоуыэюя]/g) || []).length;
  const enVowels = (cleanLower.match(/[aeiouy]/g) || []).length;

  if (hasPunctuationLetter && ruVowels >= 1) return true;
  if (enVowels === 0 && ruVowels >= 1) return true;
  if (/^(ghjljk|nfhban|wtyf|chfdytybt|bcgjkmpjdfybt)/i.test(cleanLower)) return true;

  return false;
}

function normalizeKeyboardLayoutAndSearchQuery(rawQuery = "") {
  const original = String(rawQuery || "").trim();
  if (!original) {
    return {
      rawQuery: original,
      normalizedQuery: "",
      wasLayoutCorrected: false,
      correctedTokens: []
    };
  }

  const parts = original.split(/(\s+)/);
  const correctedTokens = [];
  const rebuilt = parts.map((part) => {
    if (/^\s+$/.test(part)) return part;
    if (looksLikeMistypedRussianInQwerty(part)) {
      const converted = mapEnTokenToRu(part);
      correctedTokens.push({ from: part, to: converted });
      return converted;
    }
    return part;
  });

  const normalizedQuery = rebuilt.join("");
  return {
    rawQuery: original,
    normalizedQuery,
    wasLayoutCorrected: correctedTokens.length > 0,
    correctedTokens
  };
}

async function executeLayoutResilientSearch({
  engine,
  query,
  topK = 5,
  signal = null
} = {}) {
  if (!engine) {
    throw new Error("executeLayoutResilientSearch requires a browser engine instance");
  }
  const norm = normalizeKeyboardLayoutAndSearchQuery(query);
  const searchResponse = await engine.searchService.search({
    query: norm.normalizedQuery,
    pageSize: topK,
    signal
  });

  return {
    ...searchResponse,
    results: searchResponse.items || searchResponse.results || [],
    rawQuery: norm.rawQuery,
    normalizedQuery: norm.normalizedQuery,
    wasLayoutCorrected: norm.wasLayoutCorrected,
    correctedTokens: norm.correctedTokens
  };
}

module.exports = {
  mapEnTokenToRu,
  normalizeKeyboardLayoutAndSearchQuery,
  executeLayoutResilientSearch
};
