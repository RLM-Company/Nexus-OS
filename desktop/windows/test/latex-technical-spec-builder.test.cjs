"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  buildLatexTechnicalSpec,
  saveLatexSpecToWorkspace
} = require("../workspace/latex-technical-spec-builder.cjs");

test("LaTeX2e Technical Specification Builder generates valid .tex documents with theorems, equations, booktabs tables, and provenance SHA-256", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "koswork-latex-spec-"));
  try {
    const spec = {
      title: "Formal Verification of Kosmora Stage-2 Cognitive Architecture",
      author: "Kosmora Engineering",
      date: "2026-11-04",
      abstract: "We present a 16-module neuro-symbolic cognitive architecture with 0% constraint loss.",
      sections: [
        {
          heading: "1. Asymmetric Distance Computation in Product Quantization",
          paragraphs: [
            "Using M=8 subspaces with K=16 centroids achieves a 32x memory reduction on 1 GB RAM nodes."
          ],
          theorem: {
            name: "Zero Mandatory Constraint Loss",
            statement: "For any prompt budget B >= M_mandatory, 100% of pinned constraints are retained."
          },
          equationLatex: "d_{ADC}(q, y) = \\sum_{m=1}^{M} \\| q^{(m)} - c_m(i_m(y)) \\|_2^2",
          table: {
            caption: "Memory Footprint per 10,000 Vectors",
            headers: ["Representation", "Bytes / Vector", "Total RAM"],
            rows: [
              ["Float32 (64-dim)", "256 B", "2.56 MB"],
              ["PQ-8 (uint8)", "8 B", "80 KB"]
            ]
          }
        }
      ],
      citations: [
        {
          title: "Kosmora Repository",
          url: "https://github.com/RLM-Company/Nexus-OS"
        }
      ]
    };

    const saved = saveLatexSpecToWorkspace(tempDir, "kosmora-formal-spec.tex", spec);
    assert.equal(fs.existsSync(saved.filePath), true);
    assert.ok(saved.byteLength > 600);

    const tex = fs.readFileSync(saved.filePath, "utf8");
    assert.ok(tex.includes("\\documentclass[11pt,a4paper]{article}"));
    assert.ok(tex.includes("\\begin{theorem}[Zero Mandatory Constraint Loss]"));
    assert.ok(tex.includes("\\begin{equation}"));
    assert.ok(tex.includes("\\toprule"));
    assert.ok(tex.includes("\\bibitem{ref1}"));
    assert.ok(tex.includes("% KOSWORK_PROVENANCE_SHA256:"));

    // Verify special character escaping outside math mode
    const escapedTex = buildLatexTechnicalSpec({
      title: "Cost $100 & 100% Reliability_Check"
    });
    assert.ok(escapedTex.includes("Cost \\$100 \\& 100\\% Reliability\\_Check"));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
