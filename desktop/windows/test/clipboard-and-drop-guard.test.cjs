"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  inspectAndSanitizeClipboard,
  verifyDragAndDropFiles
} = require("../ci/clipboard-and-drop-guard.cjs");

test("inspectAndSanitizeClipboard blocks ANSI escapes, PowerShell pastejacking, and multi-line terminal auto-execution", () => {
  // 1. Clean clipboard text into editor
  const clean = inspectAndSanitizeClipboard("Project Apollo Q4 budget is $250,000.", {
    targetContext: "editor"
  });
  assert.equal(clean.allowed, true);
  assert.equal(clean.threats.length, 0);

  // 2. ANSI escape + hidden shell execution pastejacking
  const pastejack = inspectAndSanitizeClipboard(
    "git status \u001b[201~\npowershell.exe -enc SQBFAFgA\r\nclear",
    { targetContext: "terminal" }
  );
  assert.equal(pastejack.allowed, false);
  assert.ok(pastejack.threats.some((t) => t.code === "CLIPBOARD_ANSI_ESCAPE_INJECTION"));
  assert.ok(pastejack.threats.some((t) => t.code === "CLIPBOARD_SHELL_PASTEJACKING"));
  assert.ok(pastejack.threats.some((t) => t.code === "CLIPBOARD_TERMINAL_AUTOEXEC_NEWLINE"));
  assert.ok(!pastejack.sanitizedText.includes("\u001b"));
});

test("verifyDragAndDropFiles blocks .exe/.ps1/.lnk extensions, NTFS Alternate Data Streams, UNC paths, and out-of-workspace files", () => {
  const workspaceRoot = "/tmp/koswork-authorized-folder";

  // 1. Safe document inside workspace
  const safeDrop = verifyDragAndDropFiles(
    [
      "/tmp/koswork-authorized-folder/Q4-Report.docx",
      "/tmp/koswork-authorized-folder/Budget.xlsx"
    ],
    { allowedWorkspaceRoot: workspaceRoot }
  );
  assert.equal(safeDrop.allowed, true);
  assert.equal(safeDrop.approvedFiles.length, 2);
  assert.equal(safeDrop.violations.length, 0);

  // 2. Malicious drop candidates
  const unsafeDrop = verifyDragAndDropFiles(
    [
      "\\\\evil-smb.example.com\\share\\payload.docx",
      "/tmp/koswork-authorized-folder/invoice.pdf:hidden.exe",
      "/tmp/koswork-authorized-folder/ dropper.ps1",
      "/etc/passwd"
    ],
    { allowedWorkspaceRoot: workspaceRoot }
  );

  assert.equal(unsafeDrop.allowed, false);
  assert.ok(unsafeDrop.violations.some((v) => v.code === "DROP_UNC_OR_DEVICE_PATH_FORBIDDEN"));
  assert.ok(unsafeDrop.violations.some((v) => v.code === "DROP_NTFS_ADS_FORBIDDEN"));
  assert.ok(unsafeDrop.violations.some((v) => v.code === "DROP_EXECUTABLE_EXTENSION_FORBIDDEN"));
  assert.ok(unsafeDrop.violations.some((v) => v.code === "DROP_OUTSIDE_WORKSPACE_ROOT"));
});
