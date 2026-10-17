import {
  CANVAS_MAX_CONTENT_BYTES,
  CANVAS_MAX_TITLE_BYTES,
  canvasBytes,
  canvasHasControlCharacters,
  validCanvasFormat,
  type CanvasFormat
} from "@cosmora/contracts/canvas-artifacts";

export type CanvasDraft = {
  title: string;
  format: CanvasFormat;
  content: string;
  baseVersion: number;
  createRequestId?: string;
};
export const canvasDraftKey = (ownerScope: string, projectId: string, id: string): string =>
  `kosmora:canvas:draft:v2:${encodeURIComponent(ownerScope)}:${encodeURIComponent(projectId)}:${encodeURIComponent(id)}`;

export function parseCanvasDraft(
  serialized: string | null,
  baseVersion: number
): CanvasDraft | null {
  if (!serialized || serialized.length > CANVAS_MAX_CONTENT_BYTES * 6 + 4096) return null;
  try {
    const value: unknown = JSON.parse(serialized);
    if (!value || typeof value !== "object") return null;
    const v = value as Partial<CanvasDraft>;
    if (
      typeof v.title !== "string" ||
      typeof v.content !== "string" ||
      !validCanvasFormat(v.format) ||
      typeof v.baseVersion !== "number" ||
      !Number.isSafeInteger(v.baseVersion) ||
      v.baseVersion < 0 ||
      v.baseVersion > baseVersion ||
      canvasBytes(v.content) > CANVAS_MAX_CONTENT_BYTES ||
      canvasBytes(v.title) > CANVAS_MAX_TITLE_BYTES ||
      canvasHasControlCharacters(v.title) ||
      v.content.includes("\0") ||
      (v.createRequestId !== undefined &&
        (typeof v.createRequestId !== "string" || !/^[a-f0-9-]{36}$/i.test(v.createRequestId)))
    )
      return null;
    return {
      title: v.title,
      format: v.format,
      content: v.content,
      baseVersion: v.baseVersion,
      ...(v.createRequestId ? { createRequestId: v.createRequestId } : {})
    };
  } catch {
    return null;
  }
}
