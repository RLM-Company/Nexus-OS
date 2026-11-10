"use strict";

const { normalizeComparableValue } = require("./claim-comparator.cjs");

/**
 * Koswork Bilingual (RU <-> EN) Technical Terminology & Criterion Mapper
 * (`desktop/windows/browser/bilingual-terminology-mapper.cjs`).
 *
 * Deepens Requirement #2 & #5:
 * - Aligns Russian and English technical criterion names (`"Цена"` <-> `"Price"` / `"Monthly Cost"`,
 *   `"Поддержка SLA"` <-> `"Availability SLA"` / `"Uptime SLA"`, `"Автономный режим"` <-> `"Offline Mode"`,
 *   `"Пропускная способность"` <-> `"Throughput"` / `"RPS"`, `"Задержка"` <-> `"Latency"`,
 *   `"Шифрование"` <-> `"Encryption"`) so English primary documentation and Russian
 *   analytical sources can be compared in a single unified comparison table while
 *   strictly preserving each source's verbatim original-language UTF-16 quote!
 */

const BILINGUAL_CRITERION_DICTIONARY = Object.freeze([
  {
    canonicalId: "price",
    labelRu: "Цена",
    labelEn: "Price",
    synonyms: [
      "цена",
      "стоимость",
      "базовая цена",
      "тариф",
      "price",
      "pricing",
      "monthly cost",
      "subscription fee"
    ]
  },
  {
    canonicalId: "sla",
    labelRu: "Поддержка SLA",
    labelEn: "Availability SLA",
    synonyms: [
      "поддержка sla",
      "sla",
      "уровень sla",
      "доступность",
      "availability sla",
      "uptime sla",
      "service level agreement"
    ]
  },
  {
    canonicalId: "offline_mode",
    labelRu: "Автономный режим",
    labelEn: "Offline Mode",
    synonyms: [
      "автономный режим",
      "офлайн режим",
      "локальный режим",
      "offline mode",
      "air-gapped mode",
      "local-first mode"
    ]
  },
  {
    canonicalId: "throughput",
    labelRu: "Пропускная способность",
    labelEn: "Throughput",
    synonyms: [
      "пропускная способность",
      "rps",
      "запросов в секунду",
      "throughput",
      "requests per second"
    ]
  },
  {
    canonicalId: "latency",
    labelRu: "Задержка",
    labelEn: "Latency",
    synonyms: [
      "задержка",
      "задержка p99",
      "латентность",
      "время отклика",
      "latency",
      "p99 latency",
      "response time"
    ]
  },
  {
    canonicalId: "encryption",
    labelRu: "Шифрование",
    labelEn: "Encryption",
    synonyms: [
      "шифрование",
      "криптография",
      "алгоритм шифрования",
      "encryption",
      "cipher suite",
      "at-rest encryption"
    ]
  }
]);

function resolveCanonicalCriterion(rawCriterionName = "") {
  const clean = String(rawCriterionName || "").trim();
  const lower = clean.toLowerCase();

  for (const entry of BILINGUAL_CRITERION_DICTIONARY) {
    if (
      entry.canonicalId === lower ||
      entry.labelRu.toLowerCase() === lower ||
      entry.labelEn.toLowerCase() === lower ||
      entry.synonyms.includes(lower)
    ) {
      return {
        canonicalId: entry.canonicalId,
        labelRu: entry.labelRu,
        labelEn: entry.labelEn,
        matchedDictionary: true
      };
    }
  }

  return {
    canonicalId: lower || "custom",
    labelRu: clean || "Критерий",
    labelEn: clean || "Criterion",
    matchedDictionary: false
  };
}

function alignBilingualClaimsForOption(claims = []) {
  const alignedByCanonicalCriterion = new Map();

  for (const c of claims) {
    if (!c || !c.excerpt || !c.excerpt.quote) continue;
    const resolved = resolveCanonicalCriterion(c.criterion);
    const normVal = normalizeComparableValue(c.value || c.excerpt.quote);
    const key = `${String(c.optionName || "Option").trim()}||${resolved.canonicalId}`;

    if (!alignedByCanonicalCriterion.has(key)) {
      alignedByCanonicalCriterion.set(key, {
        optionName: c.optionName || "Option",
        canonicalCriterionId: resolved.canonicalId,
        criterionLabelRu: resolved.labelRu,
        criterionLabelEn: resolved.labelEn,
        claims: []
      });
    }

    alignedByCanonicalCriterion.get(key).claims.push({
      ...c,
      canonicalCriterionId: resolved.canonicalId,
      criterionLabelRu: resolved.labelRu,
      normalizedValue: normVal
    });
  }

  const groups = Array.from(alignedByCanonicalCriterion.values()).map((grp) => {
    const canonicalKeys = new Set(grp.claims.map((item) => item.normalizedValue.canonicalKey));
    return {
      ...grp,
      crossLanguageCorroborated: grp.claims.length >= 2 && canonicalKeys.size === 1,
      hasCrossLanguageConflict: canonicalKeys.size > 1
    };
  });

  return {
    alignedGroupsCount: groups.length,
    groups
  };
}

module.exports = {
  BILINGUAL_CRITERION_DICTIONARY,
  resolveCanonicalCriterion,
  alignBilingualClaimsForOption
};
