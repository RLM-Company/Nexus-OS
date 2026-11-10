// Frozen synthetic evaluation of the shipped workflow run results view
// (the "outcome evaluation" step of the Ruflo/Gemini distillation block).
// This bench EXECUTES the shipped deterministic checker as-is
// (apps/api/src/workflow-results.ts) against synthetic published-artifact and
// expectation snapshots; no product code changes, no models, no weights, and
// the only written file is the frozen report. Results are one-machine
// measurements on synthetic data, not SLA or intelligence claims. The declared
// behavior under measurement (docs/handoff/KOSWORK_WORKFLOW_RESULTS_RU.md):
// only flat literal file names are machine-comparable, descriptive or
// path-shaped or overlong expectations stay in manual review, duplicates stay
// as separate versions, an empty expectation list is not a verified outcome,
// graph state is separate from name matching, and a model review never proves
// content quality, code execution or owner acceptance. The DB-backed upstream
// verification chain (sha256/bytes/published/binding enforcement before the
// view) is out of scope here and is covered by shipped endpoint tests.
import { readFile, writeFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { workflowResultsView, getScopedWorkflowResults } from "../apps/api/src/workflow-results.ts";

const [output, comparePath] = process.argv.slice(2);
const fixture = JSON.parse(
  await readFile(
    new URL("../packages/db/test/fixtures/semantic-run-outcome-evaluation.json", import.meta.url),
    "utf8"
  )
);
const fixtureSha = createHash("sha256").update(JSON.stringify(fixture)).digest("hex");
const VIEW_LIMIT_BYTES = 2 * 1024 * 1024;

// Script-relative arguments stay the frozen report convention; absolute paths
// are accepted for throwaway recheck files outside the repository.
const resolveArg = (value) =>
  /^[A-Za-z]:[\\/]/.test(value)
    ? new URL("file:///" + value.replace(/\\/g, "/"))
    : new URL("../" + value, import.meta.url);

const byteLen = (value) => Buffer.byteLength(value, "utf8");
const stable = (value) => JSON.stringify(value);
const stablePretty = (value) => JSON.stringify(value, null, 2);
const stripMachine = (value) =>
  JSON.parse(
    JSON.stringify(value, (key, item) =>
      key === "ms" || key === "rss_snapshot_mib" ? undefined : item
    )
  );
const digest = (value) => createHash("sha256").update(stable(value)).digest("hex");

// Mirrors the file objects that resultsFor (work-dag-coordinator.ts) hands to
// the view; the view consumes metadata only, review verdicts stay metadata,
// and nothing is ever code-executed or owner-accepted. sha256 and bytes are
// real transforms of the frozen synthetic content.
const toBundleFile = (file) => {
  const bytes = byteLen(file.content);
  const sha256 = createHash("sha256").update(Buffer.from(file.content, "utf8")).digest("hex");
  return {
    node_id: file.node_id,
    title: "Синтетический шаг " + file.name,
    id: file.id,
    name: file.name,
    version: file.version,
    bytes,
    sha256,
    published: true,
    content: file.content,
    review: file.review,
    sources: file.sources,
    verification: {
      file_created: true,
      file_bytes: "verified",
      content_review: file.review?.verdict === "PASS" ? "model_critic_pass" : "not_passed",
      code_executed: false,
      owner_accepted: false
    }
  };
};

const runView = (input) => {
  try {
    return { view: workflowResultsView(input), thrown: null };
  } catch (error) {
    return { view: null, thrown: String(error.message ?? error) };
  }
};

// Every compared field of the shipped view is declared in the fixture.
const evaluateCase = (c) => {
  const bundle = {
    schema_version: 1,
    graph_id: c.run.dag_id,
    title: "Синтетический запуск " + c.id,
    completed_steps: c.completed_steps,
    total_steps: c.total_steps,
    files: c.files.map(toBundleFile)
  };
  const graphs = (c.graphs ?? [c.graph]).map((graph) => ({
    ...graph,
    probe: graph.probe ?? null
  }));
  const probes = c.ground_truth.probes ?? [null];

  const runs = graphs.map((graph, i) => {
    const started = performance.now();
    const direct = runView({
      projectId: graph.project_id,
      workflowId: c.run.workflow_id,
      run: c.run,
      graph,
      bundle
    });
    const ms = performance.now() - started;
    return {
      direct,
      ms,
      digest: digest(direct.view ?? { thrown: direct.thrown })
    };
  });
  const views = runs.map((run) => run.direct.view);
  const view = views[0];

  const checks = [];
  const expect = (field, expected, actual) =>
    checks.push({ field, ok: stable(expected) === stable(actual), expected, actual });
  if (view) {
    const gt = c.ground_truth;
    expect("verdict", gt.verdict, view.verification.verdict);
    expect(
      "human_review_required",
      gt.human_review_required,
      view.verification.human_review_required
    );
    if ("graph_state" in gt && gt.graph_state !== null)
      expect("graph_state", gt.graph_state, view.graph.state);
    expect("expected_empty", gt.expected_empty, view.expected.empty);
    expect("literal_names", gt.literal_names, view.expected.literal_names);
    expect("missing", gt.missing, view.expected.missing);
    expect(
      "matched_names",
      gt.matched_names,
      view.expected.matched.map((item) => item.name)
    );
    expect(
      "manual_conditions",
      gt.manual_conditions,
      view.expected.manual_review.map((item) => item.condition)
    );
    expect(
      "manual_reason",
      true,
      view.expected.manual_review.every(
        (item) => item.reason === "Descriptive expected result; no filename was guessed."
      )
    );
    expect(
      "expected_literal_count",
      gt.expected_literal_count,
      view.verification.expected_literal_count
    );
    expect("found_literal_count", gt.found_literal_count, view.verification.found_literal_count);
    expect(
      "found_artifact_versions",
      gt.found_artifact_versions,
      view.verification.found_artifact_versions
    );
    expect("bytes_verified_files", gt.bytes_verified_files, view.verification.bytes_verified_files);
    expect("files_listed", bundle.files.length, view.files.length);
    expect("capability", "workflow_run_results.v1", view.capability);
  } else {
    checks.push({ field: "view", ok: false, expected: "view", actual: runs[0].direct.thrown });
  }
  const probeDiffsOnlyInGraph = [];
  for (let i = 1; i < graphs.length; i++) {
    expect("probe:" + probes[i].id + ":graph_state", probes[i].graph_state, views[i]?.graph.state);
    const stripView = (value) => {
      if (!value) return null;
      const { graph, dag_id, archive_url, ...rest } = value;
      return rest;
    };
    probeDiffsOnlyInGraph.push(stable(stripView(views[i - 1])) === stable(stripView(views[i])));
  }
  const probesOnlyGraphDiffers = probeDiffsOnlyInGraph.every((same) => same === true);

  // The view must never echo published content back: name presence, not content.
  const tokens = c.files.map((file, i) => "SYNTH-CONTENT-ECHO-" + c.id + "-" + (i + 1));
  const allViewsText = runs.map((run) => JSON.stringify(run.direct.view)).join("\n");
  const contentEchos = c.files.filter((file) => allViewsText.includes(file.content));
  const tokenEchos = tokens.filter((token) => allViewsText.includes(token));

  const byteVerifications = views
    .filter((v) => v !== null)
    .flatMap((v) => v.files.map((file) => file.byte_verification));
  const reviews = views
    .filter((v) => v !== null)
    .flatMap((v) => v.files.map((file) => file.review))
    .filter((review) => review !== null);
  const limitText =
    "SHA-256 and byte length check published immutable files. A model review does not prove content quality, code execution or owner acceptance.";

  return {
    id: c.id,
    bundle_files: bundle.files.length,
    probes: probes.filter((probe) => probe !== null).length,
    view_bytes: view === null ? 0 : byteLen(stable(view)),
    within_view_limit: view === null ? true : byteLen(stable(view)) <= VIEW_LIMIT_BYTES,
    field_checks: checks.length,
    field_mismatches: checks.filter((check) => !check.ok),
    probes_only_graph_differs: probes.length > 1 ? probesOnlyGraphDiffers : null,
    content_echo_hits: contentEchos.length + tokenEchos.length,
    invariant_files_seen: byteVerifications.length,
    owner_accepted_false_everywhere: byteVerifications.every((b) => b.owner_accepted === false),
    code_executed_false_everywhere: byteVerifications.every((b) => b.code_executed === false),
    readback_label_everywhere: byteVerifications.every(
      (b) => b.readback === "published_artifact_readback"
    ),
    review_kind_everywhere: reviews.every((r) => r.kind === "model_content_review"),
    view_limit_text_everywhere:
      view === null ? false : views.every((v) => v.verification.limits === limitText),
    case_digest: digest(runs.map((run) => run.digest)),
    ms: Math.round(runs.reduce((sum, run) => sum + run.ms, 0) * 1000) / 1000
  };
};

const cases = fixture.cases.map(evaluateCase);
const caseSha = digest(cases.map(({ ms, ...rest }) => rest));

// Scoped lookup: the happy path must be bit-identical to the direct view call,
// and the error paths must carry the shipped conflict names. The stubs are
// deterministic; no store, no network, no model.
const happy = fixture.cases[0];
const happyBundle = {
  schema_version: 1,
  graph_id: happy.run.dag_id,
  title: "Синтетический запуск " + happy.id,
  completed_steps: happy.completed_steps,
  total_steps: happy.total_steps,
  files: happy.files.map(toBundleFile)
};
const happyGraph = happy.graph;
const directScoped = runView({
  projectId: happyGraph.project_id,
  workflowId: happy.run.workflow_id,
  run: happy.run,
  graph: happyGraph,
  bundle: happyBundle
});
const directBytes = stable(directScoped.view ?? null);

const runLookup = (project, owner, workflowId, runId) => {
  if (owner === "demo-owner-not-found") return null;
  if (owner === "demo-owner-mismatch") return { ...happy.run, workflow_id: "wf-other-workflow" };
  return happy.run;
};
const dagLookup = (id, owner) => (owner === "demo-owner-no-dag" ? null : happyGraph);

const tryScoped = (owner) => {
  try {
    const view = getScopedWorkflowResults({
      projectId: happyGraph.project_id,
      owner,
      workflowId: happy.run.workflow_id,
      runId: happy.run.id,
      workflows: { run: runLookup },
      coordinator: { dag: { get: dagLookup, results: (id, ownerScope) => happyBundle } }
    });
    return { ok: stable(view) === directBytes, thrown: null };
  } catch (error) {
    return { ok: false, thrown: String(error.message ?? error) };
  }
};
const scopedChecks = [
  { probe: "scoped_happy_path_bit_identical", ...tryScoped("demo-owner-scoped") },
  { probe: "scoped_run_not_found", ...tryScoped("demo-owner-not-found") },
  { probe: "scoped_workflow_mismatch", ...tryScoped("demo-owner-mismatch") },
  { probe: "scoped_graph_not_found", ...tryScoped("demo-owner-no-dag") }
];
const scopedProbesOk =
  scopedChecks[0].ok &&
  scopedChecks[1].thrown === "WORKFLOW_RUN_NOT_FOUND" &&
  scopedChecks[2].thrown === "WORKFLOW_RUN_NOT_FOUND" &&
  scopedChecks[3].thrown === "DAG_NOT_FOUND";

// 2 MiB view bound: a deterministic synthetic bundle pushes the view over the
// shipped limit and the shipped conflict must surface exactly. Declared as a
// synthetic limit probe, not part of the frozen fixture.
const limitContent = "probe";
const limitFiles = Array.from({ length: 8000 }, (_, index) => ({
  node_id: "node-limit",
  title: "Синтетический шаг лимита",
  id: "file-limit-" + index,
  name: "f" + index + ".json",
  version: 1,
  bytes: byteLen(limitContent),
  sha256: createHash("sha256")
    .update(limitContent + index)
    .digest("hex"),
  published: true,
  content: limitContent,
  review: null,
  sources: [],
  verification: {
    file_created: true,
    file_bytes: "verified",
    content_review: "not_passed",
    code_executed: false,
    owner_accepted: false
  }
}));
const limitResult = runView({
  projectId: "demo-weekly-desk",
  workflowId: "wf-weekly-report-01",
  run: {
    id: "run-limit-probe",
    workflow_id: "wf-weekly-report-01",
    definition_version: 1,
    definition: { expected_results: [] },
    dag_id: "dag-limit-probe",
    created_at: "2026-11-09T10:45:00.000Z"
  },
  graph: {
    id: "dag-limit-probe",
    project_id: "demo-weekly-desk",
    mode: "manual",
    execution: { status: "completed" },
    nodes: [{ id: "node-limit", status: "completed" }]
  },
  bundle: {
    schema_version: 1,
    graph_id: "dag-limit-probe",
    title: "Синтетический запуск лимита",
    completed_steps: 1,
    total_steps: 1,
    files: limitFiles
  }
});
const limitProbeOk = limitResult.thrown === "RESULTS_LIMIT" && limitResult.view === null;

const at = (id) => fixture.cases.find((c) => c.id === id).ground_truth;
const manualExpectations = cases.reduce((sum, c) => sum + at(c.id).manual_conditions.length, 0);
const machineExpectations = cases.reduce((sum, c) => sum + at(c.id).literal_names.length, 0);
const graphStateHistogram = {};
for (const probe of fixture.cases.find((c) => c.ground_truth.probes).ground_truth.probes) {
  graphStateHistogram[probe.graph_state] = (graphStateHistogram[probe.graph_state] ?? 0) + 1;
}
const verdictHistogram = { all_literal_names_found: 0, incomplete: 0 };
for (const caseItem of fixture.cases)
  verdictHistogram[caseItem.ground_truth.verdict] =
    (verdictHistogram[caseItem.ground_truth.verdict] ?? 0) + 1;

const report = {
  fixture_sha256: fixtureSha,
  case_sha256: caseSha,
  fixture_cases: cases.length,
  target: {
    name: "workflow_run_results.v1",
    shipped_module: "apps/api/src/workflow-results.ts",
    executes_shipped_code: true,
    uses_model_or_weights: false,
    product_code_changed: false
  },
  aggregates: {
    field_checks_total: cases.reduce((sum, c) => sum + c.field_checks, 0),
    field_mismatch_total: cases.reduce((sum, c) => sum + c.field_mismatches.length, 0),
    content_echo_violations: cases.reduce((sum, c) => sum + c.content_echo_hits, 0),
    files_seen_in_views: cases.reduce((sum, c) => sum + c.invariant_files_seen, 0),
    owner_accepted_false_everywhere: cases.every((c) => c.owner_accepted_false_everywhere),
    code_executed_false_everywhere: cases.every((c) => c.code_executed_false_everywhere),
    readback_label_everywhere: cases.every((c) => c.readback_label_everywhere),
    review_kind_everywhere: cases.every((c) => c.review_kind_everywhere),
    view_limit_text_everywhere: cases.every((c) => c.view_limit_text_everywhere),
    all_views_within_limit: cases.every((c) => c.within_view_limit),
    probes_only_graph_differs_everywhere: cases
      .filter((c) => c.probes_only_graph_differs !== null)
      .every((c) => c.probes_only_graph_differs === true),
    verdicts: verdictHistogram,
    graph_states: graphStateHistogram,
    human_review_cases: fixture.cases.filter((c) => c.ground_truth.human_review_required).length,
    empty_expectation_cases: fixture.cases.filter((c) => c.ground_truth.expected_empty).length,
    manual_expectations: manualExpectations,
    machine_expectations: machineExpectations,
    manual_share_of_non_empty_expectations: Number(
      (manualExpectations / (manualExpectations + machineExpectations)).toFixed(4)
    ),
    scoped_probes_ok: scopedProbesOk,
    limit_probe_ok: limitProbeOk
  },
  scoped_probes: scopedChecks,
  limit_probe: { probe: "view_results_limit", thrown: limitResult.thrown, ok: limitProbeOk },
  environment: {
    node: process.version,
    platform: process.platform,
    release: process.release?.name ?? null,
    arch: process.arch,
    rss_snapshot_mib: Math.round((process.memoryUsage().rss / 1048576) * 100) / 100,
    measured_at: "2026-11-09T12:00:00.000Z"
  },
  cases
};

if (output) {
  await writeFile(resolveArg(output), stablePretty(report) + "\n");
}
if (comparePath) {
  const previous = JSON.parse(await readFile(resolveArg(comparePath), "utf8"));
  const reproduced =
    stable(stripMachine(previous)) === stable(stripMachine(report)) &&
    previous.fixture_sha256 === report.fixture_sha256 &&
    previous.case_sha256 === report.case_sha256;
  console.log("REPRODUCED", reproduced ? "true" : "false");
  if (!reproduced) process.exitCode = 1;
}
console.log(stablePretty({ ...report, cases: undefined }));
