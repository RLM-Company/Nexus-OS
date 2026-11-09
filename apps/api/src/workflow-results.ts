import { WorkflowStoreConflict, WorkDagConflict } from "@cosmora/db";
import type { ManagerWorkCoordinator } from "./manager-work-coordinator.js";

type ResultsCoordinator = Pick<ManagerWorkCoordinator, "dag">;
type Bundle = ReturnType<ResultsCoordinator["dag"]["results"]>;
type ArtifactFile = Bundle["files"][number];
type ScopedRun = {
  id: string;
  workflow_id: string;
  definition_version: number;
  definition: { expected_results?: string[] };
  dag_id: string;
  created_at: string;
};

/** Only literal, flat names already supported by the existing results archive
 * are machine-comparable. Descriptive conditions remain human review items.
 */
const literalName = /^[a-zA-Z0-9][a-zA-Z0-9_-]*\.(md|txt|json|html|css|js|ts|py|csv)$/;
const unique = <T>(values: T[]): T[] => [...new Set(values)];
const safeText = (value: unknown, limit = 200): string =>
  typeof value === "string" ? value.slice(0, limit) : "";
const publicReview = (review: ArtifactFile["review"]) =>
  review
    ? {
        verdict: safeText(review.verdict, 40),
        kind: "model_content_review"
      }
    : null;
const publicBytes = (file: ArtifactFile) => ({
  status: file.verification.file_bytes,
  sha256: file.sha256,
  bytes: file.bytes,
  published: file.published,
  readback: "published_artifact_readback",
  code_executed: false,
  owner_accepted: false
});
const publicArtifact = (file: ArtifactFile) => ({
  id: file.id,
  name: file.name,
  version: file.version,
  bytes: file.bytes,
  sha256: file.sha256,
  node_id: file.node_id,
  work_id: file.work_id,
  created_at: file.created_at,
  review: publicReview(file.review),
  byte_verification: publicBytes(file)
});

export function workflowResultsView(input: {
  projectId: string;
  workflowId: string;
  run: ScopedRun;
  graph: {
    id: string;
    project_id: string;
    mode: string;
    execution?: { status: string } | null;
    nodes: { id: string; status: string }[];
  };
  bundle: Bundle;
}) {
  const { projectId, workflowId, run, graph, bundle } = input;
  const expected = Array.isArray(run.definition.expected_results)
    ? run.definition.expected_results.filter((value): value is string => typeof value === "string")
    : [];
  const expectedNames = unique(
    expected.filter((name) => name.length <= 100 && literalName.test(name))
  );
  const manual = unique(expected.filter((name) => name.length > 100 || !literalName.test(name)));
  const byName = new Map<string, ArtifactFile[]>();
  for (const file of bundle.files) {
    const list = byName.get(file.name) ?? [];
    list.push(file);
    byName.set(file.name, list);
  }
  const matched = expectedNames
    .map((name) => ({ name, artifacts: (byName.get(name) ?? []).map(publicArtifact) }))
    .filter((item) => item.artifacts.length > 0);
  const missing = expectedNames.filter((name) => !byName.has(name));
  const graphState =
    graph.mode === "cancelled" || graph.execution?.status === "cancelled"
      ? "cancelled"
      : graph.nodes.some((node) => node.status === "failed") || graph.execution?.status === "failed"
        ? "errors"
        : graph.nodes.length > 0 && graph.nodes.every((node) => node.status === "completed")
          ? "completed"
          : graph.nodes.some((node) => node.status === "completed")
            ? "partial"
            : "pending";
  const archiveUrl = `/api/v1/projects/${encodeURIComponent(projectId)}/work-dags/${encodeURIComponent(graph.id)}/results.zip`;
  const view = {
    capability: "workflow_run_results.v1",
    project_id: projectId,
    workflow_id: workflowId,
    run_id: run.id,
    definition_version: run.definition_version,
    created_at: run.created_at,
    dag_id: graph.id,
    graph: {
      id: graph.id,
      state: graphState,
      completed_steps: bundle.completed_steps,
      total_steps: bundle.total_steps,
      nodes: graph.nodes.map((node) => ({ id: node.id, status: node.status }))
    },
    verification: {
      kind: "published_artifact_bytes",
      verdict:
        expectedNames.length === 0
          ? "incomplete"
          : missing.length === 0 && manual.length === 0
            ? "all_literal_names_found"
            : "incomplete",
      expected_literal_count: expectedNames.length,
      found_literal_count: expectedNames.length - missing.length,
      found_artifact_versions: matched.reduce((count, item) => count + item.artifacts.length, 0),
      bytes_verified_files: bundle.files.length,
      human_review_required: manual.length > 0 || expected.length === 0,
      limits:
        "SHA-256 and byte length check published immutable files. A model review does not prove content quality, code execution or owner acceptance."
    },
    expected: {
      literal_names: expectedNames,
      matched,
      missing,
      manual_review: manual.map((condition) => ({
        condition: safeText(condition, 200),
        reason: "Descriptive expected result; no filename was guessed."
      })),
      empty: expected.length === 0
    },
    files: bundle.files.map(publicArtifact),
    archive_url: archiveUrl
  };
  if (Buffer.byteLength(JSON.stringify(view), "utf8") > 2 * 1024 * 1024)
    throw new WorkDagConflict("RESULTS_LIMIT");
  return view;
}

export function getScopedWorkflowResults(options: {
  projectId: string;
  owner: string;
  workflowId: string;
  runId: string;
  workflows: {
    run: (project: string, owner: string, workflowId: string, runId: string) => ScopedRun | null;
  };
  coordinator: ResultsCoordinator;
}) {
  const { projectId, owner, workflowId, runId, workflows, coordinator } = options;
  const run = workflows.run(projectId, owner, workflowId, runId);
  if (!run || run.workflow_id !== workflowId)
    throw new WorkflowStoreConflict("WORKFLOW_RUN_NOT_FOUND");
  const graph = coordinator.dag.get(run.dag_id, owner);
  if (!graph || graph.id !== run.dag_id || graph.project_id !== projectId)
    throw new WorkDagConflict("DAG_NOT_FOUND");
  // Results performs the existing published-artifact byte verification and its
  // own 2 MB JSON bound. Nothing here writes files, starts models or changes DAG.
  const bundle = coordinator.dag.results(run.dag_id, owner);
  return workflowResultsView({ projectId, workflowId, run, graph, bundle });
}
