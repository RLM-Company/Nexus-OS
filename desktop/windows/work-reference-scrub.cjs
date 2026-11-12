"use strict";
// Reference-level scrub of accepted Work examples (variant A of the
// distillation decision: docs/product/EXPERIENCE_DISTILL_PLAN_RU.md).
// Adapted from the measurement-only bench candidate
// extractive-drop-candidate-v1 (scripts/bench-semantic-experience-distill.mjs,
// Ruflo adoption line "Опыт выполнения"). Owner-approved divergence
// (2026-11-12): the two ASCII-\b patterns (credential_assignment,
// date_or_old_ref) now use letter/digit lookaround boundaries so their
// Cyrillic alternatives work in real Russian text; the frozen panel was
// measured with the original patterns, the product is re-measured on the
// same panel with the fixed ones. Matching stays conservative on purpose:
// any hit drops the whole plan step, the goal excerpt stops where the first
// stale sentence begins, and unusable input is refused instead of weakened.
// Recall beyond the frozen measurement panel is not claimed.
const unavailable = () => {
  throw Error("COMPUTER_REFERENCE_UNAVAILABLE");
};

const PATTERNS = [
  { id: "path_separator_token", re: /\S*[\\/]\S*|\b[A-Za-z]:\\/ },
  { id: "email_or_handle", re: /[\w.+-]+@[\w-]+\.[\w.-]+|@[A-Za-z0-9_]{3,}/ },
  {
    id: "credential_assignment",
    re: /(?<![\p{L}\p{N}])(?:логин|пароль|токен|ключ|секрет|password|token|pin-код)\s*[:=]/iu
  },
  { id: "credential_token", re: /\b[A-Z]{2,5}-\d{4,6}-[A-Za-z0-9]{4,8}\b|\b[A-Za-z0-9_-]{24,}\b/ },
  { id: "coordinate_pair", re: /\d{1,3}[.,]\d{3,}\s*,\s*\d{1,3}[.,]\d{3,}/ },
  {
    id: "date_or_old_ref",
    re: /\b20\d{2}-\d{2}-\d{2}\b|(?<![\p{L}\p{N}])(?:см\.|смотри)\s|#\d{2,6}\b|(?<![\p{L}\p{N}])ревизия(?![\p{L}])/iu
  },
  {
    id: "approval_or_checked",
    re: /проверено владел|принято заказчик|согласован[аоо]|одобрено|проверено мной/i
  }
];

const matchesProhibition = (text) => {
  for (const pattern of PATTERNS) if (pattern.re.test(text)) return pattern.id;
  return null;
};

// Sentence spans in UTF-16 units, the bench candidate's splitter. The goal
// excerpt stays an exact prefix of the source goal: it is cut where the first
// stale sentence begins (no later sentence is re-joined), then the shipped
// 500-unit cap and well-formed check apply as before.
const splitSentences = (text) => {
  const parts = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const symbol = text[i];
    if (
      (symbol === "." || symbol === "!" || symbol === "?") &&
      (i + 1 === text.length || /\s/.test(text[i + 1]))
    ) {
      parts.push({ start, end: i + 1 });
      let next = i + 1;
      while (next < text.length && /\s/.test(text[next])) next++;
      start = next;
      i = start - 1;
    }
  }
  if (start < text.length && text.slice(start).trim().length)
    parts.push({ start, end: text.length });
  return parts;
};

const GOAL_EXCERPT_LIMIT = 500;
function goalExcerpt(goal) {
  let excerpt = goal.slice(0, GOAL_EXCERPT_LIMIT);
  if (!excerpt.isWellFormed()) excerpt = excerpt.slice(0, -1);
  for (const { start, end } of splitSentences(excerpt)) {
    if (matchesProhibition(excerpt.slice(start, end))) {
      excerpt = goal.slice(0, start);
      if (!excerpt.isWellFormed()) excerpt = excerpt.slice(0, -1);
      excerpt = excerpt.replace(/\s+$/u, "");
      break;
    }
  }
  // A goal whose reusable prefix is empty (it begins with a stale sentence)
  // cannot become a non-empty source_goal: refuse instead of weakening.
  if (!excerpt.trim()) unavailable();
  return { excerpt, truncated: excerpt.length < goal.length };
}

// A plan step carrying any prohibition fragment is dropped as a whole. When
// every step is dropped there is no valid plan left (schema minItems: 1):
// honest refusal over an empty or silently weakened plan.
function scrubPlan(plan) {
  const kept = plan.filter(
    (step) => !matchesProhibition(step.title) && !matchesProhibition(step.criteria)
  );
  if (!kept.length) unavailable();
  return kept.map(({ title, criteria }) => ({ title, criteria }));
}

module.exports = { goalExcerpt, scrubPlan, matchesProhibition };
