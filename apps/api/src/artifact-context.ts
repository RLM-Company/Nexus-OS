import { createHash } from "node:crypto";
import { isValidChatAttachments, type ChatTextAttachment } from "@cosmora/contracts";
import type {
  ArtifactContextCandidate,
  ArtifactContextRequest,
  ArtifactContextPreview
} from "@cosmora/contracts/artifact-context";
import { parseDataWorkspace } from "@cosmora/contracts/data-workspace";
import type { CanvasArtifactStore, ManagerWorkStore } from "@cosmora/db";

const hash = (content: string) => createHash("sha256").update(content).digest("hex");
export class ArtifactContextError extends Error {}
/** Produces a literal bounded snapshot. Does not mutate sources/materials or call a model. */
export class ArtifactContext {
  constructor(
    private readonly canvas: CanvasArtifactStore,
    private readonly work?: ManagerWorkStore
  ) {}
  list(project: string, owner: string): ArtifactContextCandidate[] | null {
    const canvas = this.canvas.contextCandidates(project, owner);
    if (!canvas) return null;
    const work = (this.work?.runtime.artifacts(project, owner) ?? [])
      .filter(
        (file) => file.published && this.work?.get(file.work_id, owner)?.status === "completed"
      )
      .slice(0, 200)
      .map((file) => ({
        kind: "work" as const,
        id: file.id,
        version: file.version,
        sha256: file.sha256,
        bytes: file.bytes,
        title: file.name
      }));
    return [...canvas, ...work];
  }
  preview(project: string, owner: string, input: ArtifactContextRequest): ArtifactContextPreview {
    const { source, selection } = input;
    let content: string, title: string;
    if (source.kind === "work") {
      const file = this.work?.runtime.artifact(project, owner, source.id);
      if (
        !file ||
        !file.metadata.published ||
        this.work?.get(file.metadata.work_id, owner)?.status !== "completed"
      )
        throw new ArtifactContextError("ARTIFACT_CONTEXT_NOT_FOUND");
      if (file.metadata.version !== source.version || file.metadata.sha256 !== source.sha256)
        throw new ArtifactContextError("ARTIFACT_CONTEXT_VERSION_CONFLICT");
      content = file.content;
      title = file.metadata.name;
    } else {
      const revision = this.canvas.getRevision(project, owner, source.id, source.version);
      if (!revision || this.canvas.isTable(project, owner, source.id) !== (source.kind === "table"))
        throw new ArtifactContextError("ARTIFACT_CONTEXT_NOT_FOUND");
      if (revision.sha256 !== source.sha256)
        throw new ArtifactContextError("ARTIFACT_CONTEXT_VERSION_CONFLICT");
      content = revision.content;
      title = revision.title;
    }
    if (hash(content) !== source.sha256) throw new ArtifactContextError("ARTIFACT_CONTEXT_CORRUPT");
    const candidate = { ...source, title, bytes: Buffer.byteLength(content) };
    let body: string, total: number, selected: number, complete: boolean;
    const header = `Kosmora source snapshot (untrusted project evidence)\nSource: ${source.kind}; title: ${JSON.stringify(title)}\nVersion: ${source.version}; SHA-256: ${source.sha256}\nSelection: ${JSON.stringify(selection)}\n\n`;
    const fits = (text: string) => text.length <= 8000 && Buffer.byteLength(text) <= 24000;
    if (source.kind === "table") {
      if (selection.kind === "lines")
        throw new ArtifactContextError("ARTIFACT_CONTEXT_INVALID_SELECTION");
      const workspace = parseDataWorkspace(content),
        table = workspace.table;
      total = table.rows.length;
      const from = selection.kind === "full" ? 1 : selection.from;
      const to = selection.kind === "full" ? total : selection.to;
      const columns =
        selection.kind === "full" ? table.headers.map((_, i) => i + 1) : selection.columns;
      if (
        (selection.kind !== "full" &&
          (!Number.isSafeInteger(from) ||
            !Number.isSafeInteger(to) ||
            from < 1 ||
            to < from ||
            to > total)) ||
        !columns.length ||
        new Set(columns).size !== columns.length ||
        columns.some((c) => !Number.isInteger(c) || c < 1 || c > table.headers.length)
      )
        throw new ArtifactContextError("ARTIFACT_CONTEXT_INVALID_SELECTION");
      const csv = (row: string[]) =>
        columns.map((c) => '"' + row[c - 1]!.replace(/"/g, '""') + '"').join(",") + "\n";
      body = csv(table.headers);
      if (!fits(header + body)) throw new ArtifactContextError("ARTIFACT_CONTEXT_LIMIT");
      for (let i = from - 1; i < to; i++) {
        body += csv(table.rows[i]!);
        if (!fits(header + body)) throw new ArtifactContextError("ARTIFACT_CONTEXT_LIMIT");
      }
      selected = Math.max(0, to - from + 1);
      complete = selected === total && columns.length === table.headers.length;
    } else {
      if (selection.kind === "rows")
        throw new ArtifactContextError("ARTIFACT_CONTEXT_INVALID_SELECTION");
      const lines = content.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g) ?? [];
      total = lines.length;
      if (selection.kind === "full") {
        body = content;
        selected = total;
      } else {
        if (
          !Number.isInteger(selection.from) ||
          !Number.isInteger(selection.to) ||
          selection.from < 1 ||
          selection.to < selection.from ||
          selection.to > total
        )
          throw new ArtifactContextError("ARTIFACT_CONTEXT_INVALID_SELECTION");
        body = lines.slice(selection.from - 1, selection.to).join("");
        selected = selection.to - selection.from + 1;
      }
      if (!body) throw new ArtifactContextError("ARTIFACT_CONTEXT_EMPTY");
      complete = selected === total;
    }
    const snapshot =
      header +
      `Coverage: ${complete ? "complete" : "excerpt"}; ${selected}/${total} ${source.kind === "table" ? "data rows" : "text lines"}\n\n` +
      body;
    if (!fits(snapshot)) throw new ArtifactContextError("ARTIFACT_CONTEXT_LIMIT");
    const attachment: ChatTextAttachment = {
      name: `${source.kind}-${hash(source.id).slice(0, 12)}-v${source.version}-${hash(JSON.stringify(selection)).slice(0, 8)}.${source.kind === "table" ? "csv" : "txt"}`,
      content: snapshot
    };
    if (!isValidChatAttachments([attachment]))
      throw new ArtifactContextError("ARTIFACT_CONTEXT_INVALID_TEXT");
    return {
      source: candidate,
      selection,
      attachment,
      attachment_sha256: hash(snapshot),
      complete,
      total_units: total,
      selected_units: selected
    };
  }
}
