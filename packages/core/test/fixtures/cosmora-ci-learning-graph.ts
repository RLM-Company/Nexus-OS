import type { IntelligenceGraphEdge, IntelligenceGraphNode } from "@cosmora/contracts";
import type { IntelligenceGraphSearchRecord } from "../../src/index.js";

const ownerId = "owner-cosmora";
const projectId = "project-nexus-os";
const recordedAt = "2026-10-03T06:35:29.000Z";
const sourceId = "source-pr269-ci-learning";

const source: IntelligenceGraphNode = {
  contract_version: 1,
  node_id: sourceId,
  node_version: 1,
  kind: "Source",
  owner_id: ownerId,
  project_id: projectId,
  scope: "project",
  created_at: recordedAt,
  observed_at: recordedAt,
  valid_from: recordedAt,
  valid_to: null,
  verification_status: "verified",
  sensitivity: "D1_PROJECT",
  source_ref: {
    source_id: sourceId,
    source_version: 1,
    location: "github:pull/269/actions"
  },
  provenance_kind: "runtime_record",
  confidence_method: "deterministic_check",
  extractor_version: "pr-ci-learning-v1",
  supersedes: null,
  deleted_at: null
};

interface EvaluationInput {
  id: string;
  runNumber: number;
  runId: number;
  headSha: string;
  validFrom: string;
  conclusion: "failure" | "success";
  excerpt: string;
}

const evaluation = (input: EvaluationInput): IntelligenceGraphNode => ({
  contract_version: 1,
  node_id: input.id,
  node_version: 1,
  kind: "Evaluation",
  owner_id: ownerId,
  project_id: projectId,
  scope: "project",
  created_at: recordedAt,
  observed_at: recordedAt,
  valid_from: input.validFrom,
  valid_to: null,
  verification_status: "verified",
  sensitivity: "D1_PROJECT",
  source_ref: {
    source_id: sourceId,
    source_version: 1,
    location: `actions:run/${input.runId}:head=${input.headSha}:conclusion=${input.conclusion}`
  },
  provenance_kind: "runtime_record",
  confidence_method: "deterministic_check",
  extractor_version: "pr-ci-learning-v1",
  supersedes: null,
  deleted_at: null
});

const evaluations = [
  evaluation({
    id: "evaluation-ci-1001-format",
    runNumber: 1001,
    runId: 36923793518,
    headSha: "966e137dc0d5b8306244e5e0cab721673494effd",
    validFrom: "2026-10-01T20:44:32.000Z",
    conclusion: "failure",
    excerpt: "Quality gate stopped at repository Prettier formatting."
  }),
  evaluation({
    id: "evaluation-ci-1005-lint",
    runNumber: 1005,
    runId: 36924990530,
    headSha: "587c6a90c43e555b67ba3db26e8d53dffcabcbd0",
    validFrom: "2026-10-01T20:54:27.000Z",
    conclusion: "failure",
    excerpt:
      "Formatting and secret scan passed; lint found a type-only import and repository source-ID issue."
  }),
  evaluation({
    id: "evaluation-ci-1006-typecheck",
    runNumber: 1006,
    runId: 36925290555,
    headSha: "d852e3354f6b4e7f08c3f959723a0d91d1fe468b",
    validFrom: "2026-10-01T20:57:00.000Z",
    conclusion: "failure",
    excerpt:
      "Lint passed; TypeScript exactOptionalPropertyTypes rejected an undefined temporal query value."
  }),
  evaluation({
    id: "evaluation-ci-1007-temporal",
    runNumber: 1007,
    runId: 36925631730,
    headSha: "60a4792261f82ee5c6a6d50ff1dddfb3a6e6692f",
    validFrom: "2026-10-01T20:59:59.000Z",
    conclusion: "failure",
    excerpt:
      "Typecheck passed; graph tests exposed candidate records that confused source event time with graph record creation time."
  }),
  evaluation({
    id: "evaluation-ci-1011-structure",
    runNumber: 1011,
    runId: 37008952571,
    headSha: "e97f61213a7830ac6cde8cb4bf9aa7840ec5b898",
    validFrom: "2026-10-02T12:48:41.000Z",
    conclusion: "failure",
    excerpt:
      "Temporal validation passed; one repository-structure test referenced a nonexistent auth.test.ts fixture."
  }),
  evaluation({
    id: "evaluation-ci-1018-e2e",
    runNumber: 1018,
    runId: 37009660926,
    headSha: "7205e95c089337162ee55a3322be7ab0b172c617",
    validFrom: "2026-10-02T12:55:35.000Z",
    conclusion: "failure",
    excerpt:
      "Format, secrets, lint, typecheck, unit tests and build passed; one mobile Manager Playwright locator was ambiguous."
  }),
  evaluation({
    id: "evaluation-ci-1026-green",
    runNumber: 1026,
    runId: 37011228794,
    headSha: "48b2ee17ab53099f1487cb7e917a90171ffccac4",
    validFrom: "2026-10-02T13:10:19.000Z",
    conclusion: "success",
    excerpt: "The complete monorepo CI quality gate passed."
  })
] as const;

interface FeedbackInput {
  id: string;
  validFrom: string;
  location: string;
}

const feedback = (input: FeedbackInput): IntelligenceGraphNode => ({
  contract_version: 1,
  node_id: input.id,
  node_version: 1,
  kind: "Feedback",
  owner_id: ownerId,
  project_id: projectId,
  scope: "project",
  created_at: recordedAt,
  observed_at: recordedAt,
  valid_from: input.validFrom,
  valid_to: null,
  verification_status: "verified",
  sensitivity: "D1_PROJECT",
  source_ref: {
    source_id: sourceId,
    source_version: 1,
    location: input.location
  },
  provenance_kind: "deterministic_derivation",
  confidence_method: "deterministic_check",
  extractor_version: "pr-ci-learning-v1",
  supersedes: null,
  deleted_at: null
});

const feedbackNodes = [
  feedback({
    id: "feedback-ci-formatting",
    validFrom: "2026-10-01T20:46:01.000Z",
    location: "actions:run/36923793518:prettier-check"
  }),
  feedback({
    id: "feedback-ci-lint-source-ids",
    validFrom: "2026-10-01T20:56:21.000Z",
    location: "actions:run/36924990530:lint"
  }),
  feedback({
    id: "feedback-ci-temporal-query-type",
    validFrom: "2026-10-01T20:59:24.000Z",
    location: "actions:run/36925290555:typecheck"
  }),
  feedback({
    id: "feedback-ci-record-vs-source-time",
    validFrom: "2026-10-01T21:03:23.000Z",
    location: "actions:run/36925631730:core-tests"
  }),
  feedback({
    id: "feedback-ci-stale-auth-test",
    validFrom: "2026-10-02T12:53:59.000Z",
    location: "actions:run/37008952571:repository-structure-test"
  }),
  feedback({
    id: "feedback-ci-manager-demo-selector",
    validFrom: "2026-10-02T13:01:47.000Z",
    location: "actions:run/37009660926:playwright"
  })
] as const;

interface FixInput {
  id: string;
  validFrom: string;
  location: string;
}

const fix = (input: FixInput): IntelligenceGraphNode => ({
  contract_version: 1,
  node_id: input.id,
  node_version: 1,
  kind: "Event",
  owner_id: ownerId,
  project_id: projectId,
  scope: "project",
  created_at: recordedAt,
  observed_at: recordedAt,
  valid_from: input.validFrom,
  valid_to: null,
  verification_status: "verified",
  sensitivity: "D1_PROJECT",
  source_ref: {
    source_id: sourceId,
    source_version: 1,
    location: input.location
  },
  provenance_kind: "runtime_record",
  confidence_method: "deterministic_check",
  extractor_version: "pr-ci-learning-v1",
  supersedes: null,
  deleted_at: null
});

const fixNodes = [
  fix({
    id: "event-ci-fix-formatting",
    validFrom: "2026-10-01T20:54:02.000Z",
    location: "commit:b03af3d7da45f2643b9413f1eaeecdeade5296f2"
  }),
  fix({
    id: "event-ci-fix-lint",
    validFrom: "2026-10-01T20:56:55.000Z",
    location: "git-range:b03af3d7..d852e335"
  }),
  fix({
    id: "event-ci-fix-temporal-query",
    validFrom: "2026-10-01T20:59:53.000Z",
    location: "commit:60a4792261f82ee5c6a6d50ff1dddfb3a6e6692f"
  }),
  fix({
    id: "event-ci-fix-record-time",
    validFrom: "2026-10-02T12:48:35.000Z",
    location: "git-range:60a47922..e97f6121"
  }),
  fix({
    id: "event-ci-fix-structure-test",
    validFrom: "2026-10-02T12:55:29.000Z",
    location: "commit:7205e95c089337162ee55a3322be7ab0b172c617"
  }),
  fix({
    id: "event-ci-fix-manager-demo-selector",
    validFrom: "2026-10-02T13:10:13.000Z",
    location: "commit:48b2ee17ab53099f1487cb7e917a90171ffccac4"
  })
] as const;

const edge = (input: {
  id: string;
  type: string;
  from: string;
  to: string;
  location: string;
}): IntelligenceGraphEdge => ({
  contract_version: 1,
  edge_id: input.id,
  edge_version: 1,
  type: input.type,
  from: { id: input.from, version: 1 },
  to: { id: input.to, version: 1 },
  owner_id: ownerId,
  project_id: projectId,
  scope: "project",
  created_at: recordedAt,
  observed_at: recordedAt,
  valid_from: recordedAt,
  valid_to: null,
  verification_status: "verified",
  sensitivity: "D1_PROJECT",
  evidence_ref: {
    source_id: sourceId,
    source_version: 1,
    location: input.location
  },
  provenance_kind: "deterministic_derivation",
  confidence_method: "deterministic_check",
  extractor_version: "pr-ci-learning-v1",
  supersedes: null,
  deleted_at: null
});

const edges: IntelligenceGraphEdge[] = [];

for (const node of evaluations) {
  edges.push(
    edge({
      id: `ci-evaluates-${node.node_id}`,
      type: "EVALUATES_BRANCH",
      from: node.node_id,
      to: "proposal-pr-269-real-knowledge",
      location: node.source_ref.location
    })
  );
}

for (let index = 0; index < feedbackNodes.length; index += 1) {
  const currentEvaluation = evaluations[index]!;
  const nextEvaluation = evaluations[index + 1]!;
  const currentFeedback = feedbackNodes[index]!;
  const currentFix = fixNodes[index]!;

  edges.push(
    edge({
      id: `ci-found-${index + 1}`,
      type: "FOUND_ISSUE",
      from: currentEvaluation.node_id,
      to: currentFeedback.node_id,
      location: currentFeedback.source_ref.location
    }),
    edge({
      id: `ci-resolved-${index + 1}`,
      type: "RESOLVED_BY",
      from: currentFeedback.node_id,
      to: currentFix.node_id,
      location: currentFix.source_ref.location
    }),
    edge({
      id: `ci-validated-${index + 1}`,
      type: "VALIDATED_BY",
      from: currentFix.node_id,
      to: nextEvaluation.node_id,
      location: nextEvaluation.source_ref.location
    }),
    edge({
      id: `ci-precedes-${index + 1}`,
      type: "PRECEDES",
      from: currentEvaluation.node_id,
      to: nextEvaluation.node_id,
      location: `actions:runs/${currentEvaluation.node_id}->${nextEvaluation.node_id}`
    })
  );
}

edges.push(
  edge({
    id: "ci-green-confirms-pr269",
    type: "CONFIRMS_GREEN_GATE_FOR",
    from: "evaluation-ci-1026-green",
    to: "proposal-pr-269-real-knowledge",
    location: "actions:run/37011228794:conclusion=success"
  })
);

const nodes = [source, ...evaluations, ...feedbackNodes, ...fixNodes];

const records: IntelligenceGraphSearchRecord[] = nodes.map((node) => ({
  node: { id: node.node_id, version: 1 },
  text: node.node_id.replaceAll("-", " "),
  excerpt: node.source_ref.location,
  estimated_tokens: 12
}));

export const cosmoraCiLearningGraph = () => ({ nodes, edges, records });

export const COSMORA_CI_LEARNING_NODE_COUNT = nodes.length;
export const COSMORA_CI_LEARNING_EDGE_COUNT = edges.length;
