"use strict";

const { activeOwnerFromSessions } = require("./draft-store.cjs");
const MAX_BYTES = 32000;

async function fetchVerifiedOwner(fetcher, origin, { timeoutMs = 5000 } = {}) {
  const url = origin + "/api/v1/identity/sessions";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      credentials: "include",
      signal: controller.signal
    });
    if (response.status !== 200 || response.url !== url) return { state: "denied" };
    const contentType = response.headers?.get("content-type") || "";
    if (!/^application\/json(?:\s*;|$)/i.test(contentType)) return { state: "denied" };
    const size = Number(response.headers?.get("content-length") || "0");
    if (!Number.isFinite(size) || size > MAX_BYTES) return { state: "denied" };
    // Stream the response with a hard byte bound even if Content-Length lies or is missing.
    if (!response.body) return { state: "denied" };
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_BYTES) return { state: "denied" };
        chunks.push(Buffer.from(value));
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    try {
      const owner = activeOwnerFromSessions(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      return owner ? { state: "verified", ...owner } : { state: "denied" };
    } catch {
      return { state: "denied" };
    }
  } catch {
    return { state: "offline" };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { fetchVerifiedOwner };
