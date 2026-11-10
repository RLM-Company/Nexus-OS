"use strict";

const { buildProvLineageAndBibtex } = require("../workspace/prov-lineage-and-citation-builder.cjs");

/**
 * Koswork Browser Research W3C PROV-O Lineage & BibTeX Bibliography Exporter
 * (`desktop/windows/browser/prov-lineage-exporter.cjs`).
 *
 * Maps a completed Browser Research Report into a W3C PROV-JSON graph (`prov:Entity`,
 * `prov:Activity`, `prov:Agent`, `prov:wasDerivedFrom`) and BibTeX citation bundle (`.bib`),
 * proving the exact derivation chain:
 * `claim (Entity) -> wasDerivedFrom -> excerpt (Entity [UTF-16 offsets]) -> wasDerivedFrom -> source (Entity [URL, pageDate, eventDate, fetchedAt])`.
 */
function buildBrowserResearchProvAndBibtex(reportSpec = {}) {
  const entities = [];
  const activities = [];
  const agents = [
    {
      id: "agent-koswork-browser-research",
      type: "prov:SoftwareAgent",
      label: "Koswork Browser Research Engine"
    }
  ];
  const derivations = [];
  const citations = [];

  const generatedAt = reportSpec.generatedAt || new Date().toISOString();
  const activityId = "act-multi-site-research-cycle";
  activities.push({
    id: activityId,
    startTimeIso: generatedAt,
    endTimeIso: generatedAt,
    label: `Исследовательский цикл: ${reportSpec.question || "Browser Research"}`
  });

  const seenSourceUrls = new Map();
  let sourceIndex = 0;

  const registerSourceEntity = (src) => {
    if (!src || !src.url) return null;
    if (seenSourceUrls.has(src.url)) {
      return seenSourceUrls.get(src.url);
    }
    sourceIndex += 1;
    const srcEntityId = `source-${sourceIndex}`;
    seenSourceUrls.set(src.url, srcEntityId);

    entities.push({
      id: srcEntityId,
      type: "prov:Entity",
      label: `${src.title || src.url} (${src.url}) [pageDate=${src.pageDate || "n/a"}, eventDate=${
        src.eventDate || "n/a"
      }, fetchedAt=${src.fetchedAt || generatedAt}]`
    });

    const yearMatch = String(src.pageDate || src.eventDate || generatedAt).match(/\b(\d{4})\b/);
    citations.push({
      key: `kosworkSrc${sourceIndex}`,
      entryType: "misc",
      author: src.providerId || "Web Source",
      title: src.title || src.url,
      year: yearMatch ? Number(yearMatch[1]) : 2026,
      url: src.url
    });
    return srcEntityId;
  };

  for (const src of reportSpec.sources || []) {
    registerSourceEntity(src);
  }

  for (const claim of reportSpec.confirmedClaims || []) {
    const exc = claim.excerpt;
    const src = claim.source;
    if (!exc || !src) continue;

    const srcEntityId = registerSourceEntity(src);

    const excEntityId = exc.excerptId || `excerpt-${claim.claimId}`;
    entities.push({
      id: excEntityId,
      type: "prov:Entity",
      label: `UTF-16 [${exc.startUtf16}..${exc.endUtf16}]: "${exc.quote}"`
    });

    const claimEntityId = claim.claimId || `claim-${entities.length + 1}`;
    entities.push({
      id: claimEntityId,
      type: "prov:Entity",
      label: claim.claim
    });

    // Derivation 1: excerpt <- source
    derivations.push({
      generatedEntityId: excEntityId,
      usedEntityId: srcEntityId,
      activityId
    });

    // Derivation 2: claim <- excerpt
    derivations.push({
      generatedEntityId: claimEntityId,
      usedEntityId: excEntityId,
      activityId
    });
  }

  const built = buildProvLineageAndBibtex({
    namespaceUri: "https://koswork.local/browser-research/prov/",
    entities,
    activities,
    agents,
    derivations,
    citations
  });

  const provJsonObject = JSON.parse(built.provJson);

  return {
    ...built,
    provJsonObject,
    bibtex: built.bibtexText
  };
}

module.exports = {
  buildBrowserResearchProvAndBibtex
};
