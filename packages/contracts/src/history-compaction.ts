import type { ContextMemoryBundle } from "./context-memory.js";
import type { GeneralChatMessage } from "./domain.js";

export interface HistoryCompactionOptions {
  enabled: boolean;
  query: string;
  manual_summary?: boolean;
}
export interface HistoryCompactionReport {
  method: "verified-extractive-v1";
  state: "disabled" | "not_needed" | "applied" | "blocked" | "skipped";
  reason:
    | "off"
    | "short_history"
    | "manual_summary"
    | "unsupported_material"
    | "input_limit"
    | "protected_budget"
    | "no_saving"
    | "ready";
  original_messages: number;
  compacted_messages: number;
  source_bytes: number | null;
  capsule_bytes: number;
  protected_spans: number;
  protected_kept: number;
  omitted_spans: number;
  sensitive_messages: number;
  duplicate_spans: number;
}
export interface CompactedHistory {
  messages: GeneralChatMessage[];
  memory?: ContextMemoryBundle;
  report: HistoryCompactionReport;
}
export interface HistoryCompactionPreview {
  report: HistoryCompactionReport;
  memory: ContextMemoryBundle | null;
  before_input_upper_bound: number | null;
  after_input_upper_bound: number | null;
  dispatch_blocked: boolean;
}
