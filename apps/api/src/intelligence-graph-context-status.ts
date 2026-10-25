import {
  INTELLIGENCE_GRAPH_CONTEXT_FORMAT,
  type ChatTextAttachment,
  type IntelligenceGraphSavedContextStatus
} from "@cosmora/contracts";
import {
  graphContextAttachmentHash,
  graphContextFilename,
  IntelligenceGraphContextEmptyError,
  IntelligenceGraphContextLimitError,
  IntelligenceGraphWorkspaceError,
  type IntelligenceGraphWorkspaceService
} from "@cosmora/core";

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Verify the complete stored bytes against the exact historical revision.
 * A matching filename/header alone is not provenance. Unexpected storage errors
 * remain errors, rather than turning an outage into an "unrecognized" result.
 */
export function savedGraphContextStatus(
  service: IntelligenceGraphWorkspaceService,
  owner: string,
  project: string,
  graphId: string,
  materials: { version: number; attachments: ChatTextAttachment[] }
): IntelligenceGraphSavedContextStatus {
  const graph = service.get(owner, project, graphId);
  const base = { graph_revision: graph.revision, materials_version: materials.version };
  const attachment = materials.attachments.find((f) => f.name === graphContextFilename(graphId));
  if (!attachment) return { ...base, status: "missing", current_sha256: null, saved: null };
  const current_sha256 = graphContextAttachmentHash(attachment);
  const unrecognized = { ...base, status: "unrecognized" as const, current_sha256, saved: null };
  let content: unknown;
  try {
    content = JSON.parse(attachment.content) as unknown;
  } catch {
    return unrecognized;
  }
  if (
    !object(content) ||
    content.format !== INTELLIGENCE_GRAPH_CONTEXT_FORMAT ||
    !object(content.graph) ||
    content.graph.id !== graphId ||
    typeof content.graph.revision !== "number" ||
    !Number.isSafeInteger(content.graph.revision) ||
    content.graph.revision < 1 ||
    content.graph.revision > graph.revision ||
    typeof content.query !== "string" ||
    !content.query.trim() ||
    content.query.length > 500
  )
    return unrecognized;
  try {
    const expected = service.context(
      owner,
      project,
      graphId,
      content.query,
      content.graph.revision
    );
    if (expected.sha256 !== current_sha256) return unrecognized;
  } catch (error) {
    if (
      error instanceof IntelligenceGraphContextEmptyError ||
      error instanceof IntelligenceGraphContextLimitError ||
      (error instanceof IntelligenceGraphWorkspaceError &&
        (error.code === "NOT_FOUND" || error.code === "BAD_INPUT"))
    )
      return unrecognized;
    throw error;
  }
  return {
    ...base,
    status: content.graph.revision === graph.revision ? "current" : "stale",
    current_sha256,
    saved: { revision: content.graph.revision, query: content.query }
  };
}
