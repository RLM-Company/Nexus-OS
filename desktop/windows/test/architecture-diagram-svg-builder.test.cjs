"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  saveDiagramBundleToWorkspace
} = require("../workspace/architecture-diagram-svg-builder.cjs");

test("Architecture Diagram SVG/Mermaid/DOT Compiler lays out layered nodes, renders arrowheads, and writes .svg, .mmd, and .dot files", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "koswork-diagram-"));
  try {
    const saved = saveDiagramBundleToWorkspace(tempDir, "kosmora-cognitive-loop", {
      title: "Kosmora 20-Module Cognitive Pipeline",
      nodes: [
        { id: "orchestrator", label: "Cognitive Orchestrator", layer: 0, kind: "agent" },
        { id: "persona", label: "Adaptive Persona & Style", layer: 1, kind: "service" },
        { id: "tot", label: "Tree-of-Thoughts Beam", layer: 1, kind: "agent" },
        { id: "sqlite", label: "Ebbinghaus Memory DB", layer: 2, kind: "database" }
      ],
      edges: [
        { from: "orchestrator", to: "persona", label: "style" },
        { from: "orchestrator", to: "tot", label: "beam=3" },
        { from: "tot", to: "sqlite", label: "recall" }
      ]
    });

    assert.equal(fs.existsSync(saved.svgPath), true);
    assert.equal(fs.existsSync(saved.mmdPath), true);
    assert.equal(fs.existsSync(saved.dotPath), true);

    const svgText = fs.readFileSync(saved.svgPath, "utf8");
    const mmdText = fs.readFileSync(saved.mmdPath, "utf8");
    const dotText = fs.readFileSync(saved.dotPath, "utf8");

    assert.ok(svgText.includes("<marker id=\"arrow\""));
    assert.ok(svgText.includes("Kosmora 20-Module Cognitive Pipeline"));
    assert.ok(mmdText.includes("flowchart TD"));
    assert.ok(mmdText.includes("orchestrator -->|beam=3| tot"));
    assert.ok(dotText.includes("digraph KosmoraArchitecture"));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
