import type {
  IntelligenceGraphEdge,
  IntelligenceGraphNode,
  IntelligenceGraphVersionRef
} from "@cosmora/contracts";

export interface ModelIntelligenceObservation {
  observation_id: string;
  provider_id: string;
  model_id: string;
  registry_version: string;
  evaluated_at: string;
  valid_until: string;
  task_family: string;
  dataset_version: string;
  prompt_version: string;
  config_version: string;
  sample_size: number;
  metrics: {
    success_rate: number;
    quality_score: number | null;
    failure_rate: number;
  };
  latency_ms: {
    p50: number;
    p95: number;
  };
  usage: {
    input_tokens: number;
    output_tokens: number;
    cost_amount: number | null;
    currency: "USD" | "RUB" | null;
  };
  evidence_location: string;
}

export interface CompiledModelIntelligenceObservation {
  nodes: IntelligenceGraphNode[];
  edges: IntelligenceGraphEdge[];
}

const ID = /^\S{1,128}$/;
const TEXT = /^.{1,256}$/u;

const ensureId = (value: string, label: string): void => {
  if (!ID.test(value)) throw new Error(`Invalid model intelligence ${label}`);
};

const ensureText = (value: string, label: string): void => {
  if (!TEXT.test(value.trim())) throw new Error(`Invalid model intelligence ${label}`);
};

const ensureTime = (value: string, label: string): number => {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid model intelligence ${label}`);
  return parsed;
};

const ensureRate = (value: number, label: string): void => {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`Invalid model intelligence ${label}`);
  }
};

const ensureNonNegative = (value: number, label: string): void => {
  if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid model intelligence ${label}`);
};

const modelStableId = (input: ModelIntelligenceObservation): string =>
  `model:${input.provider_id}:${input.model_id}`;

export const validateModelIntelligenceObservation = (
  input: ModelIntelligenceObservation,
  now = Date.now()
): string[] => {
  const issues: string[] = [];

  for (const [value, label] of [
    [input.observation_id, "observation_id"],
    [input.provider_id, "provider_id"],
    [input.model_id, "model_id"],
    [input.registry_version, "registry_version"]
  ] as const) {
    try {
      ensureId(value, label);
    } catch (error) {
      issues.push(error instanceof Error ? error.message : String(error));
    }
  }

  for (const [value, label] of [
    [input.task_family, "task_family"],
    [input.dataset_version, "dataset_version"],
    [input.prompt_version, "prompt_version"],
    [input.config_version, "config_version"],
    [input.evidence_location, "evidence_location"]
  ] as const) {
    try {
      ensureText(value, label);
    } catch (error) {
      issues.push(error instanceof Error ? error.message : String(error));
    }
  }

  let evaluatedAt = Number.NaN;
  let validUntil = Number.NaN;
  try {
    evaluatedAt = ensureTime(input.evaluated_at, "evaluated_at");
    validUntil = ensureTime(input.valid_until, "valid_until");
    if (validUntil <= evaluatedAt) issues.push("Model intelligence valid_until must follow evaluated_at");
    if (validUntil <= now) issues.push("Model intelligence observation is expired");
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }

  if (!Number.isInteger(input.sample_size) || input.sample_size < 1 || input.sample_size > 1_000_000) {
    issues.push("Model intelligence sample_size must be an integer in 1..1000000");
  }

  for (const [value, label] of [
    [input.metrics.success_rate, "success_rate"],
    [input.metrics.failure_rate, "failure_rate"]
  ] as const) {
    try {
      ensureRate(value, label);
    } catch (error) {
      issues.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (Math.abs(input.metrics.success_rate + input.metrics.failure_rate - 1) > 1e-9) {
    issues.push("Model intelligence success_rate and failure_rate must sum to 1");
  }

  if (
    input.metrics.quality_score !== null &&
    (!Number.isFinite(input.metrics.quality_score) ||
      input.metrics.quality_score < 0 ||
      input.metrics.quality_score > 1)
  ) {
    issues.push("Model intelligence quality_score must be null or in 0..1");
  }

  for (const [value, label] of [
    [input.latency_ms.p50, "latency p50"],
    [input.latency_ms.p95, "latency p95"],
    [input.usage.input_tokens, "input_tokens"],
    [input.usage.output_tokens, "output_tokens"]
  ] as const) {
    try {
      ensureNonNegative(value, label);
    } catch (error) {
      issues.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (input.latency_ms.p95 < input.latency_ms.p50) {
    issues.push("Model intelligence latency p95 cannot be below p50");
  }

  if (!Number.isInteger(input.usage.input_tokens) || !Number.isInteger(input.usage.output_tokens)) {
    issues.push("Model intelligence token usage must use integer counts");
  }

  if (input.usage.cost_amount === null) {
    if (input.usage.currency !== null) {
      issues.push("Model intelligence unknown cost must not carry a currency");
    }
  } else {
    try {
      ensureNonNegative(input.usage.cost_amount, "cost_amount");
    } catch (error) {
      issues.push(error instanceof Error ? error.message : String(error));
    }
    if (input.usage.currency === null) {
      issues.push("Model intelligence known cost requires currency");
    }
  }

  return [...new Set(issues)];
};

export const compileModelIntelligenceObservation = (input: {
  ownerId: string;
  projectId: string;
  observation: ModelIntelligenceObservation;
  now?: number;
}): CompiledModelIntelligenceObservation => {
  const issues = validateModelIntelligenceObservation(input.observation, input.now ?? Date.now());
  if (issues.length > 0) {
    throw new Error(`Invalid model intelligence observation: ${issues.join("; ")}`);
  }

  const observation = input.observation;
  const modelId = modelStableId(observation);
  ensureId(input.ownerId, "ownerId");
  ensureId(input.projectId, "projectId");
  ensureId(modelId, "model stable id");

  const modelRef: IntelligenceGraphVersionRef = { id: modelId, version: 1 };
  const evaluationRef: IntelligenceGraphVersionRef = {
    id: `evaluation:${observation.observation_id}`,
    version: 1
  };
  const relationId = `edge:evaluates:${observation.observation_id}`;
  ensureId(evaluationRef.id, "evaluation stable id");
  ensureId(relationId, "evaluation edge id");

  const modelNode: IntelligenceGraphNode = {
    contract_version: 1,
    node_id: modelRef.id,
    node_version: modelRef.version,
    kind: "ModelVersion",
    owner_id: input.ownerId,
    project_id: input.projectId,
    scope: "project",
    created_at: observation.evaluated_at,
    observed_at: observation.evaluated_at,
    valid_from: observation.evaluated_at,
    valid_to: observation.valid_until,
    verification_status: "verified",
    sensitivity: "D1_PROJECT",
    source_ref: {
      source_id: `registry:${observation.registry_version}`,
      source_version: 1,
      location: observation.evidence_location
    },
    provenance_kind: "runtime_record",
    confidence_method: "deterministic_check",
    extractor_version: "model-intelligence-v1",
    supersedes: null,
    deleted_at: null
  };

  const evaluationNode: IntelligenceGraphNode = {
    contract_version: 1,
    node_id: evaluationRef.id,
    node_version: evaluationRef.version,
    kind: "Evaluation",
    owner_id: input.ownerId,
    project_id: input.projectId,
    scope: "project",
    created_at: observation.evaluated_at,
    observed_at: observation.evaluated_at,
    valid_from: observation.evaluated_at,
    valid_to: observation.valid_until,
    verification_status: "verified",
    sensitivity: "D1_PROJECT",
    source_ref: {
      source_id: `evaluation-source:${observation.observation_id}`,
      source_version: 1,
      location: observation.evidence_location
    },
    provenance_kind: "runtime_record",
    confidence_method: "deterministic_check",
    extractor_version: "model-intelligence-v1",
    supersedes: null,
    deleted_at: null
  };

  const relation: IntelligenceGraphEdge = {
    contract_version: 1,
    edge_id: relationId,
    edge_version: 1,
    type: "EVALUATES",
    from: evaluationRef,
    to: modelRef,
    owner_id: input.ownerId,
    project_id: input.projectId,
    scope: "project",
    created_at: observation.evaluated_at,
    observed_at: observation.evaluated_at,
    valid_from: observation.evaluated_at,
    valid_to: observation.valid_until,
    verification_status: "verified",
    sensitivity: "D1_PROJECT",
    evidence_ref: {
      source_id: `evaluation-source:${observation.observation_id}`,
      source_version: 1,
      location: observation.evidence_location
    },
    provenance_kind: "deterministic_derivation",
    confidence_method: "deterministic_check",
    extractor_version: "model-intelligence-v1",
    supersedes: null,
    deleted_at: null
  };

  return { nodes: [modelNode, evaluationNode], edges: [relation] };
};

export interface ModelIntelligenceRecommendation {
  provider_id: string;
  model_id: string;
  observation_id: string;
  task_family: string;
  sample_size: number;
  success_rate: number;
  quality_score: number | null;
  latency_p95_ms: number;
  total_tokens: number;
  cost_amount: number | null;
  currency: "USD" | "RUB" | null;
  evaluated_at: string;
  valid_until: string;
  authority: "recommend_only";
}

export const rankModelIntelligenceObservations = (input: {
  observations: readonly ModelIntelligenceObservation[];
  taskFamily: string;
  now?: number;
}): ModelIntelligenceRecommendation[] => {
  const now = input.now ?? Date.now();
  return input.observations
    .filter((observation) => observation.task_family === input.taskFamily)
    .filter((observation) => validateModelIntelligenceObservation(observation, now).length === 0)
    .map((observation) => ({
      provider_id: observation.provider_id,
      model_id: observation.model_id,
      observation_id: observation.observation_id,
      task_family: observation.task_family,
      sample_size: observation.sample_size,
      success_rate: observation.metrics.success_rate,
      quality_score: observation.metrics.quality_score,
      latency_p95_ms: observation.latency_ms.p95,
      total_tokens: observation.usage.input_tokens + observation.usage.output_tokens,
      cost_amount: observation.usage.cost_amount,
      currency: observation.usage.currency,
      evaluated_at: observation.evaluated_at,
      valid_until: observation.valid_until,
      authority: "recommend_only" as const
    }))
    .sort((left, right) => {
      const qualityLeft = left.quality_score ?? -1;
      const qualityRight = right.quality_score ?? -1;
      return (
        qualityRight - qualityLeft ||
        right.success_rate - left.success_rate ||
        left.latency_p95_ms - right.latency_p95_ms ||
        right.sample_size - left.sample_size ||
        `${left.provider_id}:${left.model_id}`.localeCompare(
          `${right.provider_id}:${right.model_id}`
        )
      );
    });
};
