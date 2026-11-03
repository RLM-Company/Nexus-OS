"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  computeDHashHammingDistance,
  computeImageDifferenceHash,
  extractDiagramTopologyFromOpenXml,
  extractVaultVisualsAndDiagrams
} = require("../vault-visual-diagram-extractor.cjs");
const { buildWordReportDocxBuffer } = require("../workspace/word-report-builder.cjs");

test("computes 64-bit difference hashes, evaluates Hamming distance, and extracts DrawingML diagram topology", () => {
  // 1. Synthetic image buffer (PNG magic bytes + gradient data)
  const syntheticImg1 = Buffer.alloc(128);
  syntheticImg1[0] = 0x89;
  syntheticImg1[1] = 0x50;
  syntheticImg1[2] = 0x4e;
  syntheticImg1[3] = 0x47;
  for (let i = 8; i < 128; i++) {
    syntheticImg1[i] = i % 256;
  }

  const hash1 = computeImageDifferenceHash(syntheticImg1);
  assert.equal(hash1.dHashHex.length, 16); // 16 hex chars = 64 bits
  assert.equal(hash1.format, "png");

  // Minor variation of the same image (1-2 byte difference)
  const syntheticImg2 = Buffer.from(syntheticImg1);
  syntheticImg2[20] = (syntheticImg2[20] + 1) % 256;
  const hash2 = computeImageDifferenceHash(syntheticImg2);

  const dist = computeDHashHammingDistance(hash1.dHashHex, hash2.dHashHex);
  assert.ok(dist <= 5, `Hamming distance between near-identical images should be small (got ${dist})`);

  // 2. OpenXML DrawingML diagram topology extraction
  const sampleDrawingXml = `
    <w:drawing>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="node-api" name="API Service"/></p:nvSpPr>
        <p:txBody><p:p><p:r><p:t>Шлюз API Kosmora</p:t></p:r></p:p></p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="node-db" name="SQLite Database"/></p:nvSpPr>
        <p:txBody><p:p><p:r><p:t>Хранилище SQLite</p:t></p:r></p:p></p:txBody>
      </p:sp>
      <p:cxnSp>
        <p:nvCxnSpPr><p:cNvPr id="edge-1" name="Connector 1"/></p:nvCxnSpPr>
        <p:spPr>
          <a:stCxn id="node-api"/>
          <a:endCxn id="node-db"/>
        </p:spPr>
      </p:cxnSp>
    </w:drawing>
  `;

  const topology = extractDiagramTopologyFromOpenXml(sampleDrawingXml);
  assert.equal(topology.totalShapes, 2);
  assert.equal(topology.totalConnectors, 1);
  assert.equal(topology.nodes[0].label, "Шлюз API Kosmora");
  assert.equal(topology.nodes[1].label, "Хранилище SQLite");
  assert.equal(topology.edges[0].fromNodeId, "node-api");
  assert.equal(topology.edges[0].toNodeId, "node-db");
  assert.equal(topology.edges[0].fromLabel, "Шлюз API Kosmora");
  assert.equal(topology.edges[0].toLabel, "Хранилище SQLite");

  // 3. Inspect a generated .docx report through extractVaultVisualsAndDiagrams
  const docxBuffer = buildWordReportDocxBuffer({
    title: "Отчёт с векторной схемой",
    sections: [{ heading: "Архитектура", paragraphs: ["Описание системы."] }]
  });

  const docVisuals = extractVaultVisualsAndDiagrams(docxBuffer, "report.docx");
  assert.equal(docVisuals.filename, "report.docx");
  assert.ok(Array.isArray(docVisuals.embeddedImages));
  assert.ok(Array.isArray(docVisuals.diagrams));
});
