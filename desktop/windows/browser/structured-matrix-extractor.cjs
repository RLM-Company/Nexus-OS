"use strict";

const { extractVerifiableExcerpt } = require("./document.cjs");

/**
 * Koswork Structured HTML Matrix (`<table>`) & Definition-List (`<dl>/<dt>/<dd>`) Specification Extractor
 * (`desktop/windows/browser/structured-matrix-extractor.cjs`).
 *
 * Deepens Requirement #2 & #3:
 * - Extracts structured `(optionName, criterion, value)` cells directly from HTML comparison
 *   tables (`<table>` in either row-per-option or column-per-option orientation) and `<dl>/<dt>/<dd>`
 *   specification blocks on an open page snapshot.
 * - Binds every extracted cell to a verifiable UTF-16 excerpt (`startUtf16`, `endUtf16`, `quote`)
 *   inside `snapshot.fullTextUtf16` and preserves distinct `pageDate`, `eventDate`, and `fetchedAt`.
 */

function parseDefinitionListPairsFromHtml(html = "") {
  const pairs = [];
  const dlRegex = /<dl\b[^>]*>([\s\S]*?)<\/dl>/gi;
  let dlMatch;
  while ((dlMatch = dlRegex.exec(String(html || ""))) !== null) {
    const inner = dlMatch[1];
    const itemRegex = /<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi;
    let m;
    while ((m = itemRegex.exec(inner)) !== null) {
      const term = m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      const def = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (term && def) {
        pairs.push({ criterion: term, value: def });
      }
    }
  }
  return pairs;
}

function extractStructuredSpecsFromSnapshot({
  snapshot,
  rawHtml = "",
  defaultOptionName = "Option",
  targetOptions = [],
  targetCriteria = []
} = {}) {
  if (!snapshot || !snapshot.fullTextUtf16) {
    throw new Error("STRUCTURED_MATRIX_EXTRACTOR_REQUIRES_SNAPSHOT");
  }

  const extractedClaims = [];
  const optionFilter = new Set(
    (Array.isArray(targetOptions) ? targetOptions : []).map((o) => String(o).toLowerCase())
  );
  const criteriaFilter = new Set(
    (Array.isArray(targetCriteria) ? targetCriteria : []).map((c) => String(c).toLowerCase())
  );

  const matchesOption = (cand) =>
    optionFilter.size === 0 || optionFilter.has(String(cand || "").toLowerCase());
  const matchesCriterion = (cand) =>
    criteriaFilter.size === 0 || criteriaFilter.has(String(cand || "").toLowerCase());

  // 1. Inspect `snapshot.tables` (already parsed with UTF-16 cell offsets by `document.cjs`)
  for (const tbl of snapshot.tables || []) {
    const headers = (tbl.headers || []).map((h) => String(h || "").trim());
    const rows = tbl.rows || [];
    if (headers.length < 2 || rows.length === 0) continue;

    // Detect orientation:
    // Case A (Row-per-option): headers = ["Вариант", "Цена", "SLA", ...], row[0] = Option Alpha
    // Case B (Column-per-option): headers = ["Критерий", "Option Alpha", "Option Beta"], row[0] = "Цена"
    const headerHasOptionNames =
      optionFilter.size > 0 &&
      headers.slice(1).some((h) => optionFilter.has(h.toLowerCase()));

    if (headerHasOptionNames) {
      // Column-per-option matrix
      for (const row of rows) {
        const cells = Array.isArray(row.cells) ? row.cells : [];
        if (cells.length < 2) continue;
        const criterionName = String(cells[0].text || "").trim();
        if (!criterionName || !matchesCriterion(criterionName)) continue;

        for (let colIdx = 1; colIdx < Math.min(headers.length, cells.length); colIdx += 1) {
          const optionName = headers[colIdx];
          if (!matchesOption(optionName)) continue;
          const cell = cells[colIdx];
          const valText = String(cell.text || "").trim();
          if (!valText) continue;

          const excerpt =
            extractVerifiableExcerpt(snapshot, {
              startUtf16: cell.startUtf16,
              endUtf16: cell.endUtf16
            }) ||
            extractVerifiableExcerpt(snapshot, {
              searchTerm: valText
            });

          if (excerpt) {
            extractedClaims.push({
              claimId: `tbl-col-${extractedClaims.length + 1}`,
              optionName,
              criterion: criterionName,
              value: valText,
              claim: `${optionName}: ${criterionName} = ${valText}`,
              extractionKind: "html_table_column_matrix",
              excerpt,
              source: {
                url: snapshot.url,
                title: snapshot.title,
                pageDate: snapshot.pageDate,
                eventDate: snapshot.eventDate,
                fetchedAt: snapshot.fetchedAt
              }
            });
          }
        }
      }
    } else {
      // Row-per-option matrix
      for (const row of rows) {
        const cells = Array.isArray(row.cells) ? row.cells : [];
        if (cells.length < 2) continue;
        const optionName = String(cells[0].text || "").trim();
        if (!optionName || !matchesOption(optionName)) continue;

        for (let colIdx = 1; colIdx < Math.min(headers.length, cells.length); colIdx += 1) {
          const criterionName = headers[colIdx];
          if (!criterionName || !matchesCriterion(criterionName)) continue;
          const cell = cells[colIdx];
          const valText = String(cell.text || "").trim();
          if (!valText) continue;

          const excerpt =
            extractVerifiableExcerpt(snapshot, {
              startUtf16: cell.startUtf16,
              endUtf16: cell.endUtf16
            }) ||
            extractVerifiableExcerpt(snapshot, {
              searchTerm: valText
            });

          if (excerpt) {
            extractedClaims.push({
              claimId: `tbl-row-${extractedClaims.length + 1}`,
              optionName,
              criterion: criterionName,
              value: valText,
              claim: `${optionName}: ${criterionName} = ${valText}`,
              extractionKind: "html_table_row_matrix",
              excerpt,
              source: {
                url: snapshot.url,
                title: snapshot.title,
                pageDate: snapshot.pageDate,
                eventDate: snapshot.eventDate,
                fetchedAt: snapshot.fetchedAt
              }
            });
          }
        }
      }
    }
  }

  // 2. Inspect `<dl><dt>...</dt><dd>...</dd></dl>` specification blocks if `rawHtml` is provided
  if (rawHtml) {
    const dlPairs = parseDefinitionListPairsFromHtml(rawHtml);
    for (const pair of dlPairs) {
      if (!matchesCriterion(pair.criterion)) continue;
      if (!matchesOption(defaultOptionName)) continue;

      const excerpt =
        extractVerifiableExcerpt(snapshot, {
          searchTerm: `${pair.criterion} | ${pair.value}`
        }) ||
        extractVerifiableExcerpt(snapshot, {
          searchTerm: pair.value
        });

      if (excerpt) {
        extractedClaims.push({
          claimId: `dl-spec-${extractedClaims.length + 1}`,
          optionName: defaultOptionName,
          criterion: pair.criterion,
          value: pair.value,
          claim: `${defaultOptionName}: ${pair.criterion} = ${pair.value}`,
          extractionKind: "html_dl_definition_list",
          excerpt,
          source: {
            url: snapshot.url,
            title: snapshot.title,
            pageDate: snapshot.pageDate,
            eventDate: snapshot.eventDate,
            fetchedAt: snapshot.fetchedAt
          }
        });
      }
    }
  }

  return {
    url: snapshot.url,
    pageVersion: snapshot.pageVersion,
    extractedCount: extractedClaims.length,
    claims: extractedClaims
  };
}

module.exports = {
  parseDefinitionListPairsFromHtml,
  extractStructuredSpecsFromSnapshot
};
