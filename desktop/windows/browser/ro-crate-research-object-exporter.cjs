"use strict";

const { createKosworkWorkspaceService } = require("../workspace/workspace-service.cjs");

/**
 * Koswork W3C / ResearchObject.org RO-Crate 1.1 JSON-LD Exporter
 * (`desktop/windows/browser/ro-crate-research-object-exporter.cjs`).
 *
 * Deepens Requirements #1, #3 & #5:
 * - Packages a multi-site research session into a standard RO-Crate 1.1 JSON-LD
 *   Metadata Descriptor (`reports/<slug>-ro-crate-metadata.json`) via `workspace-service.cjs`.
 * - Preserves:
 *   1. Explicit search adapter provenance (`CreateAction` -> `instrument` with `providerId`).
 *   2. Opened `WebPage` entities with distinct `datePublished` (`pageDate`),
 *      `temporalCoverage` (`eventDate`), and `sdDatePublished` (`fetchedAt`).
 *   3. Verifiable `Quotation` entities with verbatim `text` (`quote`) and exact
 *      UTF-16 range (`position: "UTF-16 [startUtf16..endUtf16]"`).
 */

function buildRoCrateMetadataDescriptor({
  report = {},
  searchAdapterId = "koswork-configured-search",
  searchAdapterName = "Configured Search Engine Adapter"
} = {}) {
  const question = report.question || "Многосайтовое исследование Koswork Browser";
  const graph = [
    {
      "@id": "ro-crate-metadata.json",
      "@type": "CreativeWork",
      conformsTo: { "@id": "https://w3id.org/ro/crate/1.1" },
      about: { "@id": "./" }
    },
    {
      "@id": "./",
      "@type": "Dataset",
      name: question,
      description:
        "Верифицированный исследовательский пакет Koswork Browser с UTF-16 выдержками и триадой дат (pageDate, eventDate, fetchedAt).",
      datePublished: new Date().toISOString(),
      hasPart: [],
      mentions: []
    },
    {
      "@id": `#instrument-${searchAdapterId}`,
      "@type": "SoftwareApplication",
      identifier: searchAdapterId,
      name: searchAdapterName
    },
    {
      "@id": "#research-execution-action",
      "@type": "CreateAction",
      name: `Выполнение исследовательского цикла: ${question}`,
      instrument: { "@id": `#instrument-${searchAdapterId}` },
      result: { "@id": "./" }
    }
  ];

  const rootDataset = graph[1];
  const seenSources = new Set();
  let quoteCounter = 1;

  for (const row of report.comparisonRows || []) {
    const optionName = row.optionName || "Option";
    for (const [criterion, cell] of Object.entries(row.cells || {})) {
      if (!cell || !cell.quote || !Number.isInteger(cell.startUtf16) || cell.startUtf16 < 0) {
        continue;
      }
      const sourceUrl = String(cell.sourceUrl || "https://corpus.local/unknown");
      if (!seenSources.has(sourceUrl)) {
        seenSources.add(sourceUrl);
        rootDataset.hasPart.push({ "@id": sourceUrl });
        graph.push({
          "@id": sourceUrl,
          "@type": "WebPage",
          name: cell.sourceTitle || sourceUrl,
          url: sourceUrl,
          datePublished: cell.pageDate || null,
          temporalCoverage: cell.eventDate || null,
          sdDatePublished: cell.fetchedAt || null
        });
      }

      const quoteId = `#quotation-${quoteCounter}`;
      quoteCounter += 1;
      rootDataset.mentions.push({ "@id": quoteId });
      graph.push({
        "@id": quoteId,
        "@type": "Quotation",
        name: `${optionName} — ${criterion}: ${cell.displayValue || cell.value || ""}`,
        text: cell.quote,
        position: `UTF-16 [${cell.startUtf16}..${cell.endUtf16}]`,
        startUtf16: cell.startUtf16,
        endUtf16: cell.endUtf16,
        isBasedOn: { "@id": sourceUrl },
        pageDate: cell.pageDate || null,
        eventDate: cell.eventDate || null,
        fetchedAt: cell.fetchedAt || null
      });
    }
  }

  for (const unav of report.unavailableSources || []) {
    const uUrl = String(unav.url || "https://corpus.local/503");
    if (!seenSources.has(uUrl)) {
      seenSources.add(uUrl);
      graph.push({
        "@id": uUrl,
        "@type": "WebPage",
        name: `Недоступный источник (HTTP ${unav.statusCode || 503})`,
        url: uUrl,
        creativeWorkStatus: `Unavailable HTTP ${unav.statusCode || 503}`
      });
    }
  }

  return {
    "@context": "https://w3id.org/ro/crate/1.1/context",
    "@graph": graph
  };
}

async function saveRoCrateResearchPackageViaWorkspace({
  workspaceRoot,
  slug = "research-ro-crate",
  report = {},
  searchAdapterId = "koswork-configured-search",
  searchAdapterName = "Configured Search Engine Adapter",
  signal = null
} = {}) {
  const crate = buildRoCrateMetadataDescriptor({
    report,
    searchAdapterId,
    searchAdapterName
  });
  const svc = createKosworkWorkspaceService();
  await svc.connectFolder({ folderPath: workspaceRoot, signal });

  const jsonLdFile = await svc.createFile({
    relativePath: `reports/${slug}-ro-crate-metadata.json`,
    content: JSON.stringify(crate, null, 2) + "\n",
    createParents: true,
    signal
  });

  return {
    crate,
    graphEntitiesCount: crate["@graph"].length,
    jsonLdFile
  };
}

module.exports = {
  buildRoCrateMetadataDescriptor,
  saveRoCrateResearchPackageViaWorkspace
};
