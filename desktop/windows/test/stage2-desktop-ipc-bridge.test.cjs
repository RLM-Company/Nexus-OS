"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Stage2DesktopIpcBridge } = require("../ci/stage2-desktop-ipc-bridge.cjs");
const { buildWordReportDocxBuffer } = require("../workspace/word-report-builder.cjs");

test("blocks untrusted remote web origins from invoking Koswork native IPC and routes trusted local/first-party calls", async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "koswork-ipc-bridge-"));

  try {
    const bridge = new Stage2DesktopIpcBridge({
      allowedOrigins: ["http://127.0.0.1:3300"],
      activeOwnerId: "local-owner",
      workspaceRoot
    });

    // 1. Untrusted remote web page inside agent browser MUST be blocked with UNTRUSTED_IPC_SENDER_ORIGIN
    await assert.rejects(
      () =>
        bridge.invoke(
          "koswork:computer:check-hazard",
          { senderFrame: { url: "https://malicious-site.example.org/exploit" } },
          { action: { kind: "click", targetLabel: "Button" } }
        ),
      /UNTRUSTED_IPC_SENDER_ORIGIN/
    );

    // 2. Mismatched owner session MUST be blocked with IPC_OWNER_SESSION_MISMATCH
    await assert.rejects(
      () =>
        bridge.invoke(
          "koswork:computer:check-hazard",
          { senderFrame: { url: "http://127.0.0.1:3300/studio" }, ownerId: "other-user" },
          { action: { kind: "click", targetLabel: "Button" } }
        ),
      /IPC_OWNER_SESSION_MISMATCH/
    );

    // 3. Trusted local file:// shell can invoke document extraction and unified tasks
    const docxBuffer = buildWordReportDocxBuffer({
      title: "Проверка IPC моста Koswork",
      sections: [{ heading: "Раздел IPC", paragraphs: ["Безопасное извлечение через IPC."] }]
    });

    const extractedSlice = await bridge.invoke(
      "koswork:vault:extract-doc",
      { senderFrame: { url: "file:///C:/Program%20Files/Kosmora/connection.html" } },
      { buffer: docxBuffer, filename: "ipc-test.docx", chunkIndex: 1 }
    );
    assert.equal(extractedSlice.format, "docx");
    assert.match(extractedSlice.text, /Проверка IPC моста Koswork/);

    const unifiedRes = await bridge.invoke(
      "koswork:unified:run-task",
      {
        senderFrame: { url: "http://127.0.0.1:3300/work" },
        ownerId: "local-owner"
      },
      {
        plan: {
          searchQuery: "Интеграция IPC моста Koswork",
          mockOrLiveSearchResults: [
            {
              title: "Спецификация IPC",
              url: "https://github.com/RLM-Company/Nexus-OS",
              snippet: "Каждое сообщение проверяется по источнику и владельцу."
            }
          ],
          outputRelativePath: "reports/IPC-Unified-Report.docx"
        }
      }
    );
    assert.equal(unifiedRes.status, "completed");
    assert.equal(fs.existsSync(unifiedRes.savedReport.absolutePath), true);
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
