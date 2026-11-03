"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  KosworkUnifiedTaskCoordinator
} = require("../ci/unified-task-coordinator.cjs");

test("executes a unified planned task across browser search, desktop app focus verification, and Word .docx report generation", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "koswork-unified-coord-"));

  try {
    const coordinator = new KosworkUnifiedTaskCoordinator({ workspaceRoot });

    const res = coordinator.executeUnifiedResearchAndReportTask({
      searchQuery: "Сценарии Koswork и память Kosmora",
      mockOrLiveSearchResults: [
        {
          title: "Документация Koswork Workflows",
          url: "https://github.com/RLM-Company/Nexus-OS/pull/428",
          snippet: "Поддерживаются 3 шаблона, проверка Критиком и выгрузка результатов в ZIP."
        },
        {
          title: "Квитанции источников памяти",
          url: "https://github.com/RLM-Company/Nexus-OS/pull/424",
          snippet: "Хранение до 500 квитанций на владельца со ссылками и SHA-256."
        }
      ],
      desktopAction: {
        kind: "type",
        targetLabel: "Редактор заметок",
        text: "Сводка сохранена в отчёт Word"
      },
      expectedWindow: { hwnd: "0x0044AA", processName: "notepad.exe" },
      actualForegroundWindow: { hwnd: "0x0044AA", processName: "NOTEPAD.EXE", minimized: false },
      outputRelativePath: "reports/Koswork-Unified-Output.docx",
      reportTitle: "Единый отчёт задачи Koswork"
    });

    assert.equal(res.status, "completed");
    assert.equal(res.historyChainLength, 3);
    assert.match(res.verifiedExtract.text, /Единый отчёт задачи Koswork/);
    assert.match(res.verifiedExtract.text, /Поддерживаются 3 шаблона/);

    // Verify halting when foreground window focus is stolen
    assert.throws(
      () =>
        coordinator.executeUnifiedResearchAndReportTask({
          searchQuery: "Повторная задача",
          mockOrLiveSearchResults: [],
          desktopAction: { kind: "click", targetLabel: "Кнопка" },
          expectedWindow: { hwnd: "0x0044AA", processName: "notepad.exe" },
          actualForegroundWindow: { hwnd: "0x0099BB", processName: "other.exe", minimized: false }
        }),
      /UNIFIED_TASK_FOCUS_LOST:FOCUS_STOLEN_BY_OTHER_WINDOW/
    );
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
