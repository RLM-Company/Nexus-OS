import type { IntelligenceGraphEdge, IntelligenceGraphNode } from "@cosmora/contracts";
import type { IntelligenceGraphSearchRecord } from "../../src/index.js";
import { repositoryStructureFileId } from "./cosmora-repository-structure-graph.js";

const ownerId = "owner-cosmora";
const projectId = "project-nexus-os";
const sourceId = "source-nexus-os-main-62bc523";
const recordedAt = "2026-10-05T14:02:24.000Z";
const validFrom = "2026-09-26T11:00:05.000Z";

interface ConfigKeyRow {
  key: string;
  group: string;
}

const configKeys: readonly ConfigKeyRow[] = [
  { key: "NODE_ENV", group: "runtime" },
  { key: "API_HOST", group: "api" },
  { key: "API_PORT", group: "api" },
  { key: "WEB_ORIGIN", group: "api" },
  { key: "DATABASE_URL", group: "database" },
  { key: "MODEL_PROVIDER", group: "model_route" },
  { key: "MODEL_PROVIDER_ID", group: "model_route" },
  { key: "MODEL_REGISTRY_PATH", group: "model_route" },
  { key: "MODEL_BASE_URL", group: "model_route" },
  { key: "MODEL_API_KEY", group: "model_route" },
  { key: "MODEL_NAME", group: "model_route" },
  { key: "MODEL_FALLBACK_TO_MOCK", group: "model_route" },
  { key: "MODEL_MAX_ATTEMPTS_PER_ROUTE", group: "model_reliability" },
  { key: "MODEL_RETRY_BASE_DELAY_MS", group: "model_reliability" },
  { key: "MODEL_RETRY_MAX_DELAY_MS", group: "model_reliability" },
  { key: "MODEL_CIRCUIT_FAILURE_THRESHOLD", group: "model_reliability" },
  { key: "MODEL_CIRCUIT_OPEN_MS", group: "model_reliability" },
  { key: "RUNTIME_EMERGENCY_STOP", group: "runtime_safety" },
  { key: "MANAGER_TIMEOUT_MS", group: "manager_limits" },
  { key: "MANAGER_MAX_OUTPUT_TOKENS", group: "manager_limits" },
  { key: "LOG_LEVEL", group: "runtime" },
  { key: "MOCK_PROVIDER_MODE", group: "test_fixture" }
] as const;

const groupIds = [
  "runtime",
  "api",
  "database",
  "model_route",
  "model_reliability",
  "runtime_safety",
  "manager_limits",
  "test_fixture"
] as const;

const safeId = (value: string): string => value.toLowerCase().replaceAll("_", "-");

const node = (input: {
  id: string;
  kind?: IntelligenceGraphNode["kind"];
  location: string;
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
  extractor_version: "configuration-secret-boundary-v1",
  supersedes: null,
  deleted_at: null
});

const configKeyNodes = configKeys.map(({ key }) =>
  node({
    id: `config-key-${safeId(key)}`,
    location: `packages/config/src/index.ts:configKeys:${key}`
  })
);

const groupNodes = groupIds.map((group) =>
  node({
    id: `config-group-${safeId(group)}`,
    location: `packages/config/src/index.ts:configuration-group:${group}`
  })
);

const serverConfig = node({
  id: "entity-server-config",
  location: "packages/config/src/index.ts:ServerConfig"
});

const secretResolver = node({
  id: "entity-environment-secret-resolver",
  location: "packages/config/src/secrets.ts:EnvironmentSecretResolver"
});

const claim = (id: string, location: string): IntelligenceGraphNode =>
  node({ id, kind: "Claim", location });

const claimNodes = [
  claim(
    "claim-config-secret-values-not-persisted",
    "packages/config/test/config.test.ts:must-not-survive-config-loading"
  ),
  claim(
    "claim-config-secret-canonical-only",
    "packages/config/src/secrets.ts:EnvironmentSecretResolver.resolve"
  ),
  claim(
    "claim-config-external-provider-complete",
    "packages/config/src/index.ts:external provider required settings"
  ),
  claim(
    "claim-config-provider-identity-canonical",
    "packages/config/src/index.ts:hasCanonicalIdentifier"
  ),
  claim(
    "claim-config-provider-url-no-credentials",
    "packages/config/src/index.ts:providerBaseUrl username/password rejection"
  ),
  claim("claim-config-reliability-bounded", "packages/config/src/index.ts:boundedInteger"),
  claim(
    "claim-config-retry-order-valid",
    "packages/config/src/index.ts:modelRetryMaxDelayMs >= modelRetryBaseDelayMs"
  ),
  claim(
    "claim-config-manager-limits-bounded",
    "packages/config/src/index.ts:MANAGER_TIMEOUT_MS/MANAGER_MAX_OUTPUT_TOKENS"
  ),
  claim(
    "claim-config-emergency-stop-boolean",
    "packages/config/src/index.ts:RUNTIME_EMERGENCY_STOP"
  ),
  claim(
    "claim-config-runtime-route-active",
    "apps/api/src/model-runtime.ts:configured route active in Model Registry"
  ),
  claim(
    "claim-config-missing-secret-fail-closed",
    "apps/api/src/model-runtime.ts:external provider configuration incomplete"
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
  extractor_version: "configuration-secret-boundary-v1",
  supersedes: null,
  deleted_at: null
});

const configFile = repositoryStructureFileId("packages/config/src/index.ts");
const secretsFile = repositoryStructureFileId("packages/config/src/secrets.ts");
const configTest = repositoryStructureFileId("packages/config/test/config.test.ts");
const secretsTest = repositoryStructureFileId("packages/config/test/secrets.test.ts");
const modelRuntimeFile = repositoryStructureFileId("apps/api/src/model-runtime.ts");
const modelRuntimeTest = repositoryStructureFileId("apps/api/test/model-runtime.test.ts");

const keyEdges = configKeys.flatMap(({ key, group }) => {
  const id = `config-key-${safeId(key)}`;
  return [
    edge({
      id: `config-${safeId(key)}-belongs-server-config`,
      type: "CONFIG_KEY_OF",
      from: id,
      to: serverConfig.node_id,
      location: `packages/config/src/index.ts:configKeys:${key}`
    }),
    edge({
      id: `config-${safeId(key)}-group`,
      type: "GROUPED_UNDER",
      from: id,
      to: `config-group-${safeId(group)}`,
      location: `packages/config/src/index.ts:${key}`
    }),
    edge({
      id: `config-${safeId(key)}-defined`,
      type: "DEFINED_IN_FILE",
      from: id,
      to: configFile,
      location: `packages/config/src/index.ts:RawServerConfigSchema.${key}`
    })
  ];
});

const groupEdges = groupIds.map((group) =>
  edge({
    id: `config-group-${safeId(group)}-server-config`,
    type: "PART_OF",
    from: `config-group-${safeId(group)}`,
    to: serverConfig.node_id,
    location: `packages/config/src/index.ts:configuration-group:${group}`
  })
);

const edges: IntelligenceGraphEdge[] = [
  ...keyEdges,
  ...groupEdges,

  edge({
    id: "config-server-config-file",
    type: "IMPLEMENTED_IN_FILE",
    from: serverConfig.node_id,
    to: configFile,
    location: "packages/config/src/index.ts:loadServerConfig"
  }),
  edge({
    id: "config-server-config-test",
    type: "VERIFIED_BY_TEST",
    from: serverConfig.node_id,
    to: configTest,
    location: "packages/config/test/config.test.ts"
  }),
  edge({
    id: "config-secret-resolver-file",
    type: "IMPLEMENTED_IN_FILE",
    from: secretResolver.node_id,
    to: secretsFile,
    location: "packages/config/src/secrets.ts:EnvironmentSecretResolver"
  }),
  edge({
    id: "config-secret-resolver-test",
    type: "VERIFIED_BY_TEST",
    from: secretResolver.node_id,
    to: secretsTest,
    location: "packages/config/test/secrets.test.ts"
  }),

  edge({
    id: "config-secret-key-subject",
    type: "SUBJECT_TO",
    from: "config-key-model-api-key",
    to: "claim-config-secret-values-not-persisted",
    location: "packages/config/test/config.test.ts:must-not-survive-config-loading"
  }),
  edge({
    id: "config-secret-redaction-runtime",
    type: "RUNTIME_GUARDED_BY",
    from: "claim-config-secret-values-not-persisted",
    to: configFile,
    location: "packages/config/src/index.ts:modelApiKeyConfigured"
  }),
  edge({
    id: "config-secret-redaction-test",
    type: "VERIFIED_BY_TEST",
    from: "claim-config-secret-values-not-persisted",
    to: configTest,
    location: "packages/config/test/config.test.ts:must-not-survive-config-loading"
  }),

  edge({
    id: "config-secret-canonical-subject",
    type: "SUBJECT_TO",
    from: "config-key-model-api-key",
    to: "claim-config-secret-canonical-only",
    location: "packages/config/src/secrets.ts:EnvironmentSecretResolver.resolve"
  }),
  edge({
    id: "config-secret-canonical-runtime",
    type: "RUNTIME_GUARDED_BY",
    from: "claim-config-secret-canonical-only",
    to: secretsFile,
    location: "packages/config/src/secrets.ts:trim/canonical check"
  }),
  edge({
    id: "config-secret-canonical-test",
    type: "VERIFIED_BY_TEST",
    from: "claim-config-secret-canonical-only",
    to: secretsTest,
    location: "packages/config/test/secrets.test.ts:non-canonical whitespace"
  }),
  edge({
    id: "config-secret-resolves-key",
    type: "RESOLVES_SECRET_FOR",
    from: secretResolver.node_id,
    to: "config-key-model-api-key",
    location: "packages/config/src/secrets.ts:SecretName"
  }),

  ...["MODEL_PROVIDER", "MODEL_BASE_URL", "MODEL_API_KEY", "MODEL_NAME"].map((key) =>
    edge({
      id: `config-external-complete-${safeId(key)}`,
      type: "REQUIRES_CONFIG_KEY",
      from: "claim-config-external-provider-complete",
      to: `config-key-${safeId(key)}`,
      location: `packages/config/src/index.ts:external provider:${key}`
    })
  ),
  edge({
    id: "config-external-complete-runtime",
    type: "RUNTIME_GUARDED_BY",
    from: "claim-config-external-provider-complete",
    to: configFile,
    location: "packages/config/src/index.ts:modelProvider !== mock"
  }),
  edge({
    id: "config-external-complete-test",
    type: "VERIFIED_BY_TEST",
    from: "claim-config-external-provider-complete",
    to: configTest,
    location: "packages/config/test/config.test.ts:requires complete provider settings"
  }),

  edge({
    id: "config-provider-id-subject",
    type: "CONSTRAINS",
    from: "claim-config-provider-identity-canonical",
    to: "config-key-model-provider-id",
    location: "packages/config/src/index.ts:hasCanonicalIdentifier"
  }),
  edge({
    id: "config-provider-id-runtime",
    type: "RUNTIME_GUARDED_BY",
    from: "claim-config-provider-identity-canonical",
    to: configFile,
    location: "packages/config/src/index.ts:MODEL_PROVIDER_ID"
  }),
  edge({
    id: "config-provider-id-test",
    type: "VERIFIED_BY_TEST",
    from: "claim-config-provider-identity-canonical",
    to: configTest,
    location: "packages/config/test/config.test.ts:provider identity canonical"
  }),

  edge({
    id: "config-provider-url-subject",
    type: "CONSTRAINS",
    from: "claim-config-provider-url-no-credentials",
    to: "config-key-model-base-url",
    location: "packages/config/src/index.ts:providerBaseUrl"
  }),
  edge({
    id: "config-provider-url-runtime",
    type: "RUNTIME_GUARDED_BY",
    from: "claim-config-provider-url-no-credentials",
    to: configFile,
    location: "packages/config/src/index.ts:username/password rejection"
  }),
  edge({
    id: "config-provider-url-test",
    type: "VERIFIED_BY_TEST",
    from: "claim-config-provider-url-no-credentials",
    to: configTest,
    location: "packages/config/test/config.test.ts:rejects URL credentials"
  }),

  ...[
    "MODEL_MAX_ATTEMPTS_PER_ROUTE",
    "MODEL_RETRY_BASE_DELAY_MS",
    "MODEL_RETRY_MAX_DELAY_MS",
    "MODEL_CIRCUIT_FAILURE_THRESHOLD",
    "MODEL_CIRCUIT_OPEN_MS"
  ].map((key) =>
    edge({
      id: `config-reliability-bounds-${safeId(key)}`,
      type: "CONSTRAINS",
      from: "claim-config-reliability-bounded",
      to: `config-key-${safeId(key)}`,
      location: `packages/config/src/index.ts:boundedInteger:${key}`
    })
  ),
  edge({
    id: "config-reliability-runtime",
    type: "RUNTIME_GUARDED_BY",
    from: "claim-config-reliability-bounded",
    to: configFile,
    location: "packages/config/src/index.ts:boundedInteger"
  }),
  edge({
    id: "config-reliability-test",
    type: "VERIFIED_BY_TEST",
    from: "claim-config-reliability-bounded",
    to: configTest,
    location: "packages/config/test/config.test.ts:reliability settings"
  }),

  edge({
    id: "config-retry-order-base",
    type: "CONSTRAINS",
    from: "claim-config-retry-order-valid",
    to: "config-key-model-retry-base-delay-ms",
    location: "packages/config/src/index.ts:retry order"
  }),
  edge({
    id: "config-retry-order-max",
    type: "CONSTRAINS",
    from: "claim-config-retry-order-valid",
    to: "config-key-model-retry-max-delay-ms",
    location: "packages/config/src/index.ts:retry order"
  }),
  edge({
    id: "config-retry-order-runtime",
    type: "RUNTIME_GUARDED_BY",
    from: "claim-config-retry-order-valid",
    to: configFile,
    location: "packages/config/src/index.ts:modelRetryMaxDelayMs < modelRetryBaseDelayMs"
  }),
  edge({
    id: "config-retry-order-test",
    type: "VERIFIED_BY_TEST",
    from: "claim-config-retry-order-valid",
    to: configTest,
    location: "packages/config/test/config.test.ts:retry max below base"
  }),

  ...["MANAGER_TIMEOUT_MS", "MANAGER_MAX_OUTPUT_TOKENS"].map((key) =>
    edge({
      id: `config-manager-limit-${safeId(key)}`,
      type: "CONSTRAINS",
      from: "claim-config-manager-limits-bounded",
      to: `config-key-${safeId(key)}`,
      location: `packages/config/src/index.ts:${key}`
    })
  ),
  edge({
    id: "config-manager-limits-runtime",
    type: "RUNTIME_GUARDED_BY",
    from: "claim-config-manager-limits-bounded",
    to: configFile,
    location: "packages/config/src/index.ts:manager bounds"
  }),
  edge({
    id: "config-manager-limits-test",
    type: "VERIFIED_BY_TEST",
    from: "claim-config-manager-limits-bounded",
    to: configTest,
    location: "packages/config/test/config.test.ts:unsafe manager limits"
  }),
  edge({
    id: "config-manager-limits-work",
    type: "CONSTRAINS",
    from: "claim-config-manager-limits-bounded",
    to: "entity-manager-work",
    location: "apps/api/src/model-runtime.ts:ManagerService options"
  }),

  edge({
    id: "config-emergency-stop-key",
    type: "CONSTRAINS",
    from: "claim-config-emergency-stop-boolean",
    to: "config-key-runtime-emergency-stop",
    location: "packages/config/src/index.ts:RUNTIME_EMERGENCY_STOP"
  }),
  edge({
    id: "config-emergency-stop-runtime",
    type: "RUNTIME_GUARDED_BY",
    from: "claim-config-emergency-stop-boolean",
    to: configFile,
    location: "packages/config/src/index.ts:runtimeEmergencyStop"
  }),
  edge({
    id: "config-emergency-stop-test",
    type: "VERIFIED_BY_TEST",
    from: "claim-config-emergency-stop-boolean",
    to: configTest,
    location: "packages/config/test/config.test.ts:fail-closed process emergency switch"
  }),
  edge({
    id: "config-emergency-stop-manager-rule",
    type: "CONFIGURES",
    from: "config-key-runtime-emergency-stop",
    to: "claim-manager-emergency-stop",
    location: "packages/config/src/index.ts:runtimeEmergencyStop"
  }),

  ...["MODEL_PROVIDER", "MODEL_PROVIDER_ID", "MODEL_REGISTRY_PATH", "MODEL_NAME"].map((key) =>
    edge({
      id: `config-runtime-route-${safeId(key)}`,
      type: "REQUIRES_CONFIG_KEY",
      from: "claim-config-runtime-route-active",
      to: `config-key-${safeId(key)}`,
      location: `apps/api/src/model-runtime.ts:${key}`
    })
  ),
  edge({
    id: "config-runtime-route-registry",
    type: "REQUIRES",
    from: "claim-config-runtime-route-active",
    to: "entity-model-registry",
    location: "apps/api/src/model-runtime.ts:registry.get"
  }),
  edge({
    id: "config-runtime-route-file",
    type: "RUNTIME_GUARDED_BY",
    from: "claim-config-runtime-route-active",
    to: modelRuntimeFile,
    location: "apps/api/src/model-runtime.ts:registered.status/protocol"
  }),
  edge({
    id: "config-runtime-route-test",
    type: "VERIFIED_BY_TEST",
    from: "claim-config-runtime-route-active",
    to: modelRuntimeTest,
    location: "apps/api/test/model-runtime.test.ts:active registry route"
  }),

  edge({
    id: "config-missing-secret-key",
    type: "REQUIRES_CONFIG_KEY",
    from: "claim-config-missing-secret-fail-closed",
    to: "config-key-model-api-key",
    location: "apps/api/src/model-runtime.ts:MODEL_API_KEY"
  }),
  edge({
    id: "config-missing-secret-resolver",
    type: "DEPENDS_ON",
    from: "claim-config-missing-secret-fail-closed",
    to: secretResolver.node_id,
    location: "apps/api/src/model-runtime.ts:secretResolver"
  }),
  edge({
    id: "config-missing-secret-runtime",
    type: "RUNTIME_GUARDED_BY",
    from: "claim-config-missing-secret-fail-closed",
    to: modelRuntimeFile,
    location: "apps/api/src/model-runtime.ts:external provider configuration incomplete"
  }),
  edge({
    id: "config-missing-secret-test",
    type: "VERIFIED_BY_TEST",
    from: "claim-config-missing-secret-fail-closed",
    to: modelRuntimeTest,
    location: "apps/api/test/model-runtime.test.ts:secret resolver cannot provide credential"
  }),

  edge({
    id: "config-server-config-model-runtime",
    type: "CONFIGURES",
    from: serverConfig.node_id,
    to: "entity-model-gateway",
    location: "apps/api/src/model-runtime.ts:buildModelRuntime"
  })
];

const nodes = [...configKeyNodes, ...groupNodes, serverConfig, secretResolver, ...claimNodes];

const records: IntelligenceGraphSearchRecord[] = [
  ...configKeyNodes.map((item) => ({
    node: { id: item.node_id, version: 1 },
    text: item.node_id.replaceAll("-", " "),
    excerpt: item.source_ref.location,
    estimated_tokens: 10
  })),
  ...groupNodes.map((item) => ({
    node: { id: item.node_id, version: 1 },
    text: item.node_id.replaceAll("-", " "),
    excerpt: item.source_ref.location,
    estimated_tokens: 10
  })),
  {
    node: { id: serverConfig.node_id, version: 1 },
    text: "server configuration validated canonical bounded environment settings",
    excerpt:
      "ServerConfig is derived from validated environment keys without retaining raw secret values.",
    estimated_tokens: 18
  },
  {
    node: { id: secretResolver.node_id, version: 1 },
    text: "environment secret resolver model api key composition boundary canonical",
    excerpt:
      "MODEL_API_KEY is resolved only at the composition boundary and missing/non-canonical values fail closed.",
    estimated_tokens: 18
  },
  ...claimNodes.map((item) => ({
    node: { id: item.node_id, version: 1 },
    text: item.node_id.replaceAll("-", " "),
    excerpt: item.source_ref.location,
    estimated_tokens: 14
  }))
];

export const cosmoraConfigurationSecretBoundaryGraph = () => ({ nodes, edges, records });

export const COSMORA_CONFIGURATION_SECRET_BOUNDARY_NODE_COUNT = nodes.length;
export const COSMORA_CONFIGURATION_SECRET_BOUNDARY_EDGE_COUNT = edges.length;
