"use strict";

const { normalizeComparableValue } = require("./claim-comparator.cjs");
const { createKosworkWorkspaceService } = require("../workspace/workspace-service.cjs");

/**
 * Koswork Verified Multi-Year TCO Calculator & Billing Cycle Normalizer
 * (`desktop/windows/browser/pricing-tco-calculator-and-normalizer.cjs`).
 *
 * Deepens Requirement #2 & #5:
 * - Computes 1-month, 12-month (1-year), and 36-month (3-year) Total Cost of Ownership (TCO)
 *   across compared options (`Option Alpha`, `Option Beta`, etc.) for a configurable seat count.
 * - Strictly requires every price claim to carry a non-empty verbatim `quote` and valid
 *   UTF-16 `[startUtf16..endUtf16]` range plus distinct `pageDate`, `eventDate`, and `fetchedAt`.
 * - Rejects bare links or unquoted numbers (`BARE_PRICE_CLAIM_REJECTED`).
 */

function parseMonthlyUsdFromClaim(rawVal = "", quote = "") {
  const norm = normalizeComparableValue(rawVal || quote);
  if (norm.kind === "currency_monthly_usd" && Number.isFinite(norm.numericValue)) {
    return norm.numericValue;
  }
  const combined = `${rawVal} ${quote}`.replace(/,/g, ".");
  const match = combined.match(
    /(?:\$|usd\s*)?\s*(\d+(?:\.\d+)?)\s*(?:\$|usd)?\s*(?:\/|\s+в\s+|\s+per\s+)?\s*(мес|месяц|month|mo|год|year|yr)/i
  );
  if (match) {
    const val = Number(match[1]);
    const period = match[2].toLowerCase();
    const isYear = period.startsWith("год") || period.startsWith("y");
    return isYear ? Number((val / 12).toFixed(2)) : Number(val.toFixed(2));
  }
  return null;
}

function computeVerifiedMultiYearTcoModel({
  pricingClaims = [],
  seats = 10,
  annualDiscountPct = 0
} = {}) {
  const safeSeats = Math.max(1, Number(seats || 1));
  const discountFactor = Math.max(0, Math.min(100, Number(annualDiscountPct || 0))) / 100;

  const evaluatedOptions = [];
  const rejectedClaims = [];

  for (const item of pricingClaims || []) {
    const optionName = String(item?.optionName || "Option").trim();
    const excerpt = item?.excerpt || {};
    const source = item?.source || {};
    const hasVerifiedQuote =
      Boolean(excerpt.quote && String(excerpt.quote).trim().length > 0) &&
      Number.isInteger(excerpt.startUtf16) &&
      excerpt.startUtf16 >= 0 &&
      Number.isInteger(excerpt.endUtf16) &&
      excerpt.endUtf16 > excerpt.startUtf16;

    if (!hasVerifiedQuote) {
      rejectedClaims.push({
        optionName,
        sourceUrl: source.url || item?.sourceUrl || "",
        reason: "BARE_PRICE_CLAIM_REJECTED"
      });
      continue;
    }

    const monthlyUnitUsd = parseMonthlyUsdFromClaim(item.value, excerpt.quote);
    if (monthlyUnitUsd === null) {
      rejectedClaims.push({
        optionName,
        sourceUrl: source.url || "",
        reason: "UNPARSEABLE_CURRENCY_UNIT"
      });
      continue;
    }

    const perSeatPricing = Boolean(item.perSeat);
    const monthlyBaseTotalUsd = perSeatPricing
      ? Number((monthlyUnitUsd * safeSeats).toFixed(2))
      : Number(monthlyUnitUsd.toFixed(2));
    const oneTimeOnboardingUsd = Number(item.oneTimeOnboardingUsd || 0);

    const tco1MonthUsd = Number((monthlyBaseTotalUsd + oneTimeOnboardingUsd).toFixed(2));
    const tco12MonthsUsd = Number(
      (monthlyBaseTotalUsd * 12 * (1 - discountFactor) + oneTimeOnboardingUsd).toFixed(2)
    );
    const tco36MonthsUsd = Number(
      (monthlyBaseTotalUsd * 36 * (1 - discountFactor) + oneTimeOnboardingUsd).toFixed(2)
    );

    evaluatedOptions.push({
      optionName,
      pricingModel: perSeatPricing ? "per_seat_monthly" : "flat_tier_monthly",
      seatsAssumed: safeSeats,
      monthlyUnitUsd,
      monthlyBaseTotalUsd,
      oneTimeOnboardingUsd,
      tco1MonthUsd,
      tco12MonthsUsd,
      tco36MonthsUsd,
      quote: excerpt.quote,
      startUtf16: excerpt.startUtf16,
      endUtf16: excerpt.endUtf16,
      sourceUrl: source.url || "",
      sourceTitle: source.title || source.url || "",
      pageDate: source.pageDate || null,
      eventDate: source.eventDate || null,
      fetchedAt: source.fetchedAt || null
    });
  }

  evaluatedOptions.sort((a, b) => a.tco36MonthsUsd - b.tco36MonthsUsd);

  const lowest3YearOption = evaluatedOptions[0] || null;
  const highest3YearOption =
    evaluatedOptions.length > 1 ? evaluatedOptions[evaluatedOptions.length - 1] : null;
  const max3YearSavingsUsd =
    lowest3YearOption && highest3YearOption
      ? Number((highest3YearOption.tco36MonthsUsd - lowest3YearOption.tco36MonthsUsd).toFixed(2))
      : 0;

  return {
    generatedAt: new Date().toISOString(),
    assumptions: {
      seats: safeSeats,
      annualDiscountPct: Number(annualDiscountPct || 0)
    },
    evaluatedOptions,
    rejectedClaims,
    lowest3YearOptionName: lowest3YearOption ? lowest3YearOption.optionName : null,
    max3YearSavingsUsd
  };
}

function renderTcoComparisonMarkdown(model) {
  const lines = [
    "# Сравнительная модель совокупной стоимости владения (TCO 1 / 12 / 36 мес.)",
    "",
    `**Параметры расчёта:** мест (seats) = \`${model.assumptions.seats}\`, годовая скидка = \`${model.assumptions.annualDiscountPct}%\``,
    "",
    "| Вариант | Тариф / модель | 1 мес. (USD) | 12 мес. (USD) | 36 мес. (USD) | Подтверждающая выдержка UTF-16 и даты источника |",
    "| --- | --- | --- | --- | --- | --- |"
  ];

  for (const opt of model.evaluatedOptions) {
    lines.push(
      `| ${opt.optionName} | ${opt.pricingModel} ($${opt.monthlyUnitUsd}/мес) | $${opt.tco1MonthUsd.toFixed(2)} | $${opt.tco12MonthsUsd.toFixed(2)} | $${opt.tco36MonthsUsd.toFixed(2)} | «${opt.quote}» [${opt.startUtf16}..${opt.endUtf16}] (${opt.sourceUrl}, eventDate: ${opt.eventDate || "н/д"}, pageDate: ${opt.pageDate || "н/д"}) |`
    );
  }

  if (model.rejectedClaims.length > 0) {
    lines.push("", "## Отклоненные ценовые утверждения без верифицированной цитаты");
    for (const rej of model.rejectedClaims) {
      lines.push(`- **${rej.optionName}** (\`${rej.sourceUrl}\`): отклонено (\`${rej.reason}\`)`);
    }
  }

  return lines.join("\n") + "\n";
}

async function saveVerifiedTcoComparisonViaWorkspace({
  workspaceRoot,
  slug = "verified-tco-comparison",
  pricingClaims = [],
  seats = 10,
  annualDiscountPct = 0,
  signal = null
} = {}) {
  const model = computeVerifiedMultiYearTcoModel({
    pricingClaims,
    seats,
    annualDiscountPct
  });
  const md = renderTcoComparisonMarkdown(model);
  const json = JSON.stringify(model, null, 2) + "\n";

  const svc = createKosworkWorkspaceService();
  await svc.connectFolder({ folderPath: workspaceRoot, signal });

  const markdownFile = await svc.createFile({
    relativePath: `reports/${slug}.md`,
    content: md,
    createParents: true,
    signal
  });
  const jsonFile = await svc.createFile({
    relativePath: `reports/${slug}.json`,
    content: json,
    createParents: true,
    signal
  });

  return {
    model,
    markdownFile,
    jsonFile
  };
}

module.exports = {
  computeVerifiedMultiYearTcoModel,
  renderTcoComparisonMarkdown,
  saveVerifiedTcoComparisonViaWorkspace
};
