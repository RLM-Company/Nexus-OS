"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const TRANSIENT_EXTENSIONS = [".crdownload", ".tmp", ".part", ".download"];

/**
 * Attaches a deterministic synchronous save-path interceptor to an Electron session
 * so packaged native browser runs never fall back to an OS-default Downloads folder
 * or prompt dialog during automated/unified-work downloads.
 */
function attachDeterministicDownloadHandler(electronSession, options = {}) {
  const downloadDir = path.resolve(options.downloadDir || process.cwd());
  fs.mkdirSync(downloadDir, { recursive: true });
  const completedDownloads = [];

  const listener = (_event, item) => {
    const rawFilename = path.basename(String(item.getFilename?.() || "download.bin"));
    const safeFilename = rawFilename.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_") || "download.bin";
    const targetPath = path.join(downloadDir, safeFilename);
    if (typeof item.setSavePath === "function") {
      item.setSavePath(targetPath);
    }
    if (typeof item.once === "function") {
      item.once("done", (_doneEvent, state) => {
        completedDownloads.push({
          filename: safeFilename,
          targetPath,
          state: state || "completed",
          completedAt: new Date().toISOString()
        });
      });
    }
  };

  if (electronSession && typeof electronSession.on === "function") {
    electronSession.on("will-download", listener);
  }

  return {
    downloadDir,
    completedDownloads,
    detach() {
      if (electronSession && typeof electronSession.removeListener === "function") {
        electronSession.removeListener("will-download", listener);
      }
    }
  };
}

function hasTransientPartialFile(dirPath, filename) {
  for (const ext of TRANSIENT_EXTENSIONS) {
    const candidate = path.join(dirPath, `${filename}${ext}`);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Waits for a downloaded file (e.g. `result.txt` in packaged Windows lifecycle CI)
 * to finish flushing from `.crdownload`/`.tmp`, achieve a stable non-zero byte size
 * across two consecutive checks, and become readable without EBUSY/EPERM locks.
 */
async function waitForVerifiedDownload(options) {
  const filename = path.basename(String(options.filename || "result.txt"));
  const candidateDirs = Array.from(
    new Set(
      [
        options.primaryDir,
        ...(Array.isArray(options.fallbackDirs) ? options.fallbackDirs : []),
        process.env.KOSWORK_DOWNLOAD_DIR,
        process.env.USERPROFILE ? path.join(process.env.USERPROFILE, "Downloads") : null
      ]
        .filter(Boolean)
        .map((d) => path.resolve(String(d)))
    )
  );

  const timeoutMs = Math.max(Number(options.timeoutMs ?? 8000), 100);
  const pollIntervalMs = Math.max(Number(options.pollIntervalMs ?? 50), 10);
  const minBytes = Math.max(Number(options.minBytes ?? 1), 0);
  const expectedSubstring =
    typeof options.expectedSubstring === "string" ? options.expectedSubstring : null;

  const deadline = Date.now() + timeoutMs;
  let lastObservedPartial = null;
  let lastReadError = null;
  const stableSizeByPath = new Map();

  while (Date.now() <= deadline) {
    for (const dir of candidateDirs) {
      if (!fs.existsSync(dir)) continue;

      const partial = hasTransientPartialFile(dir, filename);
      if (partial) {
        lastObservedPartial = partial;
        continue;
      }

      const fullPath = path.join(dir, filename);
      if (!fs.existsSync(fullPath)) continue;

      try {
        const stat = fs.statSync(fullPath);
        if (!stat.isFile() || stat.size < minBytes) continue;

        const prevSize = stableSizeByPath.get(fullPath);
        stableSizeByPath.set(fullPath, stat.size);
        if (prevSize !== stat.size) {
          // Wait one more poll tick to confirm size stability after Chromium rename
          continue;
        }

        const buffer = fs.readFileSync(fullPath);
        const text = buffer.toString("utf8");
        if (expectedSubstring && !text.includes(expectedSubstring)) {
          lastReadError = `Substring "${expectedSubstring}" not yet present in ${fullPath}`;
          continue;
        }

        // Copy to primaryDir if found in a fallback directory so downstream fixtures find it at primaryDir/filename
        const primaryTarget = candidateDirs[0] ? path.join(candidateDirs[0], filename) : fullPath;
        if (primaryTarget !== fullPath && candidateDirs[0]) {
          fs.mkdirSync(candidateDirs[0], { recursive: true });
          fs.copyFileSync(fullPath, primaryTarget);
        }

        return {
          ok: true,
          filename,
          resolvedPath: primaryTarget,
          originalPath: fullPath,
          reconciledFromFallback: primaryTarget !== fullPath,
          sizeBytes: buffer.length,
          sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
          content: text
        };
      } catch (err) {
        lastReadError = err && err.message ? err.message : String(err);
      }
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  const error = new Error(
    `DOWNLOAD_VERIFICATION_TIMEOUT: Could not verify "${filename}" within ${timeoutMs}ms across [${candidateDirs.join(", ")}]` +
      (lastObservedPartial ? ` (last partial: ${lastObservedPartial})` : "") +
      (lastReadError ? ` (last error: ${lastReadError})` : "")
  );
  error.code = "DOWNLOAD_VERIFICATION_TIMEOUT";
  error.diagnostics = {
    filename,
    candidateDirs,
    lastObservedPartial,
    lastReadError
  };
  throw error;
}

module.exports = {
  attachDeterministicDownloadHandler,
  waitForVerifiedDownload
};
