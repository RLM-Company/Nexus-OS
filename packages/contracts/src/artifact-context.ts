import type { ChatTextAttachment } from "./chat-attachments.js";

export type ArtifactContextKind = "canvas" | "table" | "work";
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
