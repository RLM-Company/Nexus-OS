/**
 * @cosmora/contracts — Stage 2: Kosmora Canvas & Artifact Engine Contracts (F033–F064)
 */

import type { CriticVerdictMetadata, ManagerRuntimeRole } from "./kosmora-protocol.js";

export interface CanvasWorkspaceState {
  workspace_id: string;
  project_id: string;
  left_chat_thread_id: string;
  active_tab_id: string | null;
  split_view_secondary_tab_id: string | null;
  present_mode_fullscreen: boolean;
  theme_preset: "cosmora_dark_minimal" | "high_contrast_ice" | "corporate_light";
  tabs: CanvasArtifactTab[];
  trash_bin: CanvasArtifactTab[];
}

export interface CanvasArtifactTab {
  tab_id: string;
  artifact_id: string;
  title: string;
  kind: "report" | "code" | "presentation" | "xlsx_table" | "diagram" | "ui_preview";
  current_version: string;
  versions: ReadonlyArray<Readonly<CanvasArtifactVersion>>;
  locked_section_ids: string[];
  dynamic_variables: Record<string, string | number>;
  inline_review_threads: CanvasInlineReviewThread[];
  verification_badge: "critic_approved" | "needs_revision" | "manual_edit";
  audit_timeline: CanvasAuditEntry[];
}

export interface CanvasArtifactVersion {
  version_tag: string;
  author_type: "agent" | "user";
  author_id: string;
  content: string;
  content_sha256?: string;
  file_bindings: FileAnalysisBindingLink[];
  critic_verdict?: CriticVerdictMetadata;
  created_at: string;
}

export interface FileAnalysisBindingLink {
  binding_id: string;
  report_section_id: string;
  source_file_id: string;
  source_file_name: string;
  row_range?: [number, number];
  cell_ref?: string;
  extracted_metric_value: string | number;
}

export interface CanvasVersionDiffResult {
  artifact_id: string;
  from_version: string;
  to_version: string;
  added_lines: number;
  removed_lines: number;
  unchanged_lines: number;
  hunks: Array<{
    line_number: number;
    old_line_number?: number;
    new_line_number?: number;
    type: "added" | "removed" | "unchanged";
    text: string;
  }>;
}

export interface PresentationSlide {
  slide_id: string;
  index: number;
  layout: "title_hero" | "two_column_grid" | "metrics_spotlight" | "chart_breakdown";
  action_title: string;
  bullet_points: string[];
  speaker_notes: string;
  chart_widget?: CanvasChartWidgetSpec;
}

export interface XlsxSheetSpec {
  sheet_name: string;
  columns: string[];
  rows: Array<Array<string | number>>;
  formulas: Array<{ cell: string; formula: string; evaluated_preview?: number }>;
}

export type RefinedCanvasAction = "compress" | "academic_style" | "fact_check" | "convert_to_table";

export interface CanvasDiagramSpec {
  diagram_id: string;
  engine: "mermaid" | "d2" | "flow";
  source_code: string;
  svg_export_ready: boolean;
  svg_markup?: string;
}

export interface CanvasChartWidgetSpec {
  widget_id: string;
  chart_type: "line" | "bar" | "funnel" | "area";
  title: string;
  labels: string[];
  series: Array<{ name: string; values: number[] }>;
}

export interface CanvasInlineReviewThread {
  thread_id: string;
  line_number: number;
  author: "user" | ManagerRuntimeRole;
  comment: string;
  resolved: boolean;
  created_at: string;
}

export interface CanvasTocEntry {
  level: 1 | 2 | 3 | 4;
  heading_text: string;
  anchor_slug: string;
  line_number: number;
}

export interface CanvasAuditEntry {
  entry_id: string;
  timestamp: string;
  actor_kind: "agent" | "user";
  actor_id: string;
  action: string;
  version_tag: string;
}

export type CanvasArtifactKind = "document" | "sheet" | "presentation" | "diagram" | "code";

export interface CanvasBlock {
  readonly block_id: string;
  readonly type: "markdown" | "table" | "code" | "chart" | "callout";
  readonly heading?: string;
  readonly content: string;
  readonly citations: ReadonlyArray<{
    citation_id: string;
    uri: string;
    title: string;
  }>;
}

export interface CanvasArtifactRevision {
  readonly revision_id: string;
  readonly artifact_id: string;
  readonly kind: CanvasArtifactKind;
  readonly version: number;
  readonly title: string;
  readonly author_id: string;
  readonly commit_message: string;
  readonly blocks: ReadonlyArray<CanvasBlock>;
  readonly content_sha256: string;
  readonly created_at: string;
}
