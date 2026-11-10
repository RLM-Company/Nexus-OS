"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

/**
 * Zero-dependency W3C PROV-JSON Data Provenance Lineage Graph (.prov.json) &
 * BibTeX Academic Citation Bundle Builder (.bib).
 */
function buildProvLineageAndBibtex(spec = {}) {
  const namespaceUri = spec.namespaceUri || "https://kosmora.local/prov/";
  const entities = Array.isArray(spec.entities) ? spec.entities : [];
  const activities = Array.isArray(spec.activities) ? spec.activities : [];
  const agents = Array.isArray(spec.agents) ? spec.agents : [];
  const derivations = Array.isArray(spec.derivations) ? spec.derivations : [];
  const citations = Array.isArray(spec.citations) ? spec.citations : [];

  const provEntityMap = {};
  for (const e of entities) {
    provEntityMap[`kosmora:${e.id}`] = {
      "prov:type": e.type || "prov:Entity",
      "prov:label": e.label || e.id,
      ...(e.sha256 ? { "kosmora:sha256": e.sha256 } : {})
    };
  }

  const provActivityMap = {};
  for (const a of activities) {
    provActivityMap[`kosmora:${a.id}`] = {
      "prov:startTime": a.startTimeIso || new Date().toISOString(),
      "prov:endTime": a.endTimeIso || new Date().toISOString(),
      "prov:label": a.label || a.id
    };
  }

  const provAgentMap = {};
  for (const ag of agents) {
    provAgentMap[`kosmora:${ag.id}`] = {
      "prov:type": ag.type || "prov:SoftwareAgent",
      "prov:label": ag.label || ag.id
    };
  }

  const wasDerivedFromMap = {};
  derivations.forEach((d, idx) => {
    wasDerivedFromMap[`_:wdf${idx + 1}`] = {
      "prov:generatedEntity": `kosmora:${d.generatedEntityId}`,
      "prov:usedEntity": `kosmora:${d.usedEntityId}`,
      ...(d.activityId ? { "prov:activity": `kosmora:${d.activityId}` } : {})
    };
  });

  const provJsonObj = {
    prefix: {
      prov: "http://www.w3.org/ns/prov#",
      kosmora: namespaceUri
    },
    entity: provEntityMap,
    activity: provActivityMap,
    agent: provAgentMap,
    wasDerivedFrom: wasDerivedFromMap
  };

  const bibBlocks = citations.map((c, idx) => {
    const citeKey = String(c.key || `kosmoraRef${idx + 1}`).replace(/[^a-zA-Z0-9_:-]/g, "");
    const entryType = c.entryType || "article";
    const fields = [
      `  author = {${c.author || "Kosmora Research Group"}}`,
      `  title = {${c.title || "Autonomous OS Formal Verification"}}`,
      `  year = {${c.year || 2026}}`
    ];
    if (c.journalOrBooktitle) {
      fields.push(`  journal = {${c.journalOrBooktitle}}`);
    }
    if (c.url) {
      fields.push(`  url = {${c.url}}`);
    }
    return `@${entryType}{${citeKey},\n${fields.join(",\n")}\n}`;
  });

  return {
    provJson: JSON.stringify(provJsonObj, null, 2) + "\n",
    bibtexText: bibBlocks.join("\n\n") + "\n",
    entityCount: entities.length,
    citationCount: citations.length
  };
}

function saveProvAndBibtexToWorkspace(workspaceDir, baseName, spec) {
  if (!workspaceDir || typeof workspaceDir !== "string") {
    throw new Error("WORKSPACE_REQUIRED");
  }
  const cleanBase = path
    .basename(baseName || "lineage-citations")
    .replace(/\.(prov\.json|json|bib)$/i, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_");
  const resolvedWorkspace = path.resolve(workspaceDir);

  const provPath = path.resolve(resolvedWorkspace, `${cleanBase}.prov.json`);
  const bibPath = path.resolve(resolvedWorkspace, `${cleanBase}.bib`);

  if (!provPath.startsWith(resolvedWorkspace + path.sep)) {
    throw new Error("PATH_TRAVERSAL_BLOCKED");
  }

  fs.mkdirSync(resolvedWorkspace, { recursive: true });
  const built = buildProvLineageAndBibtex(spec);
  fs.writeFileSync(provPath, built.provJson, "utf8");
  fs.writeFileSync(bibPath, built.bibtexText, "utf8");

  return {
    provPath,
    bibPath,
    entityCount: built.entityCount,
    citationCount: built.citationCount,
    sha256: crypto
      .createHash("sha256")
      .update(built.provJson + built.bibtexText, "utf8")
      .digest("hex")
  };
}

module.exports = {
  buildProvLineageAndBibtex,
  saveProvAndBibtexToWorkspace
};
