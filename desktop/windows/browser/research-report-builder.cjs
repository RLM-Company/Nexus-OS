"use strict";

const { createKosworkWorkspaceService } = require("../workspace/workspace-service.cjs");
const { saveWordReportToWorkspace } = require("../workspace/word-report-builder.cjs");
const { saveWorkbookToWorkspace } = require("../workspace/excel-workbook-builder.cjs");
const { savePdfReportToWorkspace } = require("../workspace/pdf-report-builder.cjs");
const { savePresentationToWorkspace } = require("../workspace/powerpoint-deck-builder.cjs");
const { verifyResearchReportIntegrity } = require("./citation-verifier.cjs");
const { buildBrowserResearchProvAndBibtex } = require("./prov-lineage-exporter.cjs");

/**
 * Koswork Verifiable Browser Research Report Builder (`desktop/windows/browser/research-report-builder.cjs`).
 *
 * Saves Markdown (`.md`), HTML (`.html`), RFC-4180 CSV (`.csv`), JSON (`.json`),
 * W3C PROV-JSON (`.prov.json`), BibTeX (`.bib`), and optional OpenXML Word (`.docx`),
 * Excel (`.xlsx`), PDF 1.4 (`.pdf`), and PowerPoint (`.pptx`) comparison artifacts
 * through the existing `desktop/windows/workspace/` file APIs, and runs `verifyResearchReportIntegrity`.
 */

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeCsvCell(value) {
  const str = String(value ?? "");
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function renderComparisonTableCsv(criteria = [], comparisonRows = []) {
  const header = ["Вариант", ...criteria, "Статус проверки"].map(escapeCsvCell).join(",");
  const lines = [header];
  for (const row of comparisonRows) {
    const cells = [
      row.optionName,
      ...criteria.map((c) => {
        const cell = row.values?.[c];
        if (!cell) return "Неизвестно (нет выдержки)";
        if (typeof cell === "object") {
          return `${cell.displayValue} [${cell.sourceUrl} ${cell.startUtf16}..${cell.endUtf16}]`;
        }
        return String(cell);
      }),
      row.verificationSummary || "Проверено"
    ];
    lines.push(cells.map(escapeCsvCell).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

function validateAndClassifyClaims(rawClaims = [], sourcesByUrl = new Map()) {
  const confirmedClaims = [];
  const unconfirmedClaims = [];

  for (const item of rawClaims) {
    const claimText = String(item.claim || "").trim();
    if (!claimText) continue;

    const excerpt = item.excerpt || null;
    const sourceUrl = excerpt?.url || item.sourceUrl || null;
    const sourceRecord = sourceUrl ? sourcesByUrl.get(sourceUrl) : null;

    const hasValidExcerpt =
      excerpt &&
      typeof excerpt.quote === "string" &&
      excerpt.quote.trim().length > 0 &&
      Number.isInteger(excerpt.startUtf16) &&
      Number.isInteger(excerpt.endUtf16) &&
      excerpt.endUtf16 > excerpt.startUtf16;

    const sourceAvailable = sourceRecord
      ? sourceRecord.available !== false
      : Boolean(hasValidExcerpt);

    // A bare link without a verified excerpt is NEVER accepted as proof of a claim
    if (!hasValidExcerpt || !sourceAvailable) {
      unconfirmedClaims.push({
        claimId: item.claimId || `unconf-${unconfirmedClaims.length + 1}`,
        claim: claimText,
        criterion: item.criterion || null,
        optionName: item.optionName || null,
        candidateUrl: sourceUrl,
        reason: !sourceAvailable
          ? "Источник недоступен (HTTP 503/404 или сбой сети); голая ссылка не является доказательством."
          : "Отсутствует подтверждающая выдержка (цитата с UTF-16 смещениями); сама по себе ссылка не доказывает утверждение."
      });
      continue;
    }

    confirmedClaims.push({
      claimId: item.claimId || `claim-${confirmedClaims.length + 1}`,
      claim: claimText,
      optionName: item.optionName || null,
      criterion: item.criterion || null,
      value: item.value ?? null,
      isOutdated: Boolean(item.isOutdated),
      outdatedNote: item.outdatedNote || null,
      evidenceGrade: item.isOutdated
        ? "outdated_superseded"
        : item.evidenceGrade || "confirmed_with_utf16_excerpt",
      excerpt: {
        excerptId: excerpt.excerptId,
        quote: excerpt.quote,
        startUtf16: excerpt.startUtf16,
        endUtf16: excerpt.endUtf16,
        pageVersion: excerpt.pageVersion ?? 1
      },
      source: {
        url: excerpt.url,
        title: excerpt.title || sourceRecord?.title || excerpt.url,
        pageDate: excerpt.pageDate || sourceRecord?.pageDate || null,
        eventDate: excerpt.eventDate || sourceRecord?.eventDate || null,
        fetchedAt: excerpt.fetchedAt || sourceRecord?.fetchedAt || null
      }
    });
  }

  return { confirmedClaims, unconfirmedClaims };
}

function renderResearchReportMarkdown(spec) {
  const {
    question,
    generatedAt,
    criteria = [],
    comparisonRows = [],
    confirmedClaims = [],
    unconfirmedClaims = [],
    contradictions = [],
    outdatedFindings = [],
    unavailableSources = [],
    substitutionIncidents = [],
    sources = [],
    resourceMetrics = null
  } = spec;

  const lines = [];
  lines.push(`# Исследовательский отчёт Koswork: ${question}`);
  lines.push("");
  lines.push(`- **Дата формирования отчёта:** ${generatedAt}`);
  lines.push(
    `- **Проверено источников:** ${sources.length} (недоступных: ${unavailableSources.length})`
  );
  lines.push(
    `- **Подтверждённых утверждений (с цитатой и UTF-16 смещениями):** ${confirmedClaims.length}`
  );
  lines.push(`- **Неподтверждённых / неизвестных пунктов:** ${unconfirmedClaims.length}`);
  lines.push(`- **Выявленных противоречий между источниками:** ${contradictions.length}`);
  lines.push("");

  // 1. Comparison Table
  lines.push("## 1. Таблица сравнения вариантов по критериям");
  lines.push("");
  const headerCols = ["Вариант", ...criteria, "Статус проверки и источники"];
  lines.push(`| ${headerCols.join(" | ")} |`);
  lines.push(`| ${headerCols.map(() => "---").join(" | ")} |`);
  for (const row of comparisonRows) {
    const critCells = criteria.map((c) => {
      const cell = row.values?.[c];
      if (!cell) return "Неизвестно (нет выдержки)";
      if (typeof cell === "object") {
        const badge = cell.conflict
          ? "⚠️ ПРОТИВОРЕЧИЕ: "
          : cell.outdated
            ? "⏳ УСТАРЕЛО: "
            : "";
        return `${badge}${cell.displayValue} ([${cell.sourceTitle || "Источник"}](${cell.sourceUrl}) [${cell.startUtf16}..${cell.endUtf16}])`;
      }
      return String(cell);
    });
    lines.push(
      `| **${row.optionName}** | ${critCells.join(" | ")} | ${row.verificationSummary || "Проверено"} |`
    );
  }
  lines.push("");

  // 2. Confirmed Claims (Claim -> Excerpt -> Source)
  lines.push("## 2. Что подтверждено (Утверждение → Выдержка → Источник)");
  lines.push("");
  if (confirmedClaims.length === 0) {
    lines.push("_Нет подтверждённых выдержками утверждений._");
  } else {
    for (const c of confirmedClaims) {
      const outdatedTag = c.isOutdated
        ? ` *(⚠️ Устаревшие данные: ${c.outdatedNote || "есть более свежий источник"})*`
        : "";
      lines.push(`- **Утверждение [${c.claimId}]:** ${c.claim}${outdatedTag}`);
      lines.push(
        `  - **Выдержка (UTF-16 \`${c.excerpt.startUtf16}..${c.excerpt.endUtf16}\`, v${c.excerpt.pageVersion}):** «${c.excerpt.quote}»`
      );
      lines.push(
        `  - **Источник:** [${c.source.title}](${c.source.url}) | Дата на странице: \`${c.source.pageDate || "не указана"}\` | Дата события: \`${c.source.eventDate || "не указана"}\` | Дата получения: \`${c.source.fetchedAt}\``
      );
    }
  }
  lines.push("");

  // 3. Contradictions & Outdated Data
  lines.push("## 3. Конфликтующие и устаревшие данные");
  lines.push("");
  if (
    contradictions.length === 0 &&
    outdatedFindings.length === 0 &&
    substitutionIncidents.length === 0
  ) {
    lines.push("_Конфликтующих или устаревших данных не обнаружено._");
  } else {
    for (const conflict of contradictions) {
      lines.push(
        `- **Противоречие по критерию «${conflict.criterion}» (${conflict.optionName || "общий параметр"}):** ${conflict.summary}`
      );
      lines.push(
        `  - *Позиция А:* «${conflict.sideA.quote}» ([${conflict.sideA.title}](${conflict.sideA.url}), UTF-16 \`${conflict.sideA.startUtf16}..${conflict.sideA.endUtf16}\`, дата на странице: \`${conflict.sideA.pageDate || "н/д"}\`, дата события: \`${conflict.sideA.eventDate || "н/д"}\`)`
      );
      lines.push(
        `  - *Позиция Б:* «${conflict.sideB.quote}» ([${conflict.sideB.title}](${conflict.sideB.url}), UTF-16 \`${conflict.sideB.startUtf16}..${conflict.sideB.endUtf16}\`, дата на странице: \`${conflict.sideB.pageDate || "н/д"}\`, дата события: \`${conflict.sideB.eventDate || "н/д"}\`)`
      );
    }
    for (const out of outdatedFindings) {
      lines.push(
        `- **Устаревшие сведения (${out.optionName || "источник"}):** [${out.title}](${out.url}) содержит данные от \`${out.pageDate || out.eventDate}\`, которые перекрыты более свежим источником от \`${out.supersededByDate}\` (${out.note}).`
      );
    }
    for (const sub of substitutionIncidents) {
      lines.push(
        `- **Подмена текста после наблюдения (блокировка действия):** На странице [${sub.url}](${sub.url}) между версиями \`v${sub.observedPageVersion}\` и \`v${sub.currentPageVersion}\` текст на смещении UTF-16 \`${sub.startUtf16}..${sub.endUtf16}\` был изменён с «${sub.expectedText}» на «${sub.actualTextAtOffsets}».`
      );
    }
  }
  lines.push("");

  // 4. What is Unknown / Unconfirmed & Unavailable Sources
  lines.push("## 4. Что неизвестно и недоступные источники");
  lines.push("");
  lines.push(
    "> Примечание: ссылка сама по себе не является доказательством утверждения без подтверждающей выдержки из открытого документа."
  );
  lines.push("");
  for (const u of unconfirmedClaims) {
    lines.push(
      `- **Не подтверждено [${u.claimId}]:** ${u.claim} — *${u.reason}*${u.candidateUrl ? ` (кандидат: ${u.candidateUrl})` : ""}`
    );
  }
  for (const unavail of unavailableSources) {
    lines.push(
      `- **Недоступный источник:** \`${unavail.url}\` — HTTP \`${unavail.httpStatus || "ERR"}\` (${unavail.reason || "страница недоступна"}), время попытки: \`${unavail.fetchedAt}\`.`
    );
  }
  lines.push("");

  // 5. Resource & Latency Telemetry
  if (resourceMetrics) {
    lines.push("## 5. Фактические метрики ресурсов (RAM и задержка)");
    lines.push("");
    lines.push(
      `- **Лимит живых вкладок:** ${resourceMetrics.liveTabCount} / ${resourceMetrics.maxLiveTabs} (выгружено фоновых вкладок: ${resourceMetrics.hibernationEventsCount}, переиспользовано снимков: ${resourceMetrics.snapshotReuseCount})`
    );
    lines.push(
      `- **Фактическая память процесса (RAM):** RSS \`${resourceMetrics.ramTelemetry.currentRssMb} МБ\` (пик \`${resourceMetrics.ramTelemetry.peakRssMb} МБ\`), Heap Used \`${resourceMetrics.ramTelemetry.currentHeapUsedMb} МБ\``
    );
    lines.push(
      `- **Задержка операций (Latency):** медиана (p50) \`${resourceMetrics.latencyTelemetry.p50Ms} мс\`, p95 \`${resourceMetrics.latencyTelemetry.p95Ms} мс\`, макс \`${resourceMetrics.latencyTelemetry.maxMs} мс\``
    );
    lines.push("");
  }

  return lines.join("\n");
}

function renderResearchReportHtml(spec) {
  const {
    question,
    generatedAt,
    criteria = [],
    comparisonRows = [],
    confirmedClaims = [],
    unconfirmedClaims = [],
    contradictions = [],
    unavailableSources = [],
    substitutionIncidents = [],
    resourceMetrics = null
  } = spec;

  const thCells = ["Вариант", ...criteria, "Статус проверки"]
    .map((c) => `<th>${escapeHtml(c)}</th>`)
    .join("");

  const trRows = comparisonRows
    .map((row) => {
      const tds = criteria
        .map((c) => {
          const cell = row.values?.[c];
          if (!cell) return `<td class="unverified">Неизвестно (нет выдержки)</td>`;
          if (typeof cell === "object") {
            const cls = cell.conflict ? "conflict" : cell.outdated ? "outdated" : "confirmed";
            return `<td class="${cls}">${escapeHtml(cell.displayValue)} <a href="${escapeHtml(cell.sourceUrl)}">[${escapeHtml(cell.sourceTitle || "Источник")} ${cell.startUtf16}..${cell.endUtf16}]</a></td>`;
          }
          return `<td>${escapeHtml(cell)}</td>`;
        })
        .join("");
      return `<tr><td><strong>${escapeHtml(row.optionName)}</strong></td>${tds}<td>${escapeHtml(row.verificationSummary || "Проверено")}</td></tr>`;
    })
    .join("\n");

  const claimsHtml = confirmedClaims
    .map(
      (c) =>
        `<li data-claim-id="${escapeHtml(c.claimId)}">
          <strong>${escapeHtml(c.claim)}</strong>
          ${c.isOutdated ? `<span class="badge-outdated">Устаревшие данные: ${escapeHtml(c.outdatedNote || "")}</span>` : ""}
          <blockquote>«${escapeHtml(c.excerpt.quote)}» <code>[UTF-16 ${c.excerpt.startUtf16}..${c.excerpt.endUtf16}, v${c.excerpt.pageVersion}]</code></blockquote>
          <div class="source-meta">
            Источник: <a href="${escapeHtml(c.source.url)}">${escapeHtml(c.source.title)}</a> |
            Дата на странице: <code>${escapeHtml(c.source.pageDate || "не указана")}</code> |
            Дата события: <code>${escapeHtml(c.source.eventDate || "не указана")}</code> |
            Получено: <code>${escapeHtml(c.source.fetchedAt)}</code>
          </div>
        </li>`
    )
    .join("\n");

  const conflictsHtml = contradictions
    .map(
      (cf) =>
        `<li class="conflict-item">
          <strong>${escapeHtml(cf.criterion)} (${escapeHtml(cf.optionName || "")}):</strong> ${escapeHtml(cf.summary)}
          <ul>
            <li>Позиция А: «${escapeHtml(cf.sideA.quote)}» (<a href="${escapeHtml(cf.sideA.url)}">${escapeHtml(cf.sideA.title)}</a>, UTF-16 ${cf.sideA.startUtf16}..${cf.sideA.endUtf16})</li>
            <li>Позиция Б: «${escapeHtml(cf.sideB.quote)}» (<a href="${escapeHtml(cf.sideB.url)}">${escapeHtml(cf.sideB.title)}</a>, UTF-16 ${cf.sideB.startUtf16}..${cf.sideB.endUtf16})</li>
          </ul>
        </li>`
    )
    .join("\n");

  const unknownHtml = [
    ...unconfirmedClaims.map(
      (u) =>
        `<li><strong>Не подтверждено (${escapeHtml(u.claimId)}):</strong> ${escapeHtml(u.claim)} — <em>${escapeHtml(u.reason)}</em></li>`
    ),
    ...unavailableSources.map(
      (s) =>
        `<li><strong>Недоступный источник:</strong> <code>${escapeHtml(s.url)}</code> (HTTP ${escapeHtml(s.httpStatus)}, ${escapeHtml(s.reason || "недоступен")})</li>`
    ),
    ...substitutionIncidents.map(
      (sub) =>
        `<li><strong>Подмена текста после наблюдения:</strong> <code>${escapeHtml(sub.url)}</code> (v${sub.observedPageVersion} → v${sub.currentPageVersion}, UTF-16 ${sub.startUtf16}..${sub.endUtf16}: «${escapeHtml(sub.expectedText)}» → «${escapeHtml(sub.actualTextAtOffsets)}»)</li>`
    )
  ].join("\n");

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>Исследовательский отчёт Koswork: ${escapeHtml(question)}</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; margin: 24px; color: #111827; line-height: 1.5; }
    table { border-collapse: collapse; width: 100%; margin: 16px 0; }
    th, td { border: 1px solid #d1d5db; padding: 8px 10px; text-align: left; vertical-align: top; }
    th { background: #f3f4f6; }
    .conflict { background: #fef2f2; }
    .outdated { background: #fffbeb; }
    .unverified { color: #6b7280; font-style: italic; }
    blockquote { margin: 6px 0; padding: 6px 12px; border-left: 3px solid #2563eb; background: #f8fafc; }
    .source-meta { font-size: 0.875rem; color: #4b5563; }
  </style>
</head>
<body>
  <h1>Исследовательский отчёт Koswork: ${escapeHtml(question)}</h1>
  <p>Сформировано: <code>${escapeHtml(generatedAt)}</code></p>
  <h2>1. Таблица сравнения вариантов</h2>
  <table>
    <thead><tr>${thCells}</tr></thead>
    <tbody>${trRows}</tbody>
  </table>
  <h2>2. Подтверждённые утверждения (Утверждение → Выдержка → Источник)</h2>
  <ul>${claimsHtml}</ul>
  <h2>3. Противоречия и устаревшие данные</h2>
  <ul>${conflictsHtml}</ul>
  <h2>4. Что неизвестно и недоступные источники</h2>
  <ul>${unknownHtml}</ul>
  ${
    resourceMetrics
      ? `<h2>5. Фактические метрики ресурсов</h2>
         <p>RAM RSS: <code>${resourceMetrics.ramTelemetry.currentRssMb} МБ</code> (пик <code>${resourceMetrics.ramTelemetry.peakRssMb} МБ</code>) | Задержка p50: <code>${resourceMetrics.latencyTelemetry.p50Ms} мс</code>, p95: <code>${resourceMetrics.latencyTelemetry.p95Ms} мс</code></p>`
      : ""
  }
</body>
</html>`;
}

/**
 * Saves the Markdown report, HTML report, CSV comparison table, JSON comparison matrix,
 * W3C PROV-JSON (`.prov.json`), BibTeX (`.bib`), and optional `.docx`, `.xlsx`, `.pdf`, and `.pptx`
 * files via the existing `desktop/windows/workspace/` services.
 */
async function saveResearchReportsViaWorkspace({
  workspaceRoot,
  workspaceService = null,
  reportSlug = "browser-research-report",
  reportData,
  reportSpec,
  exportOfficeFormats = true,
  signal = null
} = {}) {
  reportData = reportData || reportSpec || {};
  let svc = workspaceService;
  if (!svc) {
    svc = createKosworkWorkspaceService();
    await svc.connectFolder({ folderPath: workspaceRoot, signal });
  } else if (!svc.getStatus().connected && workspaceRoot) {
    await svc.connectFolder({ folderPath: workspaceRoot, signal });
  }

  const resolvedRoot = workspaceRoot || svc.getStatus().rootPath;

  const sourcesByUrl = new Map();
  for (const s of reportData.sources || []) {
    sourcesByUrl.set(s.url, s);
  }

  const { confirmedClaims, unconfirmedClaims } = validateAndClassifyClaims(
    reportData.claims || [],
    sourcesByUrl
  );

  const citationAudit = verifyResearchReportIntegrity({
    confirmedClaims,
    unconfirmedClaims,
    contradictions: reportData.contradictions || [],
    unavailableSources: reportData.unavailableSources || []
  });

  const enrichedSpec = {
    ...reportData,
    generatedAt: reportData.generatedAt || new Date().toISOString(),
    confirmedClaims,
    unconfirmedClaims,
    citationAudit
  };

  const markdownContent = renderResearchReportMarkdown(enrichedSpec);
  const htmlContent = renderResearchReportHtml(enrichedSpec);
  const csvContent = renderComparisonTableCsv(
    enrichedSpec.criteria || [],
    enrichedSpec.comparisonRows || []
  );
  const provAndBib = buildBrowserResearchProvAndBibtex(enrichedSpec);
  const comparisonTableJson = JSON.stringify(
    {
      question: enrichedSpec.question,
      generatedAt: enrichedSpec.generatedAt,
      criteria: enrichedSpec.criteria || [],
      comparisonRows: enrichedSpec.comparisonRows || [],
      confirmedClaims,
      unconfirmedClaims,
      contradictions: enrichedSpec.contradictions || [],
      outdatedFindings: enrichedSpec.outdatedFindings || [],
      unavailableSources: enrichedSpec.unavailableSources || [],
      substitutionIncidents: enrichedSpec.substitutionIncidents || [],
      resourceMetrics: enrichedSpec.resourceMetrics || null,
      citationAudit
    },
    null,
    2
  );

  const writeOrUpdate = async (relativePath, content) => {
    try {
      return await svc.createFile({
        relativePath,
        content,
        createParents: true,
        signal
      });
    } catch (err) {
      if (err && err.code === "WORKSPACE_ALREADY_EXISTS") {
        const existing = await svc.readTextFile({ relativePath, signal });
        return await svc.updateFile({
          relativePath,
          content,
          expectedVersion: existing.version,
          signal
        });
      }
      throw err;
    }
  };

  const mdFile = await writeOrUpdate(`reports/${reportSlug}.md`, markdownContent);
  const htmlFile = await writeOrUpdate(`reports/${reportSlug}.html`, htmlContent);
  const csvFile = await writeOrUpdate(`reports/${reportSlug}-comparison.csv`, csvContent);
  const tableFile = await writeOrUpdate(
    `reports/${reportSlug}-comparison.json`,
    comparisonTableJson
  );
  const provFile = await writeOrUpdate(`reports/${reportSlug}.prov.json`, provAndBib.provJson);
  const bibFile = await writeOrUpdate(`reports/${reportSlug}.bib`, provAndBib.bibtexText);

  let docxFile = null;
  let xlsxFile = null;
  let pdfFile = null;
  let pptxFile = null;

  if (exportOfficeFormats && resolvedRoot) {
    docxFile = saveWordReportToWorkspace({
      workspaceRoot: resolvedRoot,
      relativePath: `reports/${reportSlug}.docx`,
      reportSpec: {
        title: `Исследовательский отчёт Koswork: ${enrichedSpec.question}`,
        subtitle: `Подтверждено утверждений: ${confirmedClaims.length} | Противоречий: ${(enrichedSpec.contradictions || []).length}`,
        sections: [
          {
            heading: "1. Подтверждённые утверждения (Утверждение -> Выдержка -> Источник)",
            paragraphs: confirmedClaims.map(
              (c) =>
                `${c.claim} — Выдержка [UTF-16 ${c.excerpt.startUtf16}..${c.excerpt.endUtf16}]: «${c.excerpt.quote}» (${c.source.title}, ${c.source.url}, дата на странице: ${c.source.pageDate || "н/д"}, дата события: ${c.source.eventDate || "н/д"}, получено: ${c.source.fetchedAt})`
            )
          },
          {
            heading: "2. Противоречия и недоступные источники",
            paragraphs: [
              ...(enrichedSpec.contradictions || []).map(
                (cf) => `${cf.criterion} (${cf.optionName || ""}): ${cf.summary}`
              ),
              ...(enrichedSpec.unavailableSources || []).map(
                (u) => `Недоступный источник: ${u.url} (HTTP ${u.httpStatus})`
              )
            ]
          }
        ],
        sources: confirmedClaims.map((c) => ({
          title: c.source.title,
          url: c.source.url,
          quote: c.excerpt.quote
        }))
      }
    });

    const criteriaList = enrichedSpec.criteria || [];
    xlsxFile = saveWorkbookToWorkspace({
      workspaceRoot: resolvedRoot,
      relativePath: `reports/${reportSlug}-comparison.xlsx`,
      workbookSpec: {
        sheets: [
          {
            name: "Сравнение вариантов",
            headers: ["Вариант", ...criteriaList, "Статус проверки"],
            rows: (enrichedSpec.comparisonRows || []).map((row) => [
              row.optionName,
              ...criteriaList.map((crit) => {
                const cell = row.values?.[crit];
                if (!cell) return "Неизвестно (нет выдержки)";
                return typeof cell === "object"
                  ? `${cell.displayValue} (${cell.sourceUrl} [${cell.startUtf16}..${cell.endUtf16}])`
                  : String(cell);
              }),
              row.verificationSummary || "Проверено"
            ])
          },
          {
            name: "Утверждения и выдержки",
            headers: [
              "ID",
              "Утверждение",
              "Цитата",
              "UTF-16 Start",
              "UTF-16 End",
              "URL источника",
              "Дата на странице",
              "Дата события",
              "Дата получения"
            ],
            rows: confirmedClaims.map((c) => [
              c.claimId,
              c.claim,
              c.excerpt.quote,
              c.excerpt.startUtf16,
              c.excerpt.endUtf16,
              c.source.url,
              c.source.pageDate || "",
              c.source.eventDate || "",
              c.source.fetchedAt || ""
            ])
          }
        ]
      }
    });

    pdfFile = savePdfReportToWorkspace({
      workspaceRoot: resolvedRoot,
      relativePath: `reports/${reportSlug}.pdf`,
      pdfSpec: {
        title: `Koswork Research Report: ${enrichedSpec.question}`,
        pages: [
          {
            heading: `1. Confirmed Claims (${confirmedClaims.length}) & Contradictions (${(enrichedSpec.contradictions || []).length})`,
            lines: [
              `Question: ${enrichedSpec.question}`,
              `Generated At: ${enrichedSpec.generatedAt}`,
              `Citation Audit Passed: ${citationAudit.auditPassed} (Digest: ${citationAudit.reportDigestSha256.slice(0, 16)})`,
              ...confirmedClaims.map(
                (c) =>
                  `[${c.claimId}] ${c.optionName || "Option"} | ${c.criterion || "Spec"} = ${c.value ?? ""} (${c.source.url} [${c.excerpt.startUtf16}..${c.excerpt.endUtf16}])`
              )
            ]
          }
        ]
      }
    });

    pptxFile = savePresentationToWorkspace({
      workspaceRoot: resolvedRoot,
      relativePath: `reports/${reportSlug}-deck.pptx`,
      presentationSpec: {
        title: `Исследование Koswork: ${enrichedSpec.question}`,
        slides: [
          {
            title: `Сравнение вариантов: ${enrichedSpec.question}`,
            subtitle: `Подтверждено утверждений: ${confirmedClaims.length} | Противоречий: ${(enrichedSpec.contradictions || []).length}`,
            bullets: confirmedClaims.map(
              (c) =>
                `${c.optionName || "Вариант"} (${c.criterion || "Критерий"}): ${c.value ?? c.claim} [${c.source.url} ${c.excerpt.startUtf16}..${c.excerpt.endUtf16}]`
            )
          },
          {
            title: "Противоречия, устаревшие данные и недоступные источники",
            subtitle: "Результаты перекрёстной верификации",
            bullets: [
              ...(enrichedSpec.contradictions || []).map(
                (cf) => `Противоречие (${cf.criterion}): ${cf.summary}`
              ),
              ...(enrichedSpec.unavailableSources || []).map(
                (u) => `Недоступен: ${u.url} (HTTP ${u.httpStatus})`
              )
            ]
          }
        ]
      }
    });
  }

  return {
    markdownFile: mdFile,
    htmlFile,
    csvFile,
    comparisonTableFile: tableFile,
    provFile,
    bibFile,
    docxFile,
    xlsxFile,
    pdfFile,
    pptxFile,
    citationAudit,
    confirmedClaims,
    unconfirmedClaims,
    markdownContent,
    htmlContent,
    csvContent
  };
}

module.exports = {
  renderComparisonTableCsv,
  renderResearchReportHtml,
  renderResearchReportMarkdown,
  saveResearchReportsViaWorkspace,
  validateAndClassifyClaims
};
