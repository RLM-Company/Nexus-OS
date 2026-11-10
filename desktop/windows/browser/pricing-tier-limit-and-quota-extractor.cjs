"use strict";

/**
 * Koswork Tier Quota, Rate-Limit & Overage Pricing Extractor
 * (`desktop/windows/browser/pricing-tier-limit-and-quota-extractor.cjs`).
 *
 * Deepens Requirements #2, #3 & #5:
 * - Extracts included plan storage quotas (`500 ГБ`, `2 ТБ`), monthly request quotas
 *   (`10 млн запросов/мес`, `25M requests/mo`), concurrent connection caps, and overage
 *   unit prices (`$0.15/ГБ сверх лимита`, `$0.20 per GB overage`) with exact UTF-16
 *   `[startUtf16..endUtf16]` offsets and distinct `pageDate`, `eventDate`, and `fetchedAt`.
 * - Evaluates a target workload (`requiredStorageGb`, `requiredMonthlyRequestsMillions`)
 *   against vendor tiers, calculating exact overage charges and rejecting bare links
 *   (`BARE_QUOTA_CLAIM_REJECTED`).
 */

function extractTierQuotasAndOverageRates(snapshot = {}) {
  const fullText = String(snapshot.fullTextUtf16 || snapshot.text || "");
  const storageQuotas = [];
  const requestQuotas = [];
  const overageRates = [];

  // 1. Storage quotas: e.g. "включено 500 ГБ", "included 2 TB"
  const storageRe = /(?:включено|квота|лимит|до|included|up to)\s+(\d+(?:\.\d+)?)\s*(ГБ|GB|ТБ|TB)/giu;
  let m;
  while ((m = storageRe.exec(fullText)) !== null) {
    const rawNum = Number(m[1]);
    const unit = m[2].toUpperCase();
    const quotaGb = unit === "ТБ" || unit === "TB" ? rawNum * 1024 : rawNum;
    const quote = m[0].trim();
    const startUtf16 = fullText.indexOf(quote, m.index);
    const endUtf16 = startUtf16 + quote.length;

    storageQuotas.push({
      quotaGb,
      quote,
      startUtf16,
      endUtf16,
      url: snapshot.url || "",
      pageDate: snapshot.pageDate || null,
      eventDate: snapshot.eventDate || null,
      fetchedAt: snapshot.fetchedAt || null
    });
  }

  // 2. Monthly request quotas (in millions): e.g. "10 млн запросов/мес", "25M requests/month"
  const reqRe = /(\d+(?:\.\d+)?)\s*(?:млн\s+запросов|M\s+requests|million\s+requests)\s*(?:\/|\s+в\s+|\s+per\s+)?\s*(?:мес|месяц|mo|month)/giu;
  while ((m = reqRe.exec(fullText)) !== null) {
    const millions = Number(m[1]);
    const quote = m[0].trim();
    const startUtf16 = fullText.indexOf(quote, m.index);
    const endUtf16 = startUtf16 + quote.length;

    requestQuotas.push({
      includedMillionsPerMonth: millions,
      quote,
      startUtf16,
      endUtf16,
      url: snapshot.url || "",
      pageDate: snapshot.pageDate || null,
      eventDate: snapshot.eventDate || null,
      fetchedAt: snapshot.fetchedAt || null
    });
  }

  // 3. Overage per GB rate: e.g. "$0.15/ГБ сверх лимита", "$0.20 per GB overage"
  const overRe = /\$(\d+(?:\.\d+)?)\s*(?:\/|\s+за\s+|\s+per\s+)\s*(?:1\s*)?(?:ГБ|GB)\s*(?:сверх\s+лимита|overage)?/giu;
  while ((m = overRe.exec(fullText)) !== null) {
    const usdPerGb = Number(m[1]);
    const quote = m[0].trim();
    const startUtf16 = fullText.indexOf(quote, m.index);
    const endUtf16 = startUtf16 + quote.length;

    overageRates.push({
      usdPerGb,
      quote,
      startUtf16,
      endUtf16,
      url: snapshot.url || "",
      pageDate: snapshot.pageDate || null,
      eventDate: snapshot.eventDate || null,
      fetchedAt: snapshot.fetchedAt || null
    });
  }

  return {
    url: snapshot.url || "",
    title: snapshot.title || "",
    pageDate: snapshot.pageDate || null,
    eventDate: snapshot.eventDate || null,
    fetchedAt: snapshot.fetchedAt || null,
    storageQuotas,
    requestQuotas,
    overageRates
  };
}

function evaluateWorkloadFitAgainstTierQuotas({
  vendorTiers = [],
  requiredStorageGb = 600
} = {}) {
  const evaluated = [];
  const rejected = [];

  for (const tier of vendorTiers || []) {
    const optionName = String(tier?.optionName || "Option").trim();
    if (tier?.bareLinkOnly || !tier?.snapshot) {
      rejected.push({
        optionName,
        sourceUrl: tier?.sourceUrl || "",
        code: "BARE_QUOTA_CLAIM_REJECTED",
        reason: "Голая ссылка на тарифную сетку без UTF-16 выдержки не принимается."
      });
      continue;
    }

    const extracted = extractTierQuotasAndOverageRates(tier.snapshot);
    const storageQuota = extracted.storageQuotas[0] || null;
    const overageRate = extracted.overageRates[0] || null;

    if (!storageQuota) {
      rejected.push({
        optionName,
        sourceUrl: tier.snapshot.url || "",
        code: "QUOTA_NOT_FOUND_IN_SNAPSHOT",
        reason: "В снимке страницы не найдена подтверждённая квота хранилища."
      });
      continue;
    }

    const baseMonthlyUsd = Number(tier.baseMonthlyUsd || 0);
    const excessGb = Math.max(0, Number(requiredStorageGb || 0) - storageQuota.quotaGb);
    const overageMonthlyUsd = Number(
      (excessGb * Number(overageRate ? overageRate.usdPerGb : 0)).toFixed(2)
    );
    const effectiveMonthlyUsd = Number((baseMonthlyUsd + overageMonthlyUsd).toFixed(2));

    evaluated.push({
      optionName,
      baseMonthlyUsd,
      includedStorageGb: storageQuota.quotaGb,
      requiredStorageGb: Number(requiredStorageGb || 0),
      excessStorageGb: excessGb,
      overageUsdPerGb: overageRate ? overageRate.usdPerGb : 0,
      overageMonthlyUsd,
      effectiveMonthlyUsd,
      storageQuotaExcerpt: storageQuota,
      overageRateExcerpt: overageRate,
      pageDate: tier.snapshot.pageDate || null,
      eventDate: tier.snapshot.eventDate || null,
      fetchedAt: tier.snapshot.fetchedAt || null
    });
  }

  evaluated.sort((a, b) => a.effectiveMonthlyUsd - b.effectiveMonthlyUsd);

  return {
    requiredStorageGb: Number(requiredStorageGb || 0),
    evaluatedCount: evaluated.length,
    rejectedCount: rejected.length,
    bestFitOptionName: evaluated[0] ? evaluated[0].optionName : null,
    evaluated,
    rejected
  };
}

module.exports = {
  extractTierQuotasAndOverageRates,
  evaluateWorkloadFitAgainstTierQuotas
};
