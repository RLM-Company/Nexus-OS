import type { IntelligenceGraphEdge, IntelligenceGraphNode } from "@cosmora/contracts";
import type { IntelligenceGraphSearchRecord } from "../../src/index.js";
import { repositoryStructureFileId } from "./cosmora-repository-structure-graph.js";

const ownerId = "owner-cosmora";
const projectId = "project-nexus-os";
const sourceId = "source-nexus-os-main-62bc523";
const recordedAt = "2026-10-05T14:15:16.000Z";
const validFrom = "2026-09-26T11:00:05.000Z";

const errorCodes = [
  "ROUTE_UNAVAILABLE",
  "PROVIDER_TIMEOUT",
  "PROVIDER_ERROR",
  "CIRCUIT_OPEN",
  "INTERRUPTED"
] as const;

const eventTypes = [
  "route.selected",
  "route.failed",
  "text.delta",
  "response.completed"
] as const;

const circuitStates = ["closed", "open", "probe"] as const;

const safeId = (value: string): string =>
  value.toLowerCase().replaceAll(".", "-").replaceAll("_", "-");

const node = (input: {
  id: string;
  location: string;
  kind?: IntelligenceGraphNode["kind"];
}): IntelligenceGraphNode => ({
  contract_version: 1,
  node_id: input.id,
  node_version: 1,
  kind: input.kind ?? "Entity",
  owner_id: ownerId,
  project_id: projectId,
  scope: "project",
  created_at: recordedAt,
  observed_at: recordedAt,
  valid_from: validFrom,
  valid_to: null,
  verification_status: "verified",
  sensitivity: "D1_PROJECT",
  source_ref: {
    source_id: sourceId,
    source_version: 1,
    location: input.location
  },
  provenance_kind: "document",
  confidence_method: "primary_source",
  extractor_version: "model-reliability-v1",
  supersedes: null,
  deleted_at: null
});

const errorNodes = errorCodes.map((code) =>
  node({
    id: `gateway-error-${safeId(code)}`,
    location: `packages/model-gateway/src/types.ts:GatewayErrorCode:${code}`
  })
);

const eventNodes = eventTypes.map((type) =>
  node({
    id: `gateway-event-${safeId(type)}`,
    location: `packages/model-gateway/src/types.ts:ModelGatewayStreamEvent:${type}`
  })
);

const circuitNodes = circuitStates.map((state) =>
  node({
    id: `gateway-circuit-${state}`,
    location: `packages/model-gateway/src/gateway.ts:CircuitState:${state}`
  })
);

const reliability = node({
  id: "entity-model-gateway-reliability",
  location: "packages/model-gateway/src/gateway.ts:ModelGateway"
});

const routeAttempt = node({
  id: "entity-model-route-attempt",
  location: "packages/model-gateway/src/types.ts:ModelRouteAttempt"
});

const claim = (id: string, location: string): IntelligenceGraphNode =>
  node({ id, kind: "Claim", location });

const claimNodes = [
  claim(
    "claim-gateway-retryable-before-fallback",
    "packages/model-gateway/src/gateway.ts:retryable route failure before fallback"
  ),
  claim(
    "claim-gateway-nonretryable-no-retry",
    "packages/model-gateway/src/gateway.ts:canRetry"
  ),
  claim(
    "claim-gateway-fallback-before-first-delta",
    "packages/model-gateway/src/gateway.ts:emittedText=false fallback boundary"
  ),
  claim(
    "claim-gateway-no-fallback-after-partial-output",
    "packages/model-gateway/src/gateway.ts:emittedText=true"
  ),
  claim(
    "claim-gateway-preabort-no-provider-dispatch",
    "packages/model-gateway/src/gateway.ts:externalSignal.aborted"
  ),
  claim(
    "claim-gateway-timeout-normalized",
    "packages/model-gateway/src/gateway.ts:PROVIDER_TIMEOUT"
  ),
  claim(
    "claim-gateway-circuit-opens-at-threshold",
    "packages/model-gateway/src/gateway.ts:#recordCircuitFailure"
  ),
  claim(
    "claim-gateway-single-probe-after-cooldown",
    "packages/model-gateway/src/gateway.ts:#acquireCircuit"
  ),
  claim(
    "claim-gateway-probe-release-on-early-stop",
    "packages/model-gateway/src/gateway.ts:#releaseCircuitProbe"
  ),
  claim(
    "claim-gateway-adapter-matches-registry-route",
    "packages/model-gateway/src/gateway.ts:#resolveAttempt"
  ),
  claim(
    "claim-gateway-completion-identity-matches-route",
    "packages/model-gateway/src/gateway.ts:completion identity check"
  ),
  claim(
    "claim-gateway-usage-valid-nonnegative-or-null",
    "packages/model-gateway/src/gateway.ts:isValidTokenCount"
  ),
  claim(
    "claim-gateway-unknown-usage-keeps-cost-unknown",
    "packages/model-gateway/src/gateway.ts:calculateCost"
  ),
  claim(
    "claim-gateway-completion-exactly-once",
    "packages/model-gateway/src/gateway.ts:completed guard"
  ),
  claim(
    "claim-gateway-stream-without-completion-fails-closed",
    "packages/model-gateway/src/gateway.ts:stream ended without completion"
  )
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
  valid_from: validFrom,
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
  extractor_version: "model-reliability-v1",
  supersedes: null,
  deleted_at: null
});

const gatewayFile = repositoryStructureFileId("packages/model-gateway/src/gateway.ts");
const typesFile = repositoryStructureFileId("packages/model-gateway/src/types.ts");
const gatewayTest = repositoryStructureFileId("packages/model-gateway/test/gateway.test.ts");
const streamTest = repositoryStructureFileId(
  "packages/model-gateway/test/stream-completion.test.ts"
);

const edges: IntelligenceGraphEdge[] = [
  ...errorNodes.flatMap((item) => [
    edge({
      id: `reliability-${item.node_id}-defined`,
      type: "DEFINED_IN_FILE",
      from: item.node_id,
      to: typesFile,
      location: item.source_ref.location
    }),
    edge({
      id: `reliability-${item.node_id}-error-of`,
      type: "ERROR_CODE_FOR",
      from: item.node_id,
      to: reliability.node_id,
      location: "packages/model-gateway/src/types.ts:GatewayRunError"
    })
  ]),
  ...eventNodes.flatMap((item) => [
    edge({
      id: `reliability-${item.node_id}-defined`,
      type: "DEFINED_IN_FILE",
      from: item.node_id,
      to: typesFile,
      location: item.source_ref.location
    }),
    edge({
      id: `reliability-${item.node_id}-emitted`,
      type: "EMITTED_BY",
      from: item.node_id,
      to: reliability.node_id,
      location: "packages/model-gateway/src/gateway.ts:stream"
    })
  ]),
  ...circuitNodes.flatMap((item) => [
    edge({
      id: `reliability-${item.node_id}-defined`,
      type: "DEFINED_IN_FILE",
      from: item.node_id,
      to: gatewayFile,
      location: item.source_ref.location
    }),
    edge({
      id: `reliability-${item.node_id}-state-of`,
      type: "STATE_OF",
      from: item.node_id,
      to: reliability.node_id,
      location: "packages/model-gateway/src/gateway.ts:CircuitState"
    })
  ]),

  edge({
    id: "reliability-entity-file",
    type: "IMPLEMENTED_IN_FILE",
    from: reliability.node_id,
    to: gatewayFile,
    location: "packages/model-gateway/src/gateway.ts:ModelGateway"
  }),
  edge({
    id: "reliability-entity-test",
    type: "VERIFIED_BY_TEST",
    from: reliability.node_id,
    to: gatewayTest,
    location: "packages/model-gateway/test/gateway.test.ts"
  }),
  edge({
    id: "reliability-route-attempt-defined",
    type: "DEFINED_IN_FILE",
    from: routeAttempt.node_id,
    to: typesFile,
    location: "packages/model-gateway/src/types.ts:ModelRouteAttempt"
  }),
  edge({
    id: "reliability-route-attempt-produced",
    type: "PRODUCED_BY",
    from: routeAttempt.node_id,
    to: reliability.node_id,
    location: "packages/model-gateway/src/gateway.ts:route.selected"
  }),

  ...[
    "config-key-model-max-attempts-per-route",
    "config-key-model-retry-base-delay-ms",
    "config-key-model-retry-max-delay-ms",
    "config-key-model-circuit-failure-threshold",
    "config-key-model-circuit-open-ms"
  ].map((key) =>
    edge({
      id: `reliability-${key}-configures`,
      type: "CONFIGURES",
      from: key,
      to: reliability.node_id,
      location: "apps/api/src/model-runtime.ts:ModelGateway reliability options"
    })
  ),

  edge({
    id: "reliability-circuit-closed-open",
    type: "FAILURE_THRESHOLD_OPENS_TO",
    from: "gateway-circuit-closed",
    to: "gateway-circuit-open",
    location: "packages/model-gateway/src/gateway.ts:#recordCircuitFailure"
  }),
  edge({
    id: "reliability-circuit-open-probe",
    type: "COOLDOWN_ALLOWS_PROBE_TO",
    from: "gateway-circuit-open",
    to: "gateway-circuit-probe",
    location: "packages/model-gateway/src/gateway.ts:#acquireCircuit"
  }),
  edge({
    id: "reliability-circuit-probe-closed",
    type: "SUCCESS_CLOSES_TO",
    from: "gateway-circuit-probe",
    to: "gateway-circuit-closed",
    location: "packages/model-gateway/src/gateway.ts:#recordCircuitSuccess"
  }),
  edge({
    id: "reliability-circuit-probe-open",
    type: "FAILURE_REOPENS_TO",
    from: "gateway-circuit-probe",
    to: "gateway-circuit-open",
    location: "packages/model-gateway/src/gateway.ts:#recordCircuitFailure"
  }),

  edge({
    id: "reliability-retryable-enforced",
    type: "ENFORCED_BY",
    from: "claim-gateway-retryable-before-fallback",
    to: reliability.node_id,
    location: "packages/model-gateway/src/gateway.ts:canRetry"
  }),
  edge({
    id: "reliability-retryable-test",
    type: "VERIFIED_BY_TEST",
    from: "claim-gateway-retryable-before-fallback",
    to: gatewayTest,
    location: "packages/model-gateway/test/gateway.test.ts:retries before fallback"
  }),
  edge({
    id: "reliability-retryable-fallback-boundary",
    type: "CONSISTENT_WITH",
    from: "claim-gateway-retryable-before-fallback",
    to: "decision-gateway-fallback-boundary",
    location: "packages/model-gateway/src/gateway.ts:provider loop"
  }),

  edge({
    id: "reliability-nonretryable-enforced",
    type: "ENFORCED_BY",
    from: "claim-gateway-nonretryable-no-retry",
    to: reliability.node_id,
    location: "packages/model-gateway/src/gateway.ts:normalized.retryable"
  }),
  edge({
    id: "reliability-nonretryable-test",
    type: "VERIFIED_BY_TEST",
    from: "claim-gateway-nonretryable-no-retry",
    to: gatewayTest,
    location: "packages/model-gateway/test/gateway.test.ts:does not retry non-retryable"
  }),

  edge({
    id: "reliability-fallback-before-delta-enforced",
    type: "ENFORCED_BY",
    from: "claim-gateway-fallback-before-first-delta",
    to: reliability.node_id,
    location: "packages/model-gateway/src/gateway.ts:emittedText"
  }),
  edge({
    id: "reliability-fallback-before-delta-test",
    type: "VERIFIED_BY_TEST",
    from: "claim-gateway-fallback-before-first-delta",
    to: gatewayTest,
    location: "packages/model-gateway/test/gateway.test.ts:fallback before first delta"
  }),
  edge({
    id: "reliability-fallback-before-delta-decision",
    type: "CONSISTENT_WITH",
    from: "claim-gateway-fallback-before-first-delta",
    to: "decision-gateway-fallback-boundary",
    location: "packages/model-gateway/src/gateway.ts:emittedText=false"
  }),

  edge({
    id: "reliability-no-fallback-partial-enforced",
    type: "ENFORCED_BY",
    from: "claim-gateway-no-fallback-after-partial-output",
    to: reliability.node_id,
    location: "packages/model-gateway/src/gateway.ts:if emittedText throw"
  }),
  edge({
    id: "reliability-no-fallback-partial-test",
    type: "VERIFIED_BY_TEST",
    from: "claim-gateway-no-fallback-after-partial-output",
    to: gatewayTest,
    location: "packages/model-gateway/test/gateway.test.ts:no fallback after partial output"
  }),
  edge({
    id: "reliability-no-fallback-partial-decision",
    type: "CONSISTENT_WITH",
    from: "claim-gateway-no-fallback-after-partial-output",
    to: "decision-gateway-fallback-boundary",
    location: "packages/model-gateway/src/gateway.ts:emittedText=true"
  }),

  edge({
    id: "reliability-preabort-enforced",
    type: "ENFORCED_BY",
    from: "claim-gateway-preabort-no-provider-dispatch",
    to: reliability.node_id,
    location: "packages/model-gateway/src/gateway.ts:externalSignal.aborted"
  }),
  edge({
    id: "reliability-preabort-test",
    type: "VERIFIED_BY_TEST",
    from: "claim-gateway-preabort-no-provider-dispatch",
    to: gatewayTest,
    location: "packages/model-gateway/test/gateway.test.ts:cancellation already happened"
  }),
  edge({
    id: "reliability-preabort-error",
    type: "NORMALIZES_TO",
    from: "claim-gateway-preabort-no-provider-dispatch",
    to: "gateway-error-interrupted",
    location: "packages/model-gateway/src/gateway.ts:INTERRUPTED"
  }),

  edge({
    id: "reliability-timeout-enforced",
    type: "ENFORCED_BY",
    from: "claim-gateway-timeout-normalized",
    to: reliability.node_id,
    location: "packages/model-gateway/src/gateway.ts:#streamWithTimeout"
  }),
  edge({
    id: "reliability-timeout-test",
    type: "VERIFIED_BY_TEST",
    from: "claim-gateway-timeout-normalized",
    to: gatewayTest,
    location: "packages/model-gateway/test/gateway.test.ts:provider timeouts"
  }),
  edge({
    id: "reliability-timeout-error",
    type: "NORMALIZES_TO",
    from: "claim-gateway-timeout-normalized",
    to: "gateway-error-provider-timeout",
    location: "packages/model-gateway/src/gateway.ts:PROVIDER_TIMEOUT"
  }),

  edge({
    id: "reliability-circuit-threshold-enforced",
    type: "ENFORCED_BY",
    from: "claim-gateway-circuit-opens-at-threshold",
    to: reliability.node_id,
    location: "packages/model-gateway/src/gateway.ts:#recordCircuitFailure"
  }),
  edge({
    id: "reliability-circuit-threshold-test",
    type: "VERIFIED_BY_TEST",
    from: "claim-gateway-circuit-opens-at-threshold",
    to: gatewayTest,
    location: "packages/model-gateway/test/gateway.test.ts:opens route circuit"
  }),
  edge({
    id: "reliability-circuit-threshold-state",
    type: "TRANSITIONS_TO",
    from: "claim-gateway-circuit-opens-at-threshold",
    to: "gateway-circuit-open",
    location: "packages/model-gateway/src/gateway.ts:circuitFailureThreshold"
  }),
  edge({
    id: "reliability-circuit-threshold-config",
    type: "CONSTRAINS",
    from: "claim-gateway-circuit-opens-at-threshold",
    to: "config-key-model-circuit-failure-threshold",
    location: "packages/config/src/index.ts:MODEL_CIRCUIT_FAILURE_THRESHOLD"
  }),

  edge({
    id: "reliability-probe-cooldown-enforced",
    type: "ENFORCED_BY",
    from: "claim-gateway-single-probe-after-cooldown",
    to: reliability.node_id,
    location: "packages/model-gateway/src/gateway.ts:#acquireCircuit"
  }),
  edge({
    id: "reliability-probe-cooldown-test",
    type: "VERIFIED_BY_TEST",
    from: "claim-gateway-single-probe-after-cooldown",
    to: gatewayTest,
    location: "packages/model-gateway/test/gateway.test.ts:one successful probe"
  }),
  edge({
    id: "reliability-probe-cooldown-state",
    type: "ALLOWS_PROBE_TO",
    from: "claim-gateway-single-probe-after-cooldown",
    to: "gateway-circuit-probe",
    location: "packages/model-gateway/src/gateway.ts:probeInFlight"
  }),
  edge({
    id: "reliability-probe-cooldown-config",
    type: "CONSTRAINS",
    from: "claim-gateway-single-probe-after-cooldown",
    to: "config-key-model-circuit-open-ms",
    location: "packages/config/src/index.ts:MODEL_CIRCUIT_OPEN_MS"
  }),

  edge({
    id: "reliability-probe-release-enforced",
    type: "ENFORCED_BY",
    from: "claim-gateway-probe-release-on-early-stop",
    to: reliability.node_id,
    location: "packages/model-gateway/src/gateway.ts:#releaseCircuitProbe"
  }),
  edge({
    id: "reliability-probe-release-test",
    type: "VERIFIED_BY_TEST",
    from: "claim-gateway-probe-release-on-early-stop",
    to: gatewayTest,
    location: "packages/model-gateway/test/gateway.test.ts:stream consumer stops early"
  }),

  edge({
    id: "reliability-adapter-match-enforced",
    type: "ENFORCED_BY",
    from: "claim-gateway-adapter-matches-registry-route",
    to: reliability.node_id,
    location: "packages/model-gateway/src/gateway.ts:#resolveAttempt"
  }),
  edge({
    id: "reliability-adapter-match-registry",
    type: "REQUIRES",
    from: "claim-gateway-adapter-matches-registry-route",
    to: "entity-model-registry",
    location: "packages/model-gateway/src/gateway.ts:modelRoute"
  }),
  edge({
    id: "reliability-adapter-match-test",
    type: "VERIFIED_BY_TEST",
    from: "claim-gateway-adapter-matches-registry-route",
    to: gatewayTest,
    location: "packages/model-gateway/test/gateway.test.ts:no adapter matches"
  }),

  edge({
    id: "reliability-completion-id-enforced",
    type: "ENFORCED_BY",
    from: "claim-gateway-completion-identity-matches-route",
    to: reliability.node_id,
    location: "packages/model-gateway/src/gateway.ts:provider/model identity"
  }),
  edge({
    id: "reliability-completion-id-test",
    type: "VERIFIED_BY_TEST",
    from: "claim-gateway-completion-identity-matches-route",
    to: gatewayTest,
    location: "packages/model-gateway/test/gateway.test.ts:completion identity differs"
  }),

  edge({
    id: "reliability-usage-valid-enforced",
    type: "ENFORCED_BY",
    from: "claim-gateway-usage-valid-nonnegative-or-null",
    to: reliability.node_id,
    location: "packages/model-gateway/src/gateway.ts:isValidTokenCount"
  }),
  edge({
    id: "reliability-usage-valid-test",
    type: "VERIFIED_BY_TEST",
    from: "claim-gateway-usage-valid-nonnegative-or-null",
    to: gatewayTest,
    location: "packages/model-gateway/test/gateway.test.ts:invalid provider token usage"
  }),
  edge({
    id: "reliability-usage-valid-event",
    type: "CONSTRAINS",
    from: "claim-gateway-usage-valid-nonnegative-or-null",
    to: "gateway-event-response-completed",
    location: "packages/model-gateway/src/gateway.ts:response.completed usage"
  }),

  edge({
    id: "reliability-unknown-cost-enforced",
    type: "ENFORCED_BY",
    from: "claim-gateway-unknown-usage-keeps-cost-unknown",
    to: reliability.node_id,
    location: "packages/model-gateway/src/gateway.ts:calculateCost"
  }),
  edge({
    id: "reliability-unknown-cost-test",
    type: "VERIFIED_BY_TEST",
    from: "claim-gateway-unknown-usage-keeps-cost-unknown",
    to: gatewayTest,
    location: "packages/model-gateway/test/gateway.test.ts:cost unknown"
  }),
  edge({
    id: "reliability-unknown-cost-budget",
    type: "CONSISTENT_WITH",
    from: "claim-gateway-unknown-usage-keeps-cost-unknown",
    to: "claim-usage-unknown-cost-preserved",
    location: "packages/model-gateway/src/gateway.ts:calculatedCost=null"
  }),

  edge({
    id: "reliability-completion-once-enforced",
    type: "ENFORCED_BY",
    from: "claim-gateway-completion-exactly-once",
    to: reliability.node_id,
    location: "packages/model-gateway/src/gateway.ts:completed guard"
  }),
  edge({
    id: "reliability-completion-once-gateway-test",
    type: "VERIFIED_BY_TEST",
    from: "claim-gateway-completion-exactly-once",
    to: gatewayTest,
    location: "packages/model-gateway/test/gateway.test.ts:events after completion"
  }),
  edge({
    id: "reliability-completion-once-stream-test",
    type: "VERIFIED_BY_TEST",
    from: "claim-gateway-completion-exactly-once",
    to: streamTest,
    location: "packages/model-gateway/test/stream-completion.test.ts:terminal marker"
  }),

  edge({
    id: "reliability-missing-completion-enforced",
    type: "ENFORCED_BY",
    from: "claim-gateway-stream-without-completion-fails-closed",
    to: reliability.node_id,
    location: "packages/model-gateway/src/gateway.ts:!completed"
  }),
  edge({
    id: "reliability-missing-completion-stream-test",
    type: "VERIFIED_BY_TEST",
    from: "claim-gateway-stream-without-completion-fails-closed",
    to: streamTest,
    location: "packages/model-gateway/test/stream-completion.test.ts:truncated stream"
  }),
  edge({
    id: "reliability-missing-completion-error",
    type: "NORMALIZES_TO",
    from: "claim-gateway-stream-without-completion-fails-closed",
    to: "gateway-error-provider-error",
    location: "packages/model-gateway/src/gateway.ts:PROVIDER_ERROR"
  })
];

const nodes = [
  ...errorNodes,
  ...eventNodes,
  ...circuitNodes,
  reliability,
  routeAttempt,
  ...claimNodes
];

const records: IntelligenceGraphSearchRecord[] = nodes.map((item) => ({
  node: { id: item.node_id, version: 1 },
  text: item.node_id.replaceAll("-", " "),
  excerpt: item.source_ref.location,
  estimated_tokens: 12
}));

export const cosmoraModelReliabilityGraph = () => ({ nodes, edges, records });

export const COSMORA_MODEL_RELIABILITY_NODE_COUNT = nodes.length;
export const COSMORA_MODEL_RELIABILITY_EDGE_COUNT = edges.length;
