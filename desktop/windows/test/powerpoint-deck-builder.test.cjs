"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  buildPowerPointPptxBuffer,
  savePresentationToWorkspace
} = require("../workspace/powerpoint-deck-builder.cjs");
const { extractVaultDocument } = require("../vault-document-extractor.cjs");

test("buildPowerPointPptxBuffer and savePresentationToWorkspace write multi-slide .pptx files that round-trip through vault-document-extractor", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "koswork-pptx-test-"));
  try {
    const presentationSpec = {
      title: "Project Apollo Executive Review",
      slides: [
        {
          title: "Project Apollo Overview",
          subtitle: "Q4 2026 Strategic Launch",
          bullets: [
            "Confirmed Launch Budget: $250,000",
            "Target Release Date: November 15, 2026"
          ]
        },
        {
          title: "Autonomous OS Architecture",
          subtitle: "Stage-2 Verification Matrix",
          bullets: [
            "100% Test Suite Coverage",
            "Prompt Caching Hit Rate: 87.3%"
          ]
        }
      ]
    };

    const saved = savePresentationToWorkspace({
      workspaceRoot: tempRoot,
      relativePath: "presentations/Apollo-Executive-Deck.pptx",
      presentationSpec
    });

    assert.equal(saved.saved, true);
    assert.equal(saved.format, "pptx");
    assert.ok(saved.sizeBytes > 300);
    assert.ok(fs.existsSync(saved.absolutePath));

    // Round-trip extract via vault-document-extractor.cjs
    const pptxBuf = fs.readFileSync(saved.absolutePath);
    const extracted = extractVaultDocument(pptxBuf, { filename: "Apollo-Executive-Deck.pptx" });
    assert.equal(extracted.format, "pptx");
    assert.equal(extracted.sectionCount, 2);
    assert.ok(extracted.text.includes("Project Apollo Overview"));
    assert.ok(extracted.text.includes("$250,000"));
    assert.ok(extracted.text.includes("Autonomous OS Architecture"));
    assert.ok(extracted.text.includes("87.3%"));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
