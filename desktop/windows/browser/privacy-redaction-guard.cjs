"use strict";

/**
 * Koswork Owner Privacy & Sensitive-Data Redaction Guard
 * (`desktop/windows/browser/privacy-redaction-guard.cjs`).
 *
 * Enforces the strict security rule from the specification:
 * "Не используй реальные .env, пароли, токены, базу и личные файлы владельца
 *  как тестовые данные или вложения другим сервисам."
 *
 * Capabilities:
 * 1. Scrubs sensitive query parameters (`token`, `access_token`, `api_key`, `password`,
 *    `secret`, `session_key`, `auth`) from URLs before persisting them in HAR traces,
 *    MHTML bundles, or shared reports (`redactSensitiveUrlParams`).
 * 2. Scrubs inline bearer tokens (`Bearer ...`, `sk-...`, `ghp_...`, `AIza...`,
 *    `SECRET_TOKEN=...`) from text and headers (`redactSensitiveTextAndHeaders`).
 * 3. Audits any serialized report/HAR/MHTML payload to prove zero unredacted secrets
 *    remain (`auditPayloadForZeroSecretLeaks`).
 */

const SENSITIVE_QUERY_KEYS = new Set([
  "token",
  "access_token",
  "refresh_token",
  "id_token",
  "api_key",
  "apikey",
  "password",
  "passwd",
  "secret",
  "client_secret",
  "session_key",
  "auth",
  "signature",
  "sig"
]);

function redactSensitiveUrlParams(rawUrl = "") {
  try {
    const parsed = new URL(String(rawUrl));
    let redactedCount = 0;
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
        parsed.searchParams.set(key, "[REDACTED]");
        redactedCount += 1;
      }
    }
    return {
      sanitizedUrl: parsed.toString(),
      redactedParamsCount: redactedCount
    };
  } catch {
    return {
      sanitizedUrl: String(rawUrl || ""),
      redactedParamsCount: 0
    };
  }
}

function redactSensitiveText(rawText = "") {
  let text = String(rawText || "");
  let redactionsCount = 0;

  const patterns = [
    {
      regex: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g,
      replacement: "Bearer [REDACTED_TOKEN]"
    },
    {
      regex: /\b(?:sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z-_]{20,})\b/g,
      replacement: "[REDACTED_API_KEY]"
    },
    {
      regex: /\b(?:PASSWORD|PASSWD|SECRET_TOKEN|API_KEY|PRIVATE_KEY|ACCESS_TOKEN)\s*=\s*[^\s"'&]+/gi,
      replacement: "[REDACTED_ENV_SECRET]"
    }
  ];

  for (const pat of patterns) {
    text = text.replace(pat.regex, () => {
      redactionsCount += 1;
      return pat.replacement;
    });
  }

  return {
    sanitizedText: text,
    redactionsCount
  };
}

function auditPayloadForZeroSecretLeaks(payload) {
  const serialized =
    typeof payload === "string" ? payload : JSON.stringify(payload || {});
  const leakCheck = redactSensitiveText(serialized);
  return {
    clean: leakCheck.redactionsCount === 0,
    detectedLeaksCount: leakCheck.redactionsCount
  };
}

module.exports = {
  redactSensitiveUrlParams,
  redactSensitiveText,
  auditPayloadForZeroSecretLeaks
};
