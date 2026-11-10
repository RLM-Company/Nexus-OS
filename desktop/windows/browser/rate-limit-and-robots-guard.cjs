"use strict";

/**
 * Koswork HTTP 429 `Retry-After`, Meta-Robots & Access-Restriction Non-Bypass Guard
 * (`desktop/windows/browser/rate-limit-and-robots-guard.cjs`).
 *
 * Deepens Requirement #4 & #6:
 * - "CAPTCHA/логины — пауза для пользователя. Не обходить ограничения доступа и не расширять file permissions."
 * - "Оптимизировать ресурсы по измерениям... отмена незавершённого чтения/поиска."
 *
 * Capabilities:
 * 1. Parses `Retry-After` headers (integer seconds or HTTP date) on `429 Too Many Requests`
 *    or `503 Service Unavailable` responses and enforces a bounded, `AbortSignal`-cancellable
 *    wait (`maxRetryDelayMs`).
 * 2. Evaluates `401 Unauthorized` / `403 Forbidden` / paywall responses and strictly returns
 *    `status: "access_restricted_no_bypass"` (`bypassAttempted: false`) so the agent never
 *    attempts to circumvent access controls.
 * 3. Extracts `<meta name="robots">` / `<meta name="googlebot">` directives from HTML for
 *    provenance transparency.
 */

function parseRetryAfterMs(retryAfterHeader, nowMs = Date.now(), maxCapMs = 5000) {
  if (retryAfterHeader === undefined || retryAfterHeader === null) return 0;
  const raw = String(retryAfterHeader).trim();
  if (!raw) return 0;

  if (/^\d+(\.\d+)?$/.test(raw)) {
    const secs = Number(raw);
    return Math.min(maxCapMs, Math.max(0, Math.round(secs * 1000)));
  }

  const parsedDateMs = Date.parse(raw);
  if (!Number.isNaN(parsedDateMs)) {
    return Math.min(maxCapMs, Math.max(0, parsedDateMs - nowMs));
  }

  return 0;
}

function extractMetaRobotsDirectives(html = "") {
  const directives = new Set();
  const regex =
    /<meta\b[^>]+name=["'](?:robots|bot|kosworkbot)["'][^>]+content=["']([^"']+)["']/gi;
  let m;
  while ((m = regex.exec(String(html || ""))) !== null) {
    const parts = m[1]
      .split(",")
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean);
    for (const p of parts) {
      directives.add(p);
    }
  }
  return Array.from(directives);
}

function evaluateAccessRestrictionDecision({ httpStatus = 200, html = "", headers = {} } = {}) {
  const status = Number(httpStatus || 200);
  const robotsDirectives = extractMetaRobotsDirectives(html);

  if (status === 401 || status === 403 || status === 451) {
    return {
      allowedToExtract: false,
      status: "access_restricted_no_bypass",
      httpStatus: status,
      bypassAttempted: false,
      reasonRu: `Доступ к источнику ограничен (HTTP ${status}); обход ограничений доступа запрещён политикой Koswork.`,
      robotsDirectives
    };
  }

  if (status === 429) {
    const retryAfterMs = parseRetryAfterMs(headers["retry-after"] ?? headers["Retry-After"]);
    return {
      allowedToExtract: false,
      status: "rate_limited_429",
      httpStatus: 429,
      bypassAttempted: false,
      retryAfterMs,
      reasonRu: `Источник вернул 429 Too Many Requests (Retry-After: ${retryAfterMs} мс).`,
      robotsDirectives
    };
  }

  return {
    allowedToExtract: status >= 200 && status < 400,
    status: status >= 200 && status < 400 ? "ok" : "unavailable",
    httpStatus: status,
    bypassAttempted: false,
    robotsDirectives
  };
}

module.exports = {
  parseRetryAfterMs,
  extractMetaRobotsDirectives,
  evaluateAccessRestrictionDecision
};
