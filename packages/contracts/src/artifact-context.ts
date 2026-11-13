import type { ChatTextAttachment } from "./chat-attachments.js";

/** "research" is a completed Deep Research report, exposed as a bounded text
 * snapshot through the existing project material hook. */
export type ArtifactContextKind = "canvas" | "table" | "work" | "research";
export type ArtifactContextSource = {
  kind: ArtifactContextKind;
  id: string;
  version: number;
  sha256: string;
};
export type ArtifactContextCandidate = ArtifactContextSource & {
  title: string;
  bytes: number;
};
export type ArtifactContextSelection =
  | { kind: "full" }
  | { kind: "lines"; from: number; to: number }
  | { kind: "rows"; from: number; to: number; columns: number[] };
export type ArtifactContextRequest = {
  source: ArtifactContextSource;
  selection: ArtifactContextSelection;
};
export type ArtifactContextPreview = {
  source: ArtifactContextCandidate;
  selection: ArtifactContextSelection;
  attachment: ChatTextAttachment;
  attachment_sha256: string;
  complete: boolean;
  total_units: number;
  selected_units: number;
};
