"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  buildProvLineageAndBibtex,
  saveProvAndBibtexToWorkspace
} = require("../workspace/prov-lineage-and-citation-builder.cjs");

test("W3C PROV-JSON Lineage & BibTeX Builder emits valid derivation graphs and citations", () => {
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "kosmora-prov-bib-"));

  const built = buildProvLineageAndBibtex({
    entities: [
      { id: "dataset-raw", label: "Raw Telemetry Stream" },
      { id: "report-final", label: "Verified Audit Report", sha256: "abc123" }
    ],
    activities: [{ id: "act-verify", label: "ROBDD Equivalence Check" }],
    agents: [{ id: "agent-verifier", label: "Kosmora Verifier v2.15" }],
    derivations: [
      {
        generatedEntityId: "report-final",
        usedEntityId: "dataset-raw",
        activityId: "act-verify"
      }
    ],
    citations: [
      {
        key: "bryant1986bdd",
        author: "Randal E. Bryant",
        title: "Graph-Based Algorithms for Boolean Function Manipulation",
        year: 1986,
        journalOrBooktitle: "IEEE Transactions on Computers"
      }
    ]
  });

  assert.equal(built.entityCount, 2);
  assert.equal(built.citationCount, 1);
  const prov = JSON.parse(built.provJson);
  assert.ok(prov.entity["kosmora:report-final"]);
  assert.match(built.bibtexText, /@article\{bryant1986bdd/);

  const saved = saveProvAndBibtexToWorkspace(workspaceDir, "audit-lineage", {
    entities: [{ id: "e1" }],
    citations: [{ key: "ref1" }]
  });

  assert.equal(fs.existsSync(saved.provPath), true);
  assert.equal(fs.existsSync(saved.bibPath), true);
  assert.equal(saved.sha256.length, 64);

  assert.throws(() => {
    saveProvAndBibtexToWorkspace("", "invalid", {});
  }, /WORKSPACE_REQUIRED/);
});
