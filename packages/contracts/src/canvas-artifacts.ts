/** Canvas is an editor. It never evaluates imported HTML or source code. */
export const CANVAS_MAX_TITLE_BYTES = 240;
export const CANVAS_MAX_CONTENT_BYTES = 512 * 1024;
export const CANVAS_MAX_IMPORT_BYTES = 512 * 1024;
export const CANVAS_MAX_PROJECT_ARTIFACTS = 200;
export const CANVAS_MAX_REVISIONS = 500;
export type CanvasFormat = "markdown" | "text" | "code" | "html";
export type CanvasSource =
  | { kind: "manual" }
  | { kind: "data_workspace"; restored_from?: number }
  | { kind: "work"; work_artifact_id: string }
  | { kind: "chat"; chat_id: string; message_id: string }
  | { kind: "project_chat"; message_id: string }
  | { kind: "restore"; revision: number };
export type CanvasArtifact = {
  id: string;
  project_id: string;
  title: string;
  format: CanvasFormat;
  version: number;
  created_at: string;
  updated_at: string;
};
export type CanvasRevision = {
  artifact_id: string;
  version: number;
  title: string;
  format: CanvasFormat;
  content: string;
  sha256: string;
  source: CanvasSource;
  created_at: string;
};
export const canvasBytes = (s: string): number => new TextEncoder().encode(s).length;
export const canvasHasControlCharacters = (s: string): boolean =>
  Array.from(s).some(
    (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
  );
export const validCanvasFormat = (value: unknown): value is CanvasFormat =>
  value === "markdown" || value === "text" || value === "code" || value === "html";
export function validateCanvasContent(title: string, format: CanvasFormat, content: string): void {
  if (
    typeof title !== "string" ||
    !title.trim() ||
    canvasBytes(title) > CANVAS_MAX_TITLE_BYTES ||
    canvasHasControlCharacters(title) ||
    !validCanvasFormat(format) ||
    typeof content !== "string" ||
    content.includes("\0") ||
    canvasBytes(content) > CANVAS_MAX_CONTENT_BYTES
  ) {
    throw new Error("CANVAS_INVALID_CONTENT");
  }
}
