"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const {
  verifyFileSelectionPolicy,
  resolveAllowedDownloadTarget
} = require("./policy.cjs");

/**
 * Koswork RFC 7578 Multipart Form-Data Builder & Verified Chunked Downloader
 * (`desktop/windows/browser/multipart-upload-and-chunk-downloader.cjs`).
 *
 * Deepens Requirement #4:
 * - Validates file selection paths strictly against the allowed workspace folder and
 *   forbidden extensions (`.exe`, `.bat`, `.cmd`, `.ps1`, `.env`, `.pem`, etc.) via `policy.cjs`.
 * - Encodes ordinary form fields and workspace file attachments into a deterministic
 *   RFC 7578 `multipart/form-data` payload with SHA-256 attachment receipts.
 * - Executes multi-chunk downloads into a `.part` staging file inside the allowed workspace
 *   folder, honours `AbortController` mid-stream (removing partial `.part` files on abort),
 *   enforces `maxBytes` caps, and verifies SHA-256 integrity before atomic rename.
 */

function assertNotAborted(signal) {
  if (signal && signal.aborted) {
    const err = new Error("Operation aborted by AbortSignal");
    err.code = "BROWSER_TASK_CANCELLED";
    throw err;
  }
}

function buildSafeMultipartFormDataPayload({
  workspaceRoot,
  fields = {},
  fileAttachments = [],
  boundary = "----KosworkBrowserFormBoundary7MA4YWxkTrZu0gW"
} = {}) {
  if (!workspaceRoot) {
    throw new Error("workspaceRoot is required for multipart form data construction");
  }

  const lines = [];
  const acceptedFiles = [];

  for (const [fieldName, rawVal] of Object.entries(fields || {})) {
    const safeName = String(fieldName).replace(/["\r\n]/g, "");
    const valueStr = String(rawVal ?? "");
    lines.push(`--${boundary}`);
    lines.push(`Content-Disposition: form-data; name="${safeName}"`);
    lines.push("");
    lines.push(valueStr);
  }

  for (const attachment of fileAttachments || []) {
    const fieldName = String(attachment.fieldName || "file").replace(/["\r\n]/g, "");
    const candidatePath = attachment.filePath || attachment.relativePath || "";

    // Enforce strict workspace containment & extension policy via policy.cjs
    const check = verifyFileSelectionPolicy(candidatePath, {
      allowedWorkspaceRoot: workspaceRoot
    });

    const contentBuf = fs.readFileSync(check.canonicalPath);
    const fileName = check.filename;
    const contentType = attachment.contentType || "application/octet-stream";

    lines.push(`--${boundary}`);
    lines.push(
      `Content-Disposition: form-data; name="${fieldName}"; filename="${fileName}"`
    );
    lines.push(`Content-Type: ${contentType}`);
    lines.push(`X-Koswork-Attachment-SHA256: ${check.sha256}`);
    lines.push("");
    lines.push(contentBuf.toString("utf8"));

    acceptedFiles.push({
      fieldName,
      fileName,
      safePath: check.canonicalPath,
      relativePath: check.relativePath,
      byteLength: check.sizeBytes,
      sha256: check.sha256,
      contentType
    });
  }

  lines.push(`--${boundary}--`);
  lines.push("");

  const bodyText = lines.join("\r\n");
  return {
    contentTypeHeader: `multipart/form-data; boundary=${boundary}`,
    boundary,
    bodyText,
    byteLength: Buffer.byteLength(bodyText, "utf8"),
    acceptedFiles,
    fieldCount: Object.keys(fields || {}).length
  };
}

async function executeVerifiedChunkedDownload({
  workspaceRoot,
  fileName = "downloaded-artifact.txt",
  subDir = "downloads",
  chunks = [],
  expectedSha256 = null,
  maxBytes = 10 * 1024 * 1024,
  signal = null
} = {}) {
  assertNotAborted(signal);
  const allowedDownloadDir = path.join(workspaceRoot, subDir);
  const dlTarget = resolveAllowedDownloadTarget(fileName, {
    allowedDownloadDir,
    allowedWorkspaceRoot: workspaceRoot
  });
  const finalPath = dlTarget.targetPath;
  const partPath = `${finalPath}.part`;

  let bytesWritten = 0;
  const hash = crypto.createHash("sha256");

  try {
    fs.writeFileSync(partPath, Buffer.alloc(0));
    for (let i = 0; i < chunks.length; i += 1) {
      assertNotAborted(signal);
      const rawChunk = chunks[i];
      const buf = Buffer.isBuffer(rawChunk)
        ? rawChunk
        : Buffer.from(String(rawChunk ?? ""), "utf8");

      if (bytesWritten + buf.byteLength > maxBytes) {
        const err = new Error(
          `Chunked download exceeded maxBytes limit (${bytesWritten + buf.byteLength} > ${maxBytes})`
        );
        err.code = "DOWNLOAD_MAX_BYTES_EXCEEDED";
        throw err;
      }

      fs.appendFileSync(partPath, buf);
      hash.update(buf);
      bytesWritten += buf.byteLength;
    }

    assertNotAborted(signal);
    const actualSha256 = hash.digest("hex");
    if (expectedSha256 && actualSha256.toLowerCase() !== String(expectedSha256).toLowerCase()) {
      const err = new Error(
        `Downloaded file SHA-256 mismatch: expected ${expectedSha256}, got ${actualSha256}`
      );
      err.code = "DOWNLOAD_SHA256_MISMATCH";
      throw err;
    }

    fs.renameSync(partPath, finalPath);
    return {
      status: "completed",
      savedPath: finalPath,
      relativePath: path.relative(workspaceRoot, finalPath).replace(/\\/g, "/"),
      bytesWritten,
      chunkCount: chunks.length,
      sha256: actualSha256
    };
  } catch (err) {
    if (fs.existsSync(partPath)) {
      try {
        fs.unlinkSync(partPath);
      } catch (_) {
        // ignore cleanup error
      }
    }
    throw err;
  }
}

module.exports = {
  buildSafeMultipartFormDataPayload,
  executeVerifiedChunkedDownload
};
