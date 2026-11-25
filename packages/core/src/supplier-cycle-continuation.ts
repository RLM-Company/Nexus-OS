/** Continuation state for the Koswork supplier execution cycle.
 *
 * Pure and UI-agnostic: no storage, no model, no network. The owner-facing
 * workflow keeps accepted parts when a stage fails, asks a clarification,
 * receives new instructions, or is paused/resumed/cancelled. Every transition
 * is explicit and versioned so a stale control cannot overwrite a newer state.
 *
 * This module deliberately does not change shared ManagerWork contracts: it is
 * an adapter that the integration layer can use around the existing task entry.
 */
import { extractSupplierInput, type SupplierExtraction } from "./supplier-input-extraction.js";

export type SupplierCycleStage =
  | "collecting"
  | "extracting"
  | "awaiting_answer"
  | "calculating"
  | "result_ready"
  | "paused"
  | "cancelled";

export type SupplierCycleState = {
  version: number;
  stage: SupplierCycleStage;
  /** Parsed file parts accepted so far. Never cleared by a pause or a retry. */
  parts: unknown[];
  /** Accepted partial extraction: filled fields survive later corrections. */
  extraction: SupplierExtraction | null;
  /** Question shown to the owner; non-empty only in awaiting_answer. */
  question: string | null;
  /** Last error code; cleared only by a successful transition. */
  error_code: string | null;
  /** Calculation result marker, set once the existing calculation succeeded. */
  result: { format: string; csv: string; markdown: string } | null;
  /** Owner instructions received after the first attempt, kept in order. */
  instructions: string[];
  history: string[];
};

export type SupplierCycleEvent =
  | { type: "parts"; parts: readonly unknown[]; expected_version?: number }
  | { type: "error"; code: string; expected_version?: number }
  | { type: "answer"; parts: readonly unknown[]; expected_version?: number }
  | { type: "instructions"; text: string; expected_version?: number }
  | { type: "pause"; expected_version?: number }
  | { type: "resume"; expected_version?: number }
  | { type: "cancel"; expected_version?: number };

export class SupplierCycleConflict extends Error {
  constructor() {
    super("SUPPLIER_CYCLE_VERSION_CONFLICT");
    this.name = "SupplierCycleConflict";
  }
}

export function initialSupplierCycle(): SupplierCycleState {
  return {
    version: 1,
    stage: "collecting",
    parts: [],
    extraction: null,
    question: null,
    error_code: null,
    result: null,
    instructions: [],
    history: ["cycle started"]
  };
}

const bump = (state: SupplierCycleState, entry: string): SupplierCycleState => ({
  ...state,
  version: state.version + 1,
  history: [...state.history, entry]
});

const check = (state: SupplierCycleState, expected?: number): void => {
  if (expected !== undefined && expected !== state.version) throw new SupplierCycleConflict();
};

/** Apply one event. Accepted parts/extraction/result are never discarded by
 * pause, cancel, error or new instructions; cancel is terminal only for work
 * in progress and preserves the accepted result for download. */
export function applySupplierCycleEvent(
  state: SupplierCycleState,
  event: SupplierCycleEvent
): SupplierCycleState {
  check(state, event.expected_version);
  switch (event.type) {
    case "cancel":
      return bump({ ...state, stage: "cancelled", question: null, error_code: null }, "cancelled");
    case "pause":
      if (state.stage === "cancelled" || state.stage === "result_ready") return state;
      return bump({ ...state, stage: "paused" }, "paused");
    case "resume":
      if (state.stage !== "paused") return state;
      return bump(
        {
          ...state,
          stage: state.question
            ? "awaiting_answer"
            : state.extraction?.ready
              ? "calculating"
              : "extracting",
          error_code: null
        },
        "resumed"
      );
    case "instructions": {
      if (state.stage === "cancelled") return state;
      const text = event.text.trim();
      if (!text) return state;
      const next = bump(
        {
          ...state,
          stage: state.extraction?.ready
            ? "calculating"
            : state.stage === "awaiting_answer"
              ? "extracting"
              : state.stage,
          instructions: [...state.instructions, text],
          question: null,
          error_code: null
        },
        "owner instructions accepted"
      );
      return next;
    }
    case "error":
      if (state.stage === "cancelled") return state;
      return bump(
        {
          ...state,
          stage: state.result ? "result_ready" : "extracting",
          error_code: event.code,
          question: null
        },
        `intermediate error: ${event.code}`
      );
    case "parts": {
      if (state.stage === "cancelled" || state.stage === "result_ready") return state;
      // Merge by object identity of the source file content; repeated parts
      // are idempotent, corrected parts replace their earlier value.
      const parts = [...state.parts, ...event.parts];
      const extraction = extractSupplierInput(parts);
      if (extraction.ready)
        return bump(
          { ...state, stage: "calculating", parts, extraction, question: null, error_code: null },
          "extraction complete"
        );
      const question = extraction.gaps.find((gap) => gap.question)?.question ?? null;
      return bump(
        {
          ...state,
          stage: question ? "awaiting_answer" : "extracting",
          parts,
          extraction,
          question,
          error_code: null
        },
        question ? "clarification required" : "extraction incomplete"
      );
    }
    case "answer": {
      if (state.stage !== "awaiting_answer" && state.stage !== "extracting") return state;
      const parts = [...state.parts, ...event.parts];
      const extraction = extractSupplierInput(parts);
      if (extraction.ready)
        return bump(
          { ...state, stage: "calculating", parts, extraction, question: null, error_code: null },
          "answer accepted"
        );
      const question = extraction.gaps.find((gap) => gap.question)?.question ?? null;
      return bump(
        { ...state, parts, extraction, question: question ?? null, error_code: null },
        "answer recorded"
      );
    }
  }
}

/** Mark calculation success without changing the assembled input. The caller
 * passes only the report identity: contents stay in the existing file layer. */
export function acceptSupplierResult(
  state: SupplierCycleState,
  report: { format: string; csv: string; markdown: string }
): SupplierCycleState {
  if (state.stage !== "calculating" || !state.extraction?.ready) return state;
  return bump(
    { ...state, stage: "result_ready", result: report, error_code: null },
    "result accepted"
  );
}
