"use strict";

/**
 * Koswork Numeric/Token Boundary & Deprecation Context Validator
 * (`desktop/windows/browser/context-boundary-validator.cjs`).
 *
 * Deepens Requirement #5:
 * "Создавать отчёт MD/HTML/таблицу сравнения через существующие file APIs: цитата,
 *  источник, что подтверждено, что неизвестно. Ссылка сама по себе не доказательство
 *  утверждения; отметь конфликтующие/устаревшие данные и недоступные источники."
 *
 * Guards against three subtle citation-integrity errors:
 * 1. `NUMERIC_OR_WORD_BOUNDARY_TRUNCATED`: e.g. slicing `"$49"` out of `"$490/мес"` or
 *    `"99.9"` out of `"99.95%"` so the UTF-16 slice cuts a number or word mid-token.
 * 2. `CONTEXT_DEPRECATION_MARKER`: when the surrounding sentence/block explicitly states
 *    that the quoted figure is deprecated/archived (`"УСТАРЕЛО"`, `"не действует"`,
 *    `"архивный тариф"`, `"deprecated"`).
 * 3. `CONTEXT_NEGATION_MARKER`: when the immediate preceding context or block header
 *    negates the quoted phrase (`"НЕ поддерживается:"`, `"миф о том, что"`).
 */

function isWordOrDigitChar(ch) {
  if (!ch) return false;
  return /[\p{L}\p{N}]/u.test(ch);
}

function validateExcerptContextAndBoundaries(snapshot, excerpt, options = {}) {
  if (!snapshot || typeof snapshot.fullTextUtf16 !== "string") {
    throw new Error("CONTEXT_VALIDATOR_REQUIRES_SNAPSHOT");
  }
  if (!excerpt || !Number.isInteger(excerpt.startUtf16) || !Number.isInteger(excerpt.endUtf16)) {
    throw new Error("CONTEXT_VALIDATOR_REQUIRES_EXCERPT");
  }

  const fullText = snapshot.fullTextUtf16;
  const start = excerpt.startUtf16;
  const end = excerpt.endUtf16;
  const actualSlice = fullText.slice(start, end);

  const advisories = [];

  // 1. Check exact slice match
  if (actualSlice !== excerpt.quote) {
    advisories.push({
      code: "UTF16_SLICE_MISMATCH",
      severity: "error",
      message: "Срез [startUtf16..endUtf16] не совпадает с текстом выдержки."
    });
  }

  // 2. Check left/right token & numeric boundaries
  const charBefore = start > 0 ? fullText[start - 1] : "";
  const firstChar = actualSlice[0] || "";
  const lastChar = actualSlice[actualSlice.length - 1] || "";
  const charAfter = end < fullText.length ? fullText[end] : "";

  const leftTruncated = isWordOrDigitChar(charBefore) && isWordOrDigitChar(firstChar);
  const rightTruncated =
    (isWordOrDigitChar(lastChar) && isWordOrDigitChar(charAfter)) ||
    (/\d/.test(lastChar) &&
      (charAfter === "." || charAfter === ",") &&
      /\d/.test(fullText[end + 1] || ""));

  if (leftTruncated || rightTruncated) {
    advisories.push({
      code: "NUMERIC_OR_WORD_BOUNDARY_TRUNCATED",
      severity: "error",
      leftTruncated,
      rightTruncated,
      message: `Выдержка обрезает токен или число по границе («${charBefore}[${actualSlice}]${charAfter}»).`
    });
  }

  // 3. Check surrounding context window (only within the same paragraph/block, stopping at \n\n)
  const windowRadius = Number(options.contextWindowChars ?? 90);
  const rawPre = fullText.slice(Math.max(0, start - windowRadius), start);
  const rawPost = fullText.slice(end, Math.min(fullText.length, end + windowRadius));
  const preBreakIdx = rawPre.lastIndexOf("\n\n");
  const postBreakIdx = rawPost.indexOf("\n\n");
  const preContext = preBreakIdx >= 0 ? rawPre.slice(preBreakIdx + 2) : rawPre;
  const postContext = postBreakIdx >= 0 ? rawPost.slice(0, postBreakIdx) : rawPost;
  const surroundingParagraph = `${preContext} ${actualSlice} ${postContext}`;

  // Unicode-aware boundary check (since JS \b only matches ASCII word characters)
  const deprecationRegex =
    /(?:^|[^\p{L}\p{N}])(?:устарело|устаревш(?:ий|ая|ее|ие)|архивн(?:ый|ая|ое|ые)|не\s+действует|отменён|deprecated|obsolete|superseded)(?:$|[^\p{L}\p{N}])/iu;
  if (deprecationRegex.test(surroundingParagraph)) {
    advisories.push({
      code: "CONTEXT_DEPRECATION_MARKER",
      severity: "warning",
      message: "Окружающий контекст выдержки содержит маркер устаревших/архивных данных."
    });
  }

  const negationRegex =
    /(?:^|[^\p{L}\p{N}])(?:не\s+поддерживается|не\s+предоставляется|отсутствует|неверно,\s+что|миф\s*[:—-]|never\s+supports|does\s+not\s+support)(?:$|[^\p{L}\p{N}])/iu;
  if (negationRegex.test(`${preContext} ${actualSlice}`)) {
    advisories.push({
      code: "CONTEXT_NEGATION_MARKER",
      severity: "error",
      message: "Контекст выдержки содержит прямое отрицание утверждения."
    });
  }

  const boundaryClean = !advisories.some((a) => a.severity === "error");

  return {
    validForConfirmation: boundaryClean,
    boundaryClean,
    hasDeprecationWarning: advisories.some((a) => a.code === "CONTEXT_DEPRECATION_MARKER"),
    advisories,
    preContext,
    postContext
  };
}

module.exports = {
  validateExcerptContextAndBoundaries
};
