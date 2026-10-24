/**
 * @cosmora/contracts — Stage 2: Kosmora Canvas & Artifact Engine Contracts (F033–F064)
 */

import type { CriticVerdictMetadata, ManagerRuntimeRole } from "./kosmora-protocol.ts";

// F033, F045, F046: Dual-Pane, Multi-Tab & Split-View Canvas Workspace State
export interface CanvasWorkspaceState {
  workspace_id: string;
  project_id: string;
  left_chat_thread_id: string;
  active_tab_id: string | null;
  split_view_secondary_tab_id: string | null; // F046
  present_mode_fullscreen: boolean; // F059
  theme_preset: "cosmora_dark_minimal" | "high_contrast_ice" | "corporate_light"; // F057
  tabs: CanvasArtifactTab[];
  trash_bin: CanvasArtifactTab[]; // F063
}

export interface CanvasArtifactTab {
  tab_id: string;
  artifact_id: string;
  title: string;
  kind: "report" | "code" | "presentation" | "xlsx_table" | "diagram" | "ui_preview";
  current_version: string; // e.g., "v1", "v2", "v3" (F034)
  versions: CanvasArtifactVersion[];
  locked_section_ids: string[]; // F054: Section Locking
  dynamic_variables: Record<string, string | number>; // F055: Cross-document variables
  inline_review_threads: CanvasInlineReviewThread[]; // F047
  verification_badge: "critic_approved" | "needs_revision" | "manual_edit"; // F048
  audit_timeline: CanvasAuditEntry[]; // F062
}

// F034: Versioned Canvas Reports (v1, v2, v3)
export interface CanvasArtifactVersion {
  version_tag: string;
  author_type: "agent" | "user";
  author_id: string;
  content: string;
  file_bindings: FileAnalysisBindingLink[]; // F035
  critic_verdict?: CriticVerdictMetadata;
  created_at: string;
}

// F035: Direct File Analysis-to-Report Binding
export interface FileAnalysisBindingLink {
  binding_id: string;
  report_section_id: string;
  source_file_id: string;
  source_file_name: string;
  row_range?: [number, number];
  cell_ref?: string;
  extracted_metric_value: string | number;
}

// F036: Visual Line-by-Line Diff
export interface CanvasVersionDiffResult {
  artifact_id: string;
  from_version: string;
  to_version: string;
  added_lines: number;
  removed_lines: number;
  unchanged_lines: number;
  hunks: Array<{
    line_number: number;
    type: "added" | "removed" | "unchanged";
    text: string;
  }>;
}

// F037, F057, F060: Interactive Presentation Editor & Slide Deck
export interface PresentationSlide {
  slide_id: string;
  index: number;
  layout: "title_hero" | "two_column_grid" | "metrics_spotlight" | "chart_breakdown";
  action_title: string;
  bullet_points: string[];
  speaker_notes: string;
  chart_widget?: CanvasChartWidgetSpec; // F044
}

// F038: XLSX Table Generator with Formulas
export interface XlsxSheetSpec {
  sheet_name: string;
  columns: string[];
  rows: Array<Array<string | number>>;
  formulas: Array<{ cell: string; formula: string; evaluated_preview: number }>;
}

// F040: Refined Canvas Controls
export type RefinedCanvasAction =
  | "compress"
  | "academic_style"
  | "fact_check"
  | "convert_to_table";

// F042: Architectural Diagram Spec (Mermaid / D2 / Flow)
export interface CanvasDiagramSpec {
  diagram_id: string;
  engine: "mermaid" | "d2" | "flow";
  source_code: string;
  svg_export_ready: boolean;
}

// F044: Interactive Chart Widget Spec
export interface CanvasChartWidgetSpec {
  widget_id: string;
  chart_type: "line" | "bar" | "funnel" | "area";
  title: string;
  labels: string[];
  series: Array<{ name: string; values: number[] }>;
}

// F047: Inline Review Thread
export interface CanvasInlineReviewThread {
  thread_id: string;
  line_number: number;
  author: "user" | ManagerRuntimeRole;
  comment: string;
  resolved: boolean;
  created_at: string;
}

// F053: Floating TOC Entry (H1–H4)
export interface CanvasTocEntry {
  level: 1 | 2 | 3 | 4;
  heading_text: string;
  anchor_slug: string;
  line_number: number;
}

// F062: Canvas Audit Log Entry
export interface CanvasAuditEntry {
  entry_id: string;
  timestamp: string;
  actor_kind: "agent" | "user";
  actor_id: string;
  action: string;
  version_tag: string;
}
