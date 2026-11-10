"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const SENSITIVE_HEADER_RE = /^(authorization|cookie|set-cookie|x-api-key|proxy-authorization)$/i;

function sanitizeHeaders(headers = []) {
  return headers.map((h) => ({
    name: String(h.name || ""),
    value: SENSITIVE_HEADER_RE.test(String(h.name || ""))
      ? "[REDACTED_CREDENTIAL]"
      : String(h.value || "")
  }));
}

function shellSingleQuote(str) {
  return `'${String(str ?? "").replace(/'/g, `'\\''`)}'`;
}

/**
 * Zero-dependency W3C HTTP Archive v1.2 (.har) & POSIX cURL Replay Script (.replay.sh)
 * Network Diagnostics Bundle Builder with Automatic Credential Redaction.
 */
function buildHarAndCurlReplay(spec = {}) {
  const entriesInput = Array.isArray(spec.entries) ? spec.entries : [];

  const harEntries = [];
  const curlLines = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "# Auto-generated Kosmora Network Replay Bundle"
  ];

  for (let i = 0; i < entriesInput.length; i++) {
    const e = entriesInput[i];
    const method = String(e.method || "GET").toUpperCase();
    const url = String(e.url || "https://kosmora.local/api/health");
    const reqHeaders = sanitizeHeaders(e.requestHeaders || []);
    const resHeaders = sanitizeHeaders(e.responseHeaders || []);
    const status = Number(e.status || 200);
    const durationMs = Number(e.durationMs || 15);
    const reqBody = e.requestBody ? String(e.requestBody) : "";
    const resBody = e.responseBody ? String(e.responseBody) : "";

    harEntries.push({
      startedDateTime: e.startedDateTime || new Date().toISOString(),
      time: durationMs,
      request: {
        method,
        url,
        httpVersion: "HTTP/1.1",
        cookies: [],
        headers: reqHeaders,
        queryString: [],
        headersSize: -1,
        bodySize: Buffer.byteLength(reqBody, "utf8"),
        ...(reqBody
          ? {
              postData: {
                mimeType: "application/json",
                text: reqBody
              }
            }
          : {})
      },
      response: {
        status,
        statusText: status === 200 ? "OK" : "Completed",
        httpVersion: "HTTP/1.1",
        cookies: [],
        headers: resHeaders,
        content: {
          size: Buffer.byteLength(resBody, "utf8"),
          mimeType: "application/json",
          text: resBody
        },
        redirectURL: "",
        headersSize: -1,
        bodySize: Buffer.byteLength(resBody, "utf8")
      },
      cache: {},
      timings: { send: 1, wait: Math.max(1, durationMs - 2), receive: 1 }
    });

    const headerFlags = reqHeaders
      .map((h) => `-H ${shellSingleQuote(`${h.name}: ${h.value}`)}`)
      .join(" ");
    const dataFlag = reqBody ? ` --data-raw ${shellSingleQuote(reqBody)}` : "";
    curlLines.push(
      `curl -sS -X ${method} ${headerFlags}${dataFlag} ${shellSingleQuote(url)}`
    );
  }

  const harObj = {
    log: {
      version: "1.2",
      creator: { name: "KosmoraNetworkRecorder", version: "2.13.0" },
      entries: harEntries
    }
  };

  return {
    harJson: JSON.stringify(harObj, null, 2) + "\n",
    curlScript: curlLines.join("\n") + "\n",
    entryCount: harEntries.length
  };
}

function saveHarAndCurlToWorkspace(workspaceDir, baseName, spec) {
  if (!workspaceDir || typeof workspaceDir !== "string") {
    throw new Error("WORKSPACE_REQUIRED");
  }
  const cleanBase = path
    .basename(baseName || "network-trace")
    .replace(/\.(har|replay\.sh|sh)$/i, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_");
  const resolvedWorkspace = path.resolve(workspaceDir);

  const harPath = path.resolve(resolvedWorkspace, `${cleanBase}.har`);
  const curlPath = path.resolve(resolvedWorkspace, `${cleanBase}.replay.sh`);

  if (!harPath.startsWith(resolvedWorkspace + path.sep)) {
    throw new Error("PATH_TRAVERSAL_BLOCKED");
  }

  fs.mkdirSync(resolvedWorkspace, { recursive: true });
  const built = buildHarAndCurlReplay(spec);
  fs.writeFileSync(harPath, built.harJson, "utf8");
  fs.writeFileSync(curlPath, built.curlScript, "utf8");

  return {
    harPath,
    curlPath,
    entryCount: built.entryCount,
    sha256: crypto
      .createHash("sha256")
      .update(built.harJson + built.curlScript, "utf8")
      .digest("hex")
  };
}

module.exports = {
  buildHarAndCurlReplay,
  saveHarAndCurlToWorkspace
};
