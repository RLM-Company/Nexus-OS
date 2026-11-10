"use strict";
/**
 * Kosmora / Koswork Windows Clipboard Pastejacking & Drag-and-Drop Sandbox Guard (Wave 23)
 *
 * Protects autonomous desktop & browser automation against:
 * 1. Terminal Pastejacking: ANSI escape sequences (`\x1b[...`), hidden carriage returns (`\r`),
 *    bracketed paste breakouts (`\x1b[201~`), and background shell execution payloads (`curl ... | sh`,
 *    `powershell -enc ...`, `cmd /c ...`) hidden in copied web text.
 * 2. Dangerous Drag-and-Drop / File Upload Payloads:
 *    - Windows executable/script extensions (`.exe`, `.bat`, `.cmd`, `.ps1`, `.vbs`, `.hta`, `.lnk`, `.scr`, `.msi`, `.dll`)
 *    - NTFS Alternate Data Streams (`report.docx:zone.identifier` or `invoice.pdf:evil.exe`)
 *    - UNC network SMB paths (`\\attacker.com\share\file`) and device paths (`\\.\PhysicalDrive0`)
 */

const path = require("node:path");

const FORBIDDEN_DROP_EXTENSIONS = new Set([
  ".exe",
  ".bat",
  ".cmd",
  ".ps1",
  ".vbs",
  ".vbe",
  ".js",
  ".jse",
  ".wsf",
  ".wsh",
  ".hta",
  ".scr",
  ".pif",
  ".msi",
  ".msp",
  ".com",
  ".dll",
  ".sys",
  ".lnk",
  ".reg",
  ".cpl"
]);

const ANSI_ESCAPE_REGEX = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/g;
const SHELL_PASTEJACK_REGEX = /\b(?:powershell(?:\.exe)?\s+-(?:e|enc|encodedcommand|w\s+hidden)|cmd(?:\.exe)?\s+\/c|curl\s+[^\n|]+\|\s*(?:ba)?sh|wget\s+[^\n|]+\|\s*(?:ba)?sh|certutil\s+-urlcache|mshta(?:\.exe)?\b|rundll32(?:\.exe)?\b)/i;

/**
 * Inspects and sanitizes clipboard text before pasting into a target application.
 */
function inspectAndSanitizeClipboard(rawClipboard, options = {}) {
  const raw = String(rawClipboard ?? "");
  const targetContext = String(options.targetContext || "editor").toLowerCase();
  const threats = [];

  // 1. Check ANSI escape sequences / bracketed paste breakouts
  if (ANSI_ESCAPE_REGEX.test(raw)) {
    threats.push({
      code: "CLIPBOARD_ANSI_ESCAPE_INJECTION",
      severity: "critical",
      message: "ANSI terminal control sequences detected in clipboard payload."
    });
  }

  // 2. Check hidden shell execution pastejacking
  if (SHELL_PASTEJACK_REGEX.test(raw)) {
    threats.push({
      code: "CLIPBOARD_SHELL_PASTEJACKING",
      severity: "critical",
      message: "Executable shell/PowerShell command injection detected in clipboard."
    });
  }

  // 3. Check multi-line newline auto-execution when pasting into a terminal/shell
  const hasNewline = /[\r\n]/.test(raw);
  if (targetContext === "terminal" && hasNewline) {
    threats.push({
      code: "CLIPBOARD_TERMINAL_AUTOEXEC_NEWLINE",
      severity: "high",
      message: "Multi-line paste into terminal would auto-execute embedded commands before user review."
    });
  }

  // Sanitize text: strip ANSI escapes, null bytes, and normalize line endings
  let sanitized = raw
    .replace(ANSI_ESCAPE_REGEX, "")
    .replace(/\0/g, "");

  if (targetContext === "terminal") {
    sanitized = sanitized.replace(/[\r\n]+/g, " ").trim();
  }

  const criticalOrHigh = threats.some(
    (t) => t.severity === "critical" || (targetContext === "terminal" && t.severity === "high")
  );

  return {
    allowed: !criticalOrHigh,
    threats,
    sanitizedText: sanitized
  };
}

/**
 * Validates a list of file paths before allowing a drag-and-drop or file-chooser upload action.
 */
function verifyDragAndDropFiles(filePaths, options = {}) {
  const list = Array.isArray(filePaths) ? filePaths : [];
  const allowedWorkspaceRoot = options.allowedWorkspaceRoot
    ? path.resolve(options.allowedWorkspaceRoot)
    : null;

  const violations = [];
  const approvedFiles = [];

  for (const rawPath of list) {
    const strPath = String(rawPath ?? "").trim();

    // 1. Check UNC / SMB network paths or Win32 device namespaces (`\\server\share`, `\\.\`, `\\?\`)
    if (/^\\\\/.test(strPath) || /^\/\//.test(strPath)) {
      violations.push({
        file: strPath,
        code: "DROP_UNC_OR_DEVICE_PATH_FORBIDDEN",
        message: "UNC network shares and Win32 device paths are forbidden in drag-and-drop."
      });
      continue;
    }

    // 2. Check NTFS Alternate Data Streams (colon after drive letter `C:\...`)
    const withoutDrive = strPath.replace(/^[A-Za-z]:/, "");
    if (withoutDrive.includes(":")) {
      violations.push({
        file: strPath,
        code: "DROP_NTFS_ADS_FORBIDDEN",
        message: "NTFS Alternate Data Stream (ADS) syntax detected in file path."
      });
      continue;
    }

    // 3. Check forbidden executable / script extensions
    const ext = path.extname(strPath).toLowerCase();
    if (FORBIDDEN_DROP_EXTENSIONS.has(ext)) {
      violations.push({
        file: strPath,
        code: "DROP_EXECUTABLE_EXTENSION_FORBIDDEN",
        message: `Executable or script extension '${ext}' is blocked from drag-and-drop.`
      });
      continue;
    }

    // 4. Optional workspace boundary check
    if (allowedWorkspaceRoot) {
      const resolved = path.resolve(strPath);
      const rel = path.relative(allowedWorkspaceRoot, resolved);
      if (rel.startsWith("..") || path.isAbsolute(rel)) {
        violations.push({
          file: strPath,
          code: "DROP_OUTSIDE_WORKSPACE_ROOT",
          message: "File resides outside the authorized Koswork workspace folder."
        });
        continue;
      }
    }

    approvedFiles.push(strPath);
  }

  return {
    allowed: violations.length === 0 && approvedFiles.length > 0,
    approvedFiles,
    violations
  };
}

module.exports = {
  FORBIDDEN_DROP_EXTENSIONS,
  inspectAndSanitizeClipboard,
  verifyDragAndDropFiles
};
