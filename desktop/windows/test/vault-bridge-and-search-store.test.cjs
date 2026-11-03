"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  VaultVirtualBridge,
  sliceUtf16SurrogateSafe
} = require("../vault-virtual-bridge.cjs");
const {
  KosworkSearchAndBrowserStore
} = require("../browser/search-pagination-and-bookmarks.cjs");
const { buildWordReportDocxBuffer } = require("../workspace/word-report-builder.cjs");

test("never splits UTF-16 surrogate pairs and reads .kosmora-vault/<SHA256>/<offset> across .docx and UTF-8 files while preserving grants across workspace switch", () => {
  // "АБ🚀ВГ" -> 'А'(0), 'Б'(1), high-surrogate(2), low-surrogate(3), 'В'(4), 'Г'(5)
  const sample = "АБ🚀ВГ";
  // Requesting maxUnits = 3 from offset 0 would end at index 3 (splitting 🚀 at 2..3); must step back to 2 ("АБ")
  const slice1 = sliceUtf16SurrogateSafe(sample, 0, 3);
  assert.equal(slice1.slice, "АБ");
  assert.equal(slice1.endOffset, 2);
  assert.equal(slice1.nextOffset, 2);

  // Requesting from offset 3 (landing on low surrogate of 🚀) must step back to 2 so 🚀 is intact
  const slice2 = sliceUtf16SurrogateSafe(sample, 3, 4);
  assert.equal(slice2.startOffset, 2);
  assert.equal(slice2.slice, "🚀ВГ");

  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), "koswork-vault-bridge-"));
  const regularWorkspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "koswork-reg-ws-"));

  try {
    const docxBuf = buildWordReportDocxBuffer({
      title: "Бинарный документ Word в виртуальном сейфе",
      sections: [
        {
          heading: "Раздел 1",
          paragraphs: ["Текст внутри .docx распознаётся через .kosmora-vault/<SHA256>/<offset>."]
        }
      ]
    });
    fs.writeFileSync(path.join(vaultDir, "spec.docx"), docxBuf);
    fs.writeFileSync(path.join(vaultDir, "notes.txt"), "Заметка с эмодзи 🪐 и текстом.", "utf8");

    const bridge = new VaultVirtualBridge({ maxSerializedBytes: 24000 });
    const indexed = bridge.indexVaultDirectory(vaultDir);
    assert.equal(indexed.indexedCount, 2);

    bridge.issueTaskScopedGrant("task-101", { preserveAcrossWorkspaceSwitch: true });

    // Switching regular workspace folder keeps the preserved vault grant active
    const switchRes = bridge.connectRegularWorkspaceFolder(regularWorkspaceDir, {
      revokeVaultGrants: true
    });
    assert.equal(switchRes.activeVaultGrants, 1);

    const docxSha = Array.from(bridge.filesBySha256.values()).find(
      (f) => f.format === "docx"
    ).sha256;

    const readRes = bridge.readVirtualUri("task-101", `.kosmora-vault/${docxSha}/0`, {
      maxUnits: 40
    });
    assert.equal(readRes.format, "docx");
    assert.match(readRes.content, /Бинарный документ Word/);
    assert.ok(readRes.nextUri);

    // Verify explicit error if serialized response exceeds maxSerializedBytes (never truncates JSON)
    const tinyBridge = new VaultVirtualBridge({ maxSerializedBytes: 80 });
    tinyBridge.indexVaultDirectory(vaultDir);
    tinyBridge.issueTaskScopedGrant("task-102");
    assert.throws(
      () => tinyBridge.readVirtualUri("task-102", `.kosmora-vault/${docxSha}/0`),
      /VAULT_SERIALIZED_RESPONSE_TOO_LARGE/
    );
  } finally {
    fs.rmSync(vaultDir, { recursive: true, force: true });
    fs.rmSync(regularWorkspaceDir, { recursive: true, force: true });
  }
});

test("paginates DuckDuckGo search journal without leaking query in URL, stores bookmarks, and enforces 3-WebContentsView cap", () => {
  const store = new KosworkSearchAndBrowserStore();

  const rawHits = Array.from({ length: 12 }, (_, i) => ({
    title: `Источник #${i + 1}`,
    url: `https://example.org/doc-${i + 1}`,
    snippet: `Выдержка для документа номер ${i + 1}`
  }));

  const page1 = store.recordAndPaginateSearch({
    query: "архитектура памяти Kosmora",
    results: rawHits,
    page: 1,
    pageSize: 5
  });

  assert.equal(page1.items.length, 5);
  assert.equal(page1.totalPages, 3);
  assert.equal(page1.hasNextPage, true);
  assert.match(page1.navigationUrl, /^koswork:\/\/search\/srch-/);
  assert.equal(page1.navigationUrl.includes("архитектура"), false);

  const page3 = store.getSearchPage(page1.searchId, { page: 3, pageSize: 5 });
  assert.equal(page3.items.length, 2);
  assert.equal(page3.hasNextPage, false);
  assert.equal(page3.hasPreviousPage, true);

  const bm = store.addBookmark({
    url: "https://github.com/RLM-Company/Nexus-OS",
    title: "Репозиторий Nexus-OS",
    folder: "Разработка"
  });
  assert.equal(store.listBookmarks().length, 1);
  assert.equal(bm.folder, "Разработка");

  // Register 4 tabs -> oldest tab ('tab-1') must be evicted to maintain 3 loaded WebContentsViews
  store.registerWebViewUsage("tab-1", { ramMb: 110, cpuPercent: 4, domTokensEstimated: 1200, lastActiveAt: 1000 });
  store.registerWebViewUsage("tab-2", { ramMb: 120, cpuPercent: 5, domTokensEstimated: 1500, lastActiveAt: 2000 });
  store.registerWebViewUsage("tab-3", { ramMb: 130, cpuPercent: 6, domTokensEstimated: 1800, lastActiveAt: 3000 });
  const viewSummary = store.registerWebViewUsage("tab-4", {
    ramMb: 140,
    cpuPercent: 7,
    domTokensEstimated: 2000,
    lastActiveAt: 4000
  });

  assert.equal(viewSummary.activeLoadedViews, 3);
  assert.deepEqual(viewSummary.evictedTabIds, ["tab-1"]);
  assert.equal(viewSummary.totalRamMb, 390);
  assert.equal(viewSummary.totalDomTokens, 5300);
});
