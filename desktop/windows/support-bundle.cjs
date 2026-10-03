"use strict";

const SENSITIVE_KEY = /(authorization|cookie|password|passwd|secret|token|api[-_]?key|credential)/i;
const MAX_DIAGNOSTIC_RECORDS = 200;

function redactString(value) {
  return String(value)
    .replace(/\b(Authorization|Cookie|Set-Cookie):\s*[^\r\n]+/gi, "$1: [REDACTED]")
    .replace(/\b(Basic|Bearer)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [REDACTED]")
    .replace(/(https?:\/\/)([^\s/@:]+):([^\s/@]+)@/gi, "$1[REDACTED]@")
    .replace(
      /([?&](?:token|access_token|refresh_token|password|secret|api[_-]?key)=)[^&#\s]*/gi,
      "$1[REDACTED]"
    )
    .replace(
      /\b(password|passwd|secret|token|api[_-]?key|authorization)=([^\s,;]+)/gi,
      "$1=[REDACTED]"
    );
}

function sanitizeValue(value, key = "") {
  if (SENSITIVE_KEY.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        sanitizeValue(childValue, childKey)
      ])
    );
  }
  if (typeof value === "string") return redactString(value);
  return value;
}

function parseDiagnosticRecords(text) {
  if (typeof text !== "string" || text.trim() === "") return [];

  const records = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      records.push(sanitizeValue(JSON.parse(line)));
    } catch {
      records.push({
        event: "unparsed_diagnostic",
        text: redactString(line).slice(0, 2000)
      });
    }
  }

  return records.slice(-MAX_DIAGNOSTIC_RECORDS);
}

function buildSupportBundle({
  generatedAt,
  appVersion,
  electronVersion,
  chromeVersion,
  nodeVersion,
  platform,
  release,
  arch,
  origin,
  connectionState,
  lastRoute,
  rememberedCredentials,
  diagnosticText
}) {
  return {
    schemaVersion: 1,
    generatedAt,
    app: {
      version: appVersion,
      electron: electronVersion,
      chrome: chromeVersion,
      node: nodeVersion
    },
    system: {
      platform,
      release,
      arch
    },
    connection: {
      origin: sanitizeValue(origin),
      state: connectionState,
      lastRoute: sanitizeValue(lastRoute),
      rememberedCredentials: Boolean(rememberedCredentials)
    },
    diagnostics: parseDiagnosticRecords(diagnosticText)
  };
}

function serializeSupportBundle(input) {
  return JSON.stringify(buildSupportBundle(input), null, 2) + "\n";
}

module.exports = {
  buildSupportBundle,
  parseDiagnosticRecords,
  redactString,
  sanitizeValue,
  serializeSupportBundle
};
