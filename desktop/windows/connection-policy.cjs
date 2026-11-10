"use strict";

function normalizeServerOrigin(rawOrigin) {
  const input = String(rawOrigin || "").trim();
  if (!input || input === "local") return "local";
  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error(`INVALID_SERVER_ORIGIN: "${input}"`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`UNSUPPORTED_ORIGIN_PROTOCOL: "${parsed.protocol}"`);
  }
  return parsed.origin.toLowerCase();
}

module.exports = {
  normalizeServerOrigin
};
