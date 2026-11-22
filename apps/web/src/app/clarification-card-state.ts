/** Owner clarification card for Koswork (stage-three instruction, 15 Nov 2026).
 *
 * Pure state + scoped local persistence. The card belongs to ONE current task
 * (project, optionally a selected plan), survives a page reload, and an answer
 * or skip is counted exactly once. Submission goes through the existing
 * composer/permission flow; this module never sends anything by itself. */

export type ClarificationOption = { number: number; label: string };
export type ClarificationAnswer =
  { kind: "option"; number: number; label: string } | { kind: "free_text"; value: string };
export type ClarificationStatus = "pending" | "answered" | "skipped";

export type ClarificationCard = {
  id: string;
  taskScope: string;
  question: string;
  options: ClarificationOption[];
  required: boolean;
  status: ClarificationStatus;
  answer: ClarificationAnswer | null;
  freeText: string;
  selectedNumber: number | null;
};

export const CLARIFICATION_PREFIX = "cosmora:clarification:";
const STORAGE_VERSION = 1;
const MAX_QUESTION = 500;
const MAX_OPTIONS = 9;
const MAX_LABEL = 300;
const MAX_FREE_TEXT = 2000;
const MAX_AGE_MS = 7 * 86400_000;

export const clarificationStorageKey = (taskScope: string): string =>
  CLARIFICATION_PREFIX + taskScope;

/** One question, numbered options, bounded lengths. Rejects malformed input
 * instead of silently rendering a card the owner cannot use. */
export function createClarificationCard(input: {
  id: string;
  taskScope: string;
  question: string;
  options: string[];
  required: boolean;
}): ClarificationCard {
  const question = input.question.trim();
  if (
    !input.id ||
    !input.taskScope ||
    !question ||
    question.length > MAX_QUESTION ||
    input.options.length < 1 ||
    input.options.length > MAX_OPTIONS ||
    input.options.some((label) => !label.trim() || label.length > MAX_LABEL)
  )
    throw new Error("INVALID_CLARIFICATION");
  return {
    id: input.id,
    taskScope: input.taskScope,
    question,
    options: input.options.map((label, index) => ({ number: index + 1, label: label.trim() })),
    required: input.required,
    status: "pending",
    answer: null,
    freeText: "",
    selectedNumber: null
  };
}

type Stored = {
  version: number;
  savedAt: number;
  card: ClarificationCard;
};

/** Damaged, stale or foreign records are ignored, not rendered as a live card. */
export function readClarificationCard(
  storage: Pick<Storage, "getItem" | "removeItem">,
  taskScope: string
): ClarificationCard | null {
  try {
    const raw = storage.getItem(clarificationStorageKey(taskScope));
    if (!raw) return null;
    const value = JSON.parse(raw) as Stored;
    if (
      value.version !== STORAGE_VERSION ||
      typeof value.savedAt !== "number" ||
      !Number.isFinite(value.savedAt) ||
      Date.now() - value.savedAt > MAX_AGE_MS
    ) {
      storage.removeItem(clarificationStorageKey(taskScope));
      return null;
    }
    const card = value.card;
    if (
      !card ||
      card.taskScope !== taskScope ||
      typeof card.id !== "string" ||
      typeof card.question !== "string" ||
      !["pending", "answered", "skipped"].includes(card.status) ||
      !Array.isArray(card.options) ||
      card.options.some((o) => !Number.isInteger(o.number) || typeof o.label !== "string") ||
      (card.status !== "pending" && card.answer === undefined)
    )
      return null;
    return card;
  } catch {
    return null;
  }
}

export function saveClarificationCard(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  card: ClarificationCard
): void {
  const value: Stored = { version: STORAGE_VERSION, savedAt: Date.now(), card };
  storage.setItem(clarificationStorageKey(card.taskScope), JSON.stringify(value));
}

export function clearClarificationCard(
  storage: Pick<Storage, "removeItem">,
  taskScope: string
): void {
  storage.removeItem(clarificationStorageKey(taskScope));
}

export function selectOption(card: ClarificationCard, number: number): ClarificationCard {
  if (card.status !== "pending") return card;
  const option = card.options.find((o) => o.number === number);
  if (!option) return card;
  return { ...card, selectedNumber: number, freeText: "" };
}

export function setFreeText(card: ClarificationCard, value: string): ClarificationCard {
  if (card.status !== "pending" || value.length > MAX_FREE_TEXT) return card;
  return { ...card, freeText: value, selectedNumber: null };
}

/** Exactly one terminal transition per card id. A second answer/skip is inert. */
export function answerClarification(card: ClarificationCard): ClarificationCard {
  if (card.status !== "pending") return card;
  const answer: ClarificationAnswer | null = card.freeText.trim()
    ? { kind: "free_text", value: card.freeText.trim() }
    : card.selectedNumber !== null
      ? (() => {
          const option = card.options.find((o) => o.number === card.selectedNumber)!;
          return { kind: "option" as const, number: option.number, label: option.label };
        })()
      : null;
  if (!answer) return card;
  return { ...card, status: "answered", answer };
}

export function skipClarification(card: ClarificationCard): ClarificationCard {
  if (card.status !== "pending" || card.required) return card;
  return { ...card, status: "skipped", answer: null };
}

/** Text inserted into the existing composer; the owner still presses Send. */
export function clarificationDraft(card: ClarificationCard): string | null {
  if (card.status !== "answered" || !card.answer) return null;
  return card.answer.kind === "option"
    ? `${card.answer.number}. ${card.answer.label}`
    : card.answer.value;
}

export function clarificationWaiting(card: ClarificationCard): boolean {
  return card.status === "pending" && card.required;
}
