"use strict";

const { createKosworkWorkspaceService } = require("../workspace/workspace-service.cjs");

/**
 * Koswork CSL-JSON (Citation Style Language) & RIS Bibliography Exporter
 * (`desktop/windows/browser/csl-json-and-ris-bibliography-exporter.cjs`).
 *
 * Deepens Requirements #1, #3 & #5:
 * - Exports verified research sources and their UTF-16 `[startUtf16..endUtf16]` quotes
 *   into standard reference-manager formats:
 *   1. CSL-JSON (`reports/<slug>-csl.json`, compatible with Zotero, Mendeley, Pandoc citeproc)
 *   2. RIS (`reports/<slug>.ris`, Research Information Systems `TY  - ELEC`)
 *   via `workspace-service.cjs`.
 * - Preserves distinct `issued` (`pageDate`), `event-date` (`eventDate`), and `accessed`
 *   (`fetchedAt`) fields on every bibliographic record.
 */

function parseDateParts(isoStr = "") {
  const m = String(isoStr || "")
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return {
    "date-parts": [[Number(m[1]), Number(m[2]), Number(m[3])]]
  };
}

function buildCslJsonAndRisBibliography(report = {}) {
  const byUrl = new Map();

  for (const row of report.comparisonRows || []) {
    const optionName = row.optionName || "Option";
    for (const [criterion, cell] of Object.entries(row.cells || {})) {
      if (!cell || !cell.quote || !Number.isInteger(cell.startUtf16) || cell.startUtf16 < 0) {
        continue;
      }
      const url = String(cell.sourceUrl || "https://corpus.local/unknown");
      if (!byUrl.has(url)) {
        byUrl.set(url, {
          url,
          title: cell.sourceTitle || url,
          pageDate: cell.pageDate || null,
          eventDate: cell.eventDate || null,
          fetchedAt: cell.fetchedAt || null,
          excerpts: []
        });
      }
      byUrl.get(url).excerpts.push({
        optionName,
        criterion,
        value: cell.displayValue || cell.value || "",
        quote: cell.quote,
        startUtf16: cell.startUtf16,
        endUtf16: cell.endUtf16
      });
    }
  }

  const cslItems = [];
  const risBlocks = [];
  let idx = 1;

  for (const src of byUrl.values()) {
    const id = `koswork-ref-${idx}`;
    idx += 1;

    const noteSummary = src.excerpts
      .map(
        (e) =>
          `${e.optionName} / ${e.criterion} = ${e.value}: «${e.quote}» [UTF-16 ${e.startUtf16}..${e.endUtf16}]`
      )
      .join(" | ");

    const cslEntry = {
      id,
      type: "webpage",
      title: src.title,
      URL: src.url,
      issued: parseDateParts(src.pageDate),
      "event-date": parseDateParts(src.eventDate),
      accessed: parseDateParts(src.fetchedAt),
      note: noteSummary
    };
    cslItems.push(cslEntry);

    const year = String(src.eventDate || src.pageDate || "2026").slice(0, 4);
    const risLines = [
      "TY  - ELEC",
      `ID  - ${id}`,
      `TI  - ${src.title}`,
      `UR  - ${src.url}`,
      `PY  - ${year}`,
      `DA  - ${src.pageDate || ""}`,
      `Y2  - ${src.fetchedAt || ""}`,
      `N1  - eventDate: ${src.eventDate || "n/a"} | ${noteSummary}`,
      "ER  - "
    ];
    risBlocks.push(risLines.join("\n"));
  }

  return {
    itemsCount: cslItems.length,
    cslJson: cslItems,
    risText: risBlocks.join("\n\n") + "\n"
  };
}

async function saveCslJsonAndRisBibliographyViaWorkspace({
  workspaceRoot,
  slug = "research-bibliography",
  report = {},
  signal = null
} = {}) {
  const built = buildCslJsonAndRisBibliography(report);
  const svc = createKosworkWorkspaceService();
  await svc.connectFolder({ folderPath: workspaceRoot, signal });

  const cslFile = await svc.createFile({
    relativePath: `reports/${slug}-csl.json`,
    content: JSON.stringify(built.cslJson, null, 2) + "\n",
    createParents: true,
    signal
  });
  const risFile = await svc.createFile({
    relativePath: `reports/${slug}.ris`,
    content: built.risText,
    createParents: true,
    signal
  });

  return {
    ...built,
    cslFile,
    risFile
  };
}

module.exports = {
  buildCslJsonAndRisBibliography,
  saveCslJsonAndRisBibliographyViaWorkspace
};
