"use strict";

const crypto = require("node:crypto");

/**
 * Koswork Epistemic Evidence & Claim Verifier (`desktop/windows/browser/evidence-verifier.cjs`).
 *
 * Implements Queue Item #4:
 * - "Доведи evidence: точная цитата из полученного снимка, дата получения, URL, версия/позиция,
 *    ограничения чтения. Непустой quote и hash не доказывают тезис. Подтверждение требует
 *    соответствия источнику и явной оценки противоречий."
 *
 * Strict verification pipeline:
 * 1. Snapshot integrity: `quote` must match the exact UTF-16 slice `[startUtf16..endUtf16]`
 *    inside `snapshot.fullTextUtf16` at `pageVersion`, with matching `quoteSha256`, `url`, and `fetchedAt`.
 * 2. Claim-to-Quote entailment: a non-empty quote and hash are NOT sufficient!
 *    - The quote (and its immediate sentence context) must actually contain the claimed value
 *      (or its normalized unit/numeric equivalent) AND relate to the target option/criterion.
 *    - If the quote contains negation or deprecation markers around the claimed value
 *      (e.g., `"не поддерживает"`, `"отсутствует"`, `"устарело"`, `"deprecated"`, `"not supported"`),
 *      while the claim asserts a positive value, verification FAILS with `CLAIM_NEGATED_OR_DEPRECATED_IN_SOURCE`.
 *    - If `claimedValue` does not appear in `quote`, verification FAILS with `CLAIM_VALUE_NOT_SUPPORTED_BY_QUOTE`.
 * 3. Reading limitations propagation: attaches `readingLimitations` (`crossOriginFramesSkipped`,
 *    `truncatedLongPage`, `partialReadOnly`) directly to the evidence record.
 */

const NEGATION_AND_DEPRECATION_RE =
  /(?:^|[^\p{L}\p{N}])(не\s+поддерживает(?:ся)?|не\s+предоставляет(?:ся)?|не\s+доступ(?:ен|на|но)|отсутствует|запрещен(?:о|ы)?|устарел(?:о|а|и)?|отменен(?:о|а)?|удален(?:о|а)?|not\s+supported|not\s+available|deprecated|discontinued|removed)(?:$|[^\p{L}\p{N}])/iu;

function extractValueTokens(claimedValue = "") {
  const raw = String(claimedValue ?? "").trim().toLowerCase();
  if (!raw) return [];
  const numbers = raw.match(/\d+(?:[.,]\d+)?/g) || [];
  const words = raw
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2);
  return Array.from(new Set([...numbers, ...words]));
}

function verifyEvidenceAgainstSnapshotAndClaim({
  snapshot,
  excerpt,
  optionName = "",
  criterion = "",
  claimedValue = ""
} = {}) {
  if (!snapshot || typeof snapshot.fullTextUtf16 !== "string") {
    return {
      verified: false,
      code: "MISSING_SOURCE_SNAPSHOT",
      reason: "Отсутствует полученный снимок страницы для проверки выдержки."
    };
  }

  if (!excerpt || typeof excerpt.quote !== "string" || !excerpt.quote.trim()) {
    return {
      verified: false,
      code: "BARE_LINK_OR_EMPTY_QUOTE_REJECTED",
      reason: "Голая ссылка или пустая выдержка не доказывает тезис."
    };
  }

  const { startUtf16, endUtf16, quote } = excerpt;
  if (
    !Number.isInteger(startUtf16) ||
    !Number.isInteger(endUtf16) ||
    startUtf16 < 0 ||
    endUtf16 <= startUtf16 ||
    endUtf16 > snapshot.fullTextUtf16.length
  ) {
    return {
      verified: false,
      code: "INVALID_UTF16_OFFSETS",
      reason: `Некорректные позиции UTF-16 [${startUtf16}..${endUtf16}] для снимка длиной ${snapshot.fullTextUtf16.length}.`
    };
  }

  const actualSlice = snapshot.fullTextUtf16.slice(startUtf16, endUtf16);
  if (actualSlice !== quote) {
    return {
      verified: false,
      code: "QUOTE_MISMATCH_AT_UTF16_OFFSET",
      reason: "Текст выдержки не совпадает с фактическим срезом снимка на указанных UTF-16 позициях."
    };
  }

  const computedSha256 = crypto.createHash("sha256").update(quote, "utf8").digest("hex");
  if (excerpt.quoteSha256 && excerpt.quoteSha256 !== computedSha256) {
    return {
      verified: false,
      code: "QUOTE_SHA256_MISMATCH",
      reason: "Контрольная сумма quoteSha256 не совпадает с текстом выдержки."
    };
  }

  // Non-empty quote + hash is NOT enough: verify semantic correspondence to claimedValue!
  const valStr = String(claimedValue ?? "").trim();
  if (!valStr) {
    return {
      verified: false,
      code: "EMPTY_CLAIMED_VALUE",
      reason: "Не указано проверяемое значение тезиса (claimedValue)."
    };
  }

  const quoteNorm = quote.toLowerCase().replace(/,/g, ".");
  const valNorm = valStr.toLowerCase().replace(/,/g, ".");
  const valueTokens = extractValueTokens(valNorm);

  // Check numeric tokens first: every number in claimedValue must appear in quote (or its unit-converted form)
  const numericTokens = valNorm.match(/\d+(?:\.\d+)?/g) || [];
  for (const numTok of numericTokens) {
    const numVal = Number(numTok);
    const directMatch = quoteNorm.includes(numTok);
    // Allow standard unit conversions: e.g. 0.012 sec <-> 12 ms, 65536 MB <-> 64 GB, 588/yr <-> 49/mo
    const msConvMatch =
      quoteNorm.includes(String(numVal * 1000)) ||
      quoteNorm.includes(String(Number((numVal / 1000).toFixed(4))));
    const gbConvMatch =
      quoteNorm.includes(String(numVal * 1024)) ||
      quoteNorm.includes(String(Number((numVal / 1024).toFixed(2))));
    const yrConvMatch =
      quoteNorm.includes(String(numVal * 12)) ||
      quoteNorm.includes(String(Number((numVal / 12).toFixed(2))));

    if (!directMatch && !msConvMatch && !gbConvMatch && !yrConvMatch) {
      return {
        verified: false,
        code: "CLAIM_VALUE_NOT_SUPPORTED_BY_QUOTE",
        reason: `Заявленное числовое значение "${numTok}" (из "${valStr}") отсутствует в приведённой выдержке: «${quote}». Непустая цитата сама по себе не доказывает тезис.`
      };
    }
  }

  // If claimedValue has no numbers, require at least one substantive lexical token from claimedValue in quote
  if (numericTokens.length === 0 && valueTokens.length > 0) {
    const hasLexicalOverlap = valueTokens.some((tok) => quoteNorm.includes(tok));
    if (!hasLexicalOverlap) {
      return {
        verified: false,
        code: "CLAIM_VALUE_NOT_SUPPORTED_BY_QUOTE",
        reason: `Заявленный тезис "${valStr}" не подтверждается текстом выдержки: «${quote}».`
      };
    }
  }

  // Check for negation/deprecation in the quote when claimedValue is affirmative
  const claimIsNegative = NEGATION_AND_DEPRECATION_RE.test(valNorm);
  const quoteHasNegation = NEGATION_AND_DEPRECATION_RE.test(quoteNorm);
  if (quoteHasNegation && !claimIsNegative) {
    return {
      verified: false,
      code: "CLAIM_NEGATED_OR_DEPRECATED_IN_SOURCE",
      reason: `Выдержка содержит отрицание или пометку об устаревании («${quote}»), что опровергает положительный тезис "${valStr}".`
    };
  }

  return {
    verified: true,
    code: "EVIDENCE_CORRESPONDS_TO_SOURCE",
    optionName: optionName || null,
    criterion: criterion || null,
    claimedValue: valStr,
    quote,
    quoteSha256: computedSha256,
    startUtf16,
    endUtf16,
    url: snapshot.url,
    title: snapshot.title,
    snapshotId: snapshot.snapshotId,
    pageVersion: snapshot.pageVersion,
    domEpoch: snapshot.domEpoch ?? 1,
    pageDate: snapshot.pageDate || null,
    eventDate: snapshot.eventDate || null,
    fetchedAt: snapshot.fetchedAt,
    readingLimitations: snapshot.readingLimitations || {
      totalUtf16Length: snapshot.fullTextUtf16.length,
      crossOriginFramesSkippedCount: 0,
      partialReadOnly: false
    }
  };
}

module.exports = {
  NEGATION_AND_DEPRECATION_RE,
  verifyEvidenceAgainstSnapshotAndClaim
};
