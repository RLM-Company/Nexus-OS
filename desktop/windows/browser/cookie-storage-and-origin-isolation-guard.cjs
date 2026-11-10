"use strict";

/**
 * Koswork Per-Origin Cookie & Storage Partition Isolation Guard
 * (`desktop/windows/browser/cookie-storage-and-origin-isolation-guard.cjs`).
 *
 * Deepens Requirements #4, #6 & #7:
 * - Isolates browser storage and cookies across two strict partitions:
 *   1. `"user_browsing"` (normal user browsing state, preserved across research tasks)
 *   2. `"agent_research_ephemeral"` (ephemeral agent research storage, purgeable without
 *      touching the user's normal session).
 * - Enforces per-origin boundaries (`CROSS_ORIGIN_STORAGE_READ_BLOCKED`), blocks script
 *   access to `HttpOnly` cookies (`COOKIE_HTTPONLY_SCRIPT_ACCESS_DENIED`), and rejects
 *   insecure `SameSite=None` cookies on non-HTTPS origins (`COOKIE_SAMESITE_NONE_REQUIRES_SECURE`).
 */

function normalizeOrigin(rawUrl = "") {
  const u = new URL(String(rawUrl || ""));
  return u.origin.toLowerCase();
}

class KosworkOriginStorageIsolationGuard {
  constructor() {
    // key: `${partition}||${origin}` -> { cookies: Map, localStorage: Map }
    this.buckets = new Map();
  }

  _getBucket(partition = "agent_research_ephemeral", originUrl = "https://corpus.local") {
    const part =
      partition === "user_browsing" ? "user_browsing" : "agent_research_ephemeral";
    const origin = normalizeOrigin(originUrl);
    const key = `${part}||${origin}`;
    if (!this.buckets.has(key)) {
      this.buckets.set(key, {
        partition: part,
        origin,
        cookies: new Map(),
        localStorage: new Map()
      });
    }
    return this.buckets.get(key);
  }

  setCookie({
    partition = "agent_research_ephemeral",
    originUrl,
    name,
    value,
    httpOnly = false,
    secure = true,
    sameSite = "Lax"
  } = {}) {
    const origin = normalizeOrigin(originUrl);
    const isHttps = origin.startsWith("https:");
    if (String(sameSite).toLowerCase() === "none" && (!secure || !isHttps)) {
      const err = new Error(
        `Cookie "${name}" with SameSite=None requires Secure on an https: origin`
      );
      err.code = "COOKIE_SAMESITE_NONE_REQUIRES_SECURE";
      throw err;
    }

    const bucket = this._getBucket(partition, originUrl);
    const entry = {
      name: String(name),
      value: String(value ?? ""),
      httpOnly: Boolean(httpOnly),
      secure: Boolean(secure),
      sameSite: String(sameSite || "Lax"),
      updatedAt: new Date().toISOString()
    };
    bucket.cookies.set(entry.name, entry);
    return { status: "ok", partition: bucket.partition, origin: bucket.origin, cookie: entry };
  }

  readCookie({
    partition = "agent_research_ephemeral",
    requesterOriginUrl,
    targetOriginUrl,
    name,
    viaDocumentCookieScript = false
  } = {}) {
    const reqOrigin = normalizeOrigin(requesterOriginUrl);
    const tgtOrigin = normalizeOrigin(targetOriginUrl || requesterOriginUrl);
    if (reqOrigin !== tgtOrigin) {
      const err = new Error(
        `Cross-origin cookie read blocked: ${reqOrigin} cannot read ${tgtOrigin}`
      );
      err.code = "CROSS_ORIGIN_STORAGE_READ_BLOCKED";
      throw err;
    }

    const bucket = this._getBucket(partition, tgtOrigin);
    const cookie = bucket.cookies.get(String(name));
    if (!cookie) return null;

    if (viaDocumentCookieScript && cookie.httpOnly) {
      const err = new Error(
        `Script access to HttpOnly cookie "${name}" on ${tgtOrigin} is denied`
      );
      err.code = "COOKIE_HTTPONLY_SCRIPT_ACCESS_DENIED";
      throw err;
    }

    return cookie;
  }

  setLocalStorageItem({
    partition = "agent_research_ephemeral",
    originUrl,
    key,
    value
  } = {}) {
    const bucket = this._getBucket(partition, originUrl);
    bucket.localStorage.set(String(key), String(value ?? ""));
    return {
      status: "ok",
      partition: bucket.partition,
      origin: bucket.origin,
      key: String(key)
    };
  }

  getLocalStorageItem({
    partition = "agent_research_ephemeral",
    requesterOriginUrl,
    targetOriginUrl,
    key
  } = {}) {
    const reqOrigin = normalizeOrigin(requesterOriginUrl);
    const tgtOrigin = normalizeOrigin(targetOriginUrl || requesterOriginUrl);
    if (reqOrigin !== tgtOrigin) {
      const err = new Error(
        `Cross-origin localStorage read blocked: ${reqOrigin} cannot read ${tgtOrigin}`
      );
      err.code = "CROSS_ORIGIN_STORAGE_READ_BLOCKED";
      throw err;
    }
    const bucket = this._getBucket(partition, tgtOrigin);
    return bucket.localStorage.has(String(key))
      ? bucket.localStorage.get(String(key))
      : null;
  }

  purgeEphemeralResearchPartition() {
    let purgedOrigins = 0;
    for (const [k, bucket] of this.buckets.entries()) {
      if (bucket.partition === "agent_research_ephemeral") {
        this.buckets.delete(k);
        purgedOrigins += 1;
      }
    }
    const remainingUserBuckets = Array.from(this.buckets.values()).filter(
      (b) => b.partition === "user_browsing"
    ).length;

    return {
      purgedOrigins,
      remainingUserBuckets
    };
  }
}

module.exports = {
  KosworkOriginStorageIsolationGuard
};
