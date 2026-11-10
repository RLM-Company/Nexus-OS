"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  collectPiercedInteractiveSnapshot,
  resolveDeepSelector
} = require("../browser/shadow-and-frame-piercer.cjs");
const { saveWordReportToWorkspace } = require("../workspace/word-report-builder.cjs");
const { extractVaultDocument } = require("../vault-document-extractor.cjs");

test("pierces nested open Shadow DOM and same-origin iframes while isolating cross-origin frames", () => {
  const shadowSaveBtn = {
    tagName: "BUTTON",
    id: "shadow-save-btn",
    innerText: "Сохранить изменения в Shadow DOM"
  };

  const shadowHost = {
    tagName: "KOSWORK-WIDGET",
    id: "widget-host",
    shadowRoot: {
      children: [shadowSaveBtn]
    },
    children: []
  };

  const iframeInput = {
    tagName: "INPUT",
    id: "frame-search-input",
    value: "Запрос внутри фрейма"
  };

  const sameOriginIframe = {
    tagName: "IFRAME",
    id: "local-editor-frame",
    src: "https://local.koswork/editor",
    contentDocument: {
      body: {
        children: [iframeInput]
      }
    },
    children: []
  };

  const crossOriginIframe = {
    tagName: "IFRAME",
    id: "external-oauth-frame",
    src: "https://accounts.external.example/oauth",
    contentDocument: {
      body: {
        children: [
          {
            tagName: "BUTTON",
            id: "secret-external-btn",
            innerText: "Should never be pierced"
          }
        ]
      }
    },
    children: []
  };

  const rootDoc = {
    location: { origin: "https://local.koswork" },
    body: {
      children: [shadowHost, sameOriginIframe, crossOriginIframe]
    }
  };

  const snapshot = collectPiercedInteractiveSnapshot(rootDoc, {
    baseOrigin: "https://local.koswork"
  });

  assert.equal(snapshot.totalInteractive, 2);
  assert.equal(snapshot.skippedCrossOriginFrames.length, 1);
  assert.equal(snapshot.skippedCrossOriginFrames[0].reason, "cross_origin_isolated");

  const shadowHit = snapshot.elements.find((e) => e.id === "shadow-save-btn");
  assert.ok(shadowHit);
  assert.equal(shadowHit.inShadowDom, true);
  assert.equal(resolveDeepSelector(rootDoc, shadowHit.deepSelector), shadowSaveBtn);

  const frameHit = snapshot.elements.find((e) => e.id === "frame-search-input");
  assert.ok(frameHit);
  assert.equal(frameHit.inIframe, true);
  assert.equal(resolveDeepSelector(rootDoc, frameHit.deepSelector), iframeInput);
});

test("builds a multi-section .docx report with verified sources in the workspace folder and extracts its text back cleanly", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "koswork-word-report-"));

  try {
    const saved = saveWordReportToWorkspace({
      workspaceRoot,
      relativePath: "reports/Koswork-Acceptance-Report.docx",
      reportSpec: {
        title: "Итоговый отчёт Koswork по источникам",
        subtitle: "Автономный сценарий: браузер + рабочая папка + Word (.docx)",
        sections: [
          {
            heading: "1. Сводка исследования",
            paragraphs: [
              "Модуль объединяет локальный поиск в браузере Koswork, чтение сейфа знаний и генерацию документа Word.",
              "Все изменения сохраняются строго внутри выбранной владельцем рабочей папки."
            ]
          }
        ],
        sources: [
          {
            title: "Спецификация памяти Kosmora",
            url: "https://github.com/RLM-Company/Nexus-OS/pull/417",
            quote: "Лимит контекстной памяти составляет до 32 фрагментов и 6000 байт UTF-8."
          }
        ]
      }
    });

    assert.equal(saved.saved, true);
    assert.ok(saved.sizeBytes > 500);
    assert.equal(fs.existsSync(saved.absolutePath), true);

    // Verify our Local Vault extractor parses the generated .docx report with 100% fidelity
    const extracted = extractVaultDocument(fs.readFileSync(saved.absolutePath), { filename: saved.relativePath });
    assert.equal(extracted.format, "docx");
    assert.equal(extracted.extractionStatus, "extracted");
    assert.match(extracted.text, /Итоговый отчёт Koswork по источникам/);
    assert.match(extracted.text, /Спецификация памяти Kosmora/);
    assert.match(extracted.text, /32 фрагментов и 6000 байт UTF-8/);
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
