"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

/**
 * Zero-dependency OASIS SARIF 2.1.0 Static Analysis Report Builder
 * and Atomic Multi-Hunk Unified Diff Patch Applier for Koswork Desktop Workspace.
 */

function buildSarifReportJson(spec = {}) {
  const toolName = spec.toolName || "Kosmora-Preflight-Analyzer";
  const toolVersion = spec.toolVersion || "2.6.0";
  const findings = Array.isArray(spec.findings) ? spec.findings : [];

  const rulesMap = new Map();
  const results = [];

  for (const f of findings) {
    const ruleId = f.ruleId || "KOSMORA001";
    if (!rulesMap.has(ruleId)) {
      rulesMap.set(ruleId, {
        id: ruleId,
        shortDescription: { text: f.ruleDescription || f.message || ruleId }
      });
    }

    results.push({
      ruleId,
      level: f.level || "error",
      message: { text: f.message || "Static verification issue detected" },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: f.fileUri || "unknown.ts" },
            region: {
              startLine: Math.max(1, Number(f.startLine) || 1),
              startColumn: Math.max(1, Number(f.startColumn) || 1)
            }
          }
        }
      ]
    });
  }

  const sarifObj = {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: toolName,
            version: toolVersion,
            rules: Array.from(rulesMap.values())
          }
        },
        results
      }
    ]
  };

  return JSON.stringify(sarifObj, null, 2);
}

/**
 * Applies a Unified Diff patch (`@@ -start,count +start,count @@`) to `originalText`
 * with strict context-line verification. Throws `HUNK_CONTEXT_MISMATCH` and leaves
 * original untouched if any context or deletion line does not match verbatim.
 */
function applyUnifiedDiffPatchAtomically(originalText, unifiedPatchText) {
  const origLines = String(originalText ?? "").split("\n");
  const patchLines = String(unifiedPatchText ?? "").split("\n");

  const hunks = [];
  let currentHunk = null;

  for (const rawLine of patchLines) {
    if (rawLine.startsWith("---") || rawLine.startsWith("+++")) {
      continue;
    }
    const headerMatch = rawLine.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
    if (headerMatch) {
      if (currentHunk) hunks.push(currentHunk);
      currentHunk = {
        origStart: Number(headerMatch[1]), // 1-indexed
        ops: []
      };
      continue;
    }
    if (currentHunk && (rawLine.startsWith(" ") || rawLine.startsWith("-") || rawLine.startsWith("+"))) {
      currentHunk.ops.push({
        type: rawLine[0],
        text: rawLine.slice(1)
      });
    }
  }
  if (currentHunk) hunks.push(currentHunk);

  if (hunks.length === 0) {
    throw new Error("EMPTY_OR_INVALID_UNIFIED_DIFF: no valid @@ hunks found");
  }

  const outputLines = [];
  let origCursor = 0; // 0-indexed into origLines

  for (let hIdx = 0; hIdx < hunks.length; hIdx++) {
    const hunk = hunks[hIdx];
    const targetStartIdx = Math.max(0, hunk.origStart - 1);

    if (targetStartIdx < origCursor || targetStartIdx > origLines.length) {
      throw new Error(`HUNK_OFFSET_OUT_OF_RANGE at hunk #${hIdx + 1}`);
    }

    // Copy unchanged lines prior to this hunk
    while (origCursor < targetStartIdx) {
      outputLines.push(origLines[origCursor++]);
    }

    for (const op of hunk.ops) {
      if (op.type === " ") {
        if (origLines[origCursor] !== op.text) {
          throw new Error(
            `HUNK_CONTEXT_MISMATCH at line ${origCursor + 1}: expected '${op.text}', got '${origLines[origCursor] ?? "EOF"}'`
          );
        }
        outputLines.push(origLines[origCursor++]);
      } else if (op.type === "-") {
        if (origLines[origCursor] !== op.text) {
          throw new Error(
            `HUNK_DELETE_MISMATCH at line ${origCursor + 1}: expected '${op.text}', got '${origLines[origCursor] ?? "EOF"}'`
          );
        }
        origCursor++;
      } else if (op.type === "+") {
        outputLines.push(op.text);
      }
    }
  }

  while (origCursor < origLines.length) {
    outputLines.push(origLines[origCursor++]);
  }

  return outputLines.join("\n");
}

function saveSarifReportToWorkspace(workspaceDir, filename, spec) {
  if (!workspaceDir || typeof workspaceDir !== "string") {
    throw new Error("WORKSPACE_REQUIRED");
  }
  const cleanName = path.basename(filename || "audit.sarif.json").replace(/[^a-zA-Z0-9._-]/g, "_");
  const finalName = cleanName.endsWith(".sarif.json") ? cleanName : `${cleanName}.sarif.json`;
  const resolvedWorkspace = path.resolve(workspaceDir);
  const targetPath = path.resolve(resolvedWorkspace, finalName);

  if (!targetPath.startsWith(resolvedWorkspace + path.sep)) {
    throw new Error("PATH_TRAVERSAL_BLOCKED");
  }

  fs.mkdirSync(resolvedWorkspace, { recursive: true });
  const json = buildSarifReportJson(spec);
  fs.writeFileSync(targetPath, json, "utf8");

  return {
    filePath: targetPath,
    byteLength: Buffer.byteLength(json, "utf8"),
    sha256: crypto.createHash("sha256").update(json, "utf8").digest("hex")
  };
}

module.exports = {
  buildSarifReportJson,
  applyUnifiedDiffPatchAtomically,
  saveSarifReportToWorkspace
};
