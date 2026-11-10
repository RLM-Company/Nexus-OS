"use strict";

const path = require("node:path");
const crypto = require("node:crypto");
const {
  KosworkBrowserPolicyError,
  resolveAllowedDownloadTarget
} = require("./policy.cjs");

/**
 * Koswork Content-Disposition Parser & Magic-Byte MIME Sniffing Guard
 * (`desktop/windows/browser/content-disposition-and-mime-sniff-guard.cjs`).
 *
 * Deepens Requirement #4:
 * - Parses RFC 6266 / RFC 5987 `Content-Disposition` headers (`filename*=UTF-8''...` and
 *   `filename="..."`) to determine the safe download filename inside the allowed workspace folder.
 * - Inspects the first bytes (magic numbers) of downloaded content buffers to block disguised
 *   Windows PE executables (`0x4D 0x5A` "MZ"), ELF binaries (`0x7F 'E' 'L' 'F'`), and shell/script
 *   shebangs (`#!`) masquerading under safe `.txt`, `.csv`, or `.pdf` filenames
 *   (`BROWSER_DISGUISED_EXECUTABLE_PAYLOAD`).
 */

function parseContentDispositionFilename(headerValue = "", fallbackName = "download.txt") {
  const raw = String(headerValue || "").trim();
  if (!raw) return fallbackName;

  // 1. Check RFC 5987 filename*=UTF-8''...
  const starMatch = raw.match(/filename\*\s*=\s*UTF-8''([^;\r\n]+)/i);
  if (starMatch && starMatch[1]) {
    try {
      return path.basename(decodeURIComponent(starMatch[1].trim()));
    } catch (_) {
      return path.basename(starMatch[1].trim());
    }
  }

  // 2. Check quoted or unquoted filename="..."
  const fnMatch = raw.match(/filename\s*=\s*(?:"([^"]+)"|'([^']+)'|([^;\s\r\n]+))/i);
  if (fnMatch) {
    const candidate = fnMatch[1] || fnMatch[2] || fnMatch[3] || fallbackName;
    return path.basename(candidate.trim());
  }

  return fallbackName;
}

function sniffBinaryMagicSignature(buffer) {
  const buf = Buffer.isBuffer(buffer)
    ? buffer
    : Buffer.from(String(buffer ?? ""), "utf8");

  if (buf.length >= 2 && buf[0] === 0x4d && buf[1] === 0x5a) {
    return { kind: "windows_pe_mz", executable: true };
  }
  if (
    buf.length >= 4 &&
    buf[0] === 0x7f &&
    buf[1] === 0x45 &&
    buf[2] === 0x4c &&
    buf[3] === 0x46
  ) {
    return { kind: "linux_elf_binary", executable: true };
  }
  if (buf.length >= 2 && buf[0] === 0x23 && buf[1] === 0x21) {
    return { kind: "script_shebang", executable: true };
  }
  if (
    buf.length >= 5 &&
    buf.slice(0, 5).toString("ascii") === "%PDF-"
  ) {
    return { kind: "pdf_document", executable: false };
  }
  if (
    buf.length >= 4 &&
    buf[0] === 0x50 &&
    buf[1] === 0x4b &&
    buf[2] === 0x03 &&
    buf[3] === 0x04
  ) {
    return { kind: "zip_or_ooxml_container", executable: false };
  }
  return { kind: "plain_text_or_data", executable: false };
}

function verifyDownloadContentDispositionAndMagicBytes({
  workspaceRoot,
  subDir = "downloads",
  contentDispositionHeader = "",
  fallbackFilename = "download.txt",
  declaredMimeType = "text/plain",
  contentBuffer = Buffer.alloc(0)
} = {}) {
  const extractedFilename = parseContentDispositionFilename(
    contentDispositionHeader,
    fallbackFilename
  );

  const allowedDownloadDir = path.join(String(workspaceRoot || ""), subDir);
  const target = resolveAllowedDownloadTarget(extractedFilename, {
    allowedDownloadDir,
    allowedWorkspaceRoot: workspaceRoot
  });

  const buf = Buffer.isBuffer(contentBuffer)
    ? contentBuffer
    : Buffer.from(String(contentBuffer ?? ""), "utf8");

  const sniffed = sniffBinaryMagicSignature(buf);
  if (sniffed.executable) {
    throw new KosworkBrowserPolicyError(
      "BROWSER_DISGUISED_EXECUTABLE_PAYLOAD",
      `Загружаемый файл "${target.filename}" содержит сигнатуру исполняемого кода (${sniffed.kind}), замаскированную под документ.`,
      {
        filename: target.filename,
        declaredMimeType,
        sniffedKind: sniffed.kind
      }
    );
  }

  const sha256 = crypto.createHash("sha256").update(buf).digest("hex");

  return {
    allowed: true,
    filename: target.filename,
    targetPath: target.targetPath,
    declaredMimeType,
    sniffedKind: sniffed.kind,
    byteLength: buf.byteLength,
    sha256
  };
}

module.exports = {
  parseContentDispositionFilename,
  sniffBinaryMagicSignature,
  verifyDownloadContentDispositionAndMagicBytes
};
