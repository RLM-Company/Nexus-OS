"use strict";

const crypto = require("node:crypto");
const { createKosworkWorkspaceService } = require("../workspace/workspace-service.cjs");

/**
 * Koswork Executive Brief & Atomic Claim Cards Exporter
 * (`desktop/windows/browser/executive-brief-and-claim-cards-exporter.cjs`).
 *
 * Deepens Requirement #2 & #5:
 * - Transforms a multi-site research report into a structured Executive Brief
 *   (`reports/<slug>-executive-brief.md`) and a machine-verifiable Atomic Claim Cards
 *   deck (`reports/<slug>-claim-cards.json`) via `workspace-service.cjs`.
 * - Each Atomic Claim Card links `optionName`, `criterion`, `verdict`, `displayValue`,
 *   verbatim `quote`, exact UTF-16 `[startUtf16..endUtf16]` range, `sourceUrl`,
 *   `sourceTitle`, distinct `pageDate` / `eventDate` / `fetchedAt`, and a deterministic
 *   `claimCardId` SHA-256 proof digest.
 * - Explicitly flags bare-link rejections (`bareLinkRejected: true`), contradictions,
 *   outdated sources, and unavailable HTTP 503 pages.
 */

function computeClaimCardDigest(card) {
  const payload = [
    card.optionName || "",
    card.criterion || "",
    card.displayValue || "",
    card.quote || "",
    String(card.startUtf16 ?? -1),
    String(card.endUtf16 ?? -1),
    card.sourceUrl || "",
    card.pageDate || "",
    card.eventDate || ""
  ].join("|");
  return crypto.createHash("sha256").update(payload, "utf8").digest("hex").slice(0, 16);
}

function buildExecutiveBriefAndClaimCards(report = {}) {
  const question = report.question || "Исследовательский запрос";
  const claimCards = [];
  const rejectedBareLinkClaims = [];

  const contradictionSet = new Set(
    (report.contradictions || []).map(
      (c) => `${c.optionName || ""}||${c.criterion || ""}`
    )
  );
  const outdatedMap = new Map();
  for (const out of report.outdatedSources || []) {
    const k = `${out.optionName || ""}||${out.criterion || ""}`;
    if (!outdatedMap.has(k)) outdatedMap.set(k, []);
    outdatedMap.get(k).push(out);
  }

  for (const row of report.comparisonRows || []) {
    const optionName = row.optionName || "Option";
    const cells = row.cells || {};
    for (const [criterion, cell] of Object.entries(cells)) {
      const key = `${optionName}||${criterion}`;
      const hasValidQuote =
        Boolean(cell && cell.quote && String(cell.quote).trim().length > 0) &&
        Number.isInteger(cell.startUtf16) &&
        cell.startUtf16 >= 0 &&
        Number.isInteger(cell.endUtf16) &&
        cell.endUtf16 > cell.startUtf16;

      if (!hasValidQuote) {
        if (cell && cell.sourceUrl && (!cell.quote || !String(cell.quote).trim())) {
          rejectedBareLinkClaims.push({
            optionName,
            criterion,
            sourceUrl: cell.sourceUrl,
            reason: "BARE_LINK_NOT_PROOF_OF_CLAIM"
          });
        }
        continue;
      }

      const hasContradiction = contradictionSet.has(key) || Boolean(cell.hasConflict);
      const supersededSources = outdatedMap.get(key) || [];
      const verdict = hasContradiction
        ? "CONTRADICTED_RESOLVED_BY_FRESHNESS"
        : "CONFIRMED_WITH_UTF16_EXCERPT";

      const card = {
        optionName,
        criterion,
        verdict,
        displayValue: cell.displayValue || cell.value || "",
        quote: cell.quote,
        startUtf16: cell.startUtf16,
        endUtf16: cell.endUtf16,
        sourceUrl: cell.sourceUrl || "",
        sourceTitle: cell.sourceTitle || cell.sourceUrl || "",
        pageDate: cell.pageDate || null,
        eventDate: cell.eventDate || null,
        fetchedAt: cell.fetchedAt || null,
        supersededSourcesCount: supersededSources.length,
        supersededSources
      };
      card.claimCardId = `card-${computeClaimCardDigest(card)}`;
      claimCards.push(card);
    }
  }

  const unavailableSources = (report.unavailableSources || []).map((u) => ({
    url: u.url,
    statusCode: u.statusCode || 503,
    reason: u.reason || "Источник временно недоступен"
  }));

  return {
    generatedAt: new Date().toISOString(),
    question,
    summaryCounts: {
      totalVerifiedClaimCards: claimCards.length,
      contradictedResolvedCards: claimCards.filter(
        (c) => c.verdict === "CONTRADICTED_RESOLVED_BY_FRESHNESS"
      ).length,
      unavailableSourcesCount: unavailableSources.length,
      rejectedBareLinkClaimsCount: rejectedBareLinkClaims.length,
      unknownCriteriaCount: (report.unknowns || []).length
    },
    claimCards,
    unavailableSources,
    rejectedBareLinkClaims,
    unknowns: report.unknowns || []
  };
}

function renderExecutiveBriefMarkdown(bundle) {
  const lines = [
    `# Исполнительное резюме и карточки верифицированных утверждений`,
    ``,
    `**Исследовательский вопрос:** ${bundle.question}`,
    ``,
    `## Сводка доказательной базы`,
    `- **Верифицировано карточек утверждений (с UTF-16 выдержками):** ${bundle.summaryCounts.totalVerifiedClaimCards}`,
    `- **Разрешено межсайтовых противоречий по датам (\`eventDate > pageDate > fetchedAt\`):** ${bundle.summaryCounts.contradictedResolvedCards}`,
    `- **Недоступных источников (HTTP 503 / ошибка сети):** ${bundle.summaryCounts.unavailableSourcesCount}`,
    `- **Отклонено голых ссылок без выдержки (\`BARE_LINK_NOT_PROOF_OF_CLAIM\`):** ${bundle.summaryCounts.rejectedBareLinkClaimsCount}`,
    `- **Неизвестных / неподтвержденных полей:** ${bundle.summaryCounts.unknownCriteriaCount}`,
    ``,
    `## Карточки утверждений (Atomic Claim Cards)`
  ];

  for (const card of bundle.claimCards) {
    lines.push(
      `- **[${card.claimCardId}] ${card.optionName} — ${card.criterion}:** \`${card.displayValue}\` (${card.verdict}) — Выдержка: «${card.quote}» \`[${card.startUtf16}..${card.endUtf16}]\` — Источник: [${card.sourceTitle}](${card.sourceUrl}) (\`pageDate: ${card.pageDate || "н/д"}\`, \`eventDate: ${card.eventDate || "н/д"}\`, \`fetchedAt: ${card.fetchedAt || "н/д"}\`)`
    );
  }

  if (bundle.unavailableSources.length > 0) {
    lines.push(``, `## Недоступные источники`);
    for (const u of bundle.unavailableSources) {
      lines.push(`- \`${u.url}\` — статус \`${u.statusCode}\` (${u.reason})`);
    }
  }

  if (bundle.rejectedBareLinkClaims.length > 0) {
    lines.push(``, `## Отклоненные голые ссылки (без подтверждающей цитаты)`);
    for (const r of bundle.rejectedBareLinkClaims) {
      lines.push(
        `- **${r.optionName} / ${r.criterion}:** \`${r.sourceUrl}\` — отклонено (\`${r.reason}\`)`
      );
    }
  }

  return lines.join("\n") + "\n";
}

async function saveExecutiveBriefAndClaimCardsViaWorkspace({
  workspaceRoot,
  slug = "research-executive-brief",
  report = {},
  signal = null
} = {}) {
  const bundle = buildExecutiveBriefAndClaimCards(report);
  const md = renderExecutiveBriefMarkdown(bundle);
  const json = JSON.stringify(bundle, null, 2) + "\n";

  const svc = createKosworkWorkspaceService();
  await svc.connectFolder({ folderPath: workspaceRoot, signal });

  const markdownFile = await svc.createFile({
    relativePath: `reports/${slug}-executive-brief.md`,
    content: md,
    createParents: true,
    signal
  });
  const jsonFile = await svc.createFile({
    relativePath: `reports/${slug}-claim-cards.json`,
    content: json,
    createParents: true,
    signal
  });

  return {
    bundle,
    markdownFile,
    jsonFile
  };
}

module.exports = {
  buildExecutiveBriefAndClaimCards,
  renderExecutiveBriefMarkdown,
  saveExecutiveBriefAndClaimCardsViaWorkspace
};
