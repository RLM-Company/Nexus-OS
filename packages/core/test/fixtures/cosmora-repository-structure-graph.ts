import type {
  AuthorizedIntelligenceGraphFixture,
  AuthorizedIntelligenceGraphFixtureEntry,
  AuthorizedIntelligenceGraphFixtureRelation
} from "../../src/index.js";
import { contractsSourceImportsA } from "./repository-structure-data/contracts-src-a.js";
import { contractsSourceImportsB } from "./repository-structure-data/contracts-src-b.js";
import { contractsTestImportsA } from "./repository-structure-data/contracts-test-a.js";
import { contractsTestImportsB } from "./repository-structure-data/contracts-test-b.js";
import { coreImports } from "./repository-structure-data/core.js";
import { modelGatewayImports } from "./repository-structure-data/model-gateway.js";
import { policyToolConfigImports } from "./repository-structure-data/policy-tool-config.js";
import { dbSourceImports } from "./repository-structure-data/db-src.js";
import { dbTestImports } from "./repository-structure-data/db-test.js";
import { apiSourceImports } from "./repository-structure-data/api-src.js";
import { apiTestImportsA } from "./repository-structure-data/api-test-a.js";
import { apiTestImportsB } from "./repository-structure-data/api-test-b.js";
import { webImportsA } from "./repository-structure-data/web-a.js";
import { webImportsB } from "./repository-structure-data/web-b.js";

const recordedAt = "2026-09-29T20:00:00.000Z";

const moduleRows = [
  ["module:apps/api", "apps/api", "@cosmora/api", "apps/api/package.json"],
  ["module:apps/web", "apps/web", "@cosmora/web", "apps/web/package.json"],
  ["module:packages/config", "packages/config", "@cosmora/config", "packages/config/package.json"],
  [
    "module:packages/contracts",
    "packages/contracts",
    "@cosmora/contracts",
    "packages/contracts/package.json"
  ],
  ["module:packages/core", "packages/core", "@cosmora/core", "packages/core/package.json"],
  ["module:packages/db", "packages/db", "@cosmora/db", "packages/db/package.json"],
  [
    "module:packages/model-gateway",
    "packages/model-gateway",
    "@cosmora/model-gateway",
    "packages/model-gateway/package.json"
  ],
  [
    "module:packages/policy-engine",
    "packages/policy-engine",
    "@cosmora/policy-engine",
    "packages/policy-engine/package.json"
  ],
  [
    "module:packages/tool-runtime",
    "packages/tool-runtime",
    "@cosmora/tool-runtime",
    "packages/tool-runtime/package.json"
  ]
] as const;

const fileRows = [
  ["apps/api/src/app.ts", "module:apps/api"],
  ["apps/api/src/demo-manager-coordinator.ts", "module:apps/api"],
  ["apps/api/src/general-chat-background-run-coordinator.ts", "module:apps/api"],
  ["apps/api/src/general-chat-routes.ts", "module:apps/api"],
  ["apps/api/src/general-chat-runtime-store.ts", "module:apps/api"],
  ["apps/api/src/identity.ts", "module:apps/api"],
  ["apps/api/src/manager-background-run-coordinator.ts", "module:apps/api"],
  ["apps/api/src/manager-runtime-project-store.ts", "module:apps/api"],
  ["apps/api/src/manager-work-coordinator.ts", "module:apps/api"],
  ["apps/api/src/manager-work-routes.ts", "module:apps/api"],
  ["apps/api/src/model-runtime.ts", "module:apps/api"],
  ["apps/api/src/operations.ts", "module:apps/api"],
  ["apps/api/src/server.ts", "module:apps/api"],
  ["apps/api/src/step-up-challenge.ts", "module:apps/api"],
  ["apps/api/test/agent-studio-read-api.test.ts", "module:apps/api"],
  ["apps/api/test/agent-studio-write-api.test.ts", "module:apps/api"],
  ["apps/api/test/b0-2-incident-drill.test.ts", "module:apps/api"],
  ["apps/api/test/demo-manager-api.test.ts", "module:apps/api"],
  ["apps/api/test/demo-manager-coordinator.test.ts", "module:apps/api"],
  ["apps/api/test/emergency-stop-clearance.test.ts", "module:apps/api"],
  ["apps/api/test/fixtures/e2e-server.ts", "module:apps/api"],
  ["apps/api/test/general-chat-api.test.ts", "module:apps/api"],
  ["apps/api/test/general-chat-background-run-coordinator.test.ts", "module:apps/api"],
  ["apps/api/test/health.test.ts", "module:apps/api"],
  ["apps/api/test/identity-boundary.test.ts", "module:apps/api"],
  ["apps/api/test/live-smoke-budget.test.ts", "module:apps/api"],
  ["apps/api/test/manager-background-run-coordinator.test.ts", "module:apps/api"],
  ["apps/api/test/manager-work.test.ts", "module:apps/api"],
  ["apps/api/test/model-runtime.test.ts", "module:apps/api"],
  ["apps/api/test/operations.test.ts", "module:apps/api"],
  ["apps/api/test/policy.test.ts", "module:apps/api"],
  ["apps/api/test/projects.test.ts", "module:apps/api"],
  ["apps/api/test/runtime-metrics-owner-scope.test.ts", "module:apps/api"],
  ["apps/api/test/step-up-challenge.test.ts", "module:apps/api"],
  ["apps/api/test/usage.test.ts", "module:apps/api"],
  ["apps/web/src/app/agent-studio/blueprint-controls.tsx", "module:apps/web"],
  ["apps/web/src/app/agent-studio/catalog-controls.tsx", "module:apps/web"],
  ["apps/web/src/app/agent-studio/page.tsx", "module:apps/web"],
  ["apps/web/src/app/agent-studio/proposal-controls.tsx", "module:apps/web"],
  ["apps/web/src/app/app-icon-art.tsx", "module:apps/web"],
  ["apps/web/src/app/apple-icon.tsx", "module:apps/web"],
  ["apps/web/src/app/chat-mode.ts", "module:apps/web"],
  ["apps/web/src/app/control-center/page.tsx", "module:apps/web"],
  ["apps/web/src/app/github/github-readonly.ts", "module:apps/web"],
  ["apps/web/src/app/github/page.tsx", "module:apps/web"],
  ["apps/web/src/app/icon.tsx", "module:apps/web"],
  ["apps/web/src/app/install-app.tsx", "module:apps/web"],
  ["apps/web/src/app/layout.tsx", "module:apps/web"],
  ["apps/web/src/app/manager-work-panel.tsx", "module:apps/web"],
  ["apps/web/src/app/manifest.ts", "module:apps/web"],
  ["apps/web/src/app/model-status/page.tsx", "module:apps/web"],
  ["apps/web/src/app/page.tsx", "module:apps/web"],
  ["apps/web/src/app/project-context-panel.tsx", "module:apps/web"],
  ["apps/web/src/app/safe-api-error.ts", "module:apps/web"],
  ["apps/web/src/app/skills/page.tsx", "module:apps/web"],
  ["apps/web/src/app/skills/skills-manifest.ts", "module:apps/web"],
  ["packages/config/src/index.ts", "module:packages/config"],
  ["packages/config/src/secrets.ts", "module:packages/config"],
  ["packages/config/test/config.test.ts", "module:packages/config"],
  ["packages/config/test/secrets.test.ts", "module:packages/config"],
  ["packages/contracts/src/agent-studio.ts", "module:packages/contracts"],
  ["packages/contracts/src/auth.ts", "module:packages/contracts"],
  ["packages/contracts/src/companion.ts", "module:packages/contracts"],
  ["packages/contracts/src/demo-manager.ts", "module:packages/contracts"],
  ["packages/contracts/src/domain.ts", "module:packages/contracts"],
  ["packages/contracts/src/errors.ts", "module:packages/contracts"],
  ["packages/contracts/src/events.ts", "module:packages/contracts"],
  ["packages/contracts/src/health.ts", "module:packages/contracts"],
  ["packages/contracts/src/identity.ts", "module:packages/contracts"],
  ["packages/contracts/src/index.ts", "module:packages/contracts"],
  ["packages/contracts/src/manager-runtime-artifact-provenance.ts", "module:packages/contracts"],
  ["packages/contracts/src/manager-runtime-artifact-task-binding.ts", "module:packages/contracts"],
  ["packages/contracts/src/manager-runtime-checkpoint.ts", "module:packages/contracts"],
  ["packages/contracts/src/manager-runtime-conflict.ts", "module:packages/contracts"],
  ["packages/contracts/src/manager-runtime-context-validation.ts", "module:packages/contracts"],
  ["packages/contracts/src/manager-runtime-critic-artifacts.ts", "module:packages/contracts"],
  ["packages/contracts/src/manager-runtime-gates.ts", "module:packages/contracts"],
  ["packages/contracts/src/manager-runtime-scenario-validation.ts", "module:packages/contracts"],
  ["packages/contracts/src/manager-runtime-scenarios.ts", "module:packages/contracts"],
  ["packages/contracts/src/manager-runtime-state.ts", "module:packages/contracts"],
  ["packages/contracts/src/manager-runtime-suite-gates.ts", "module:packages/contracts"],
  ["packages/contracts/src/manager-runtime-task-readiness.ts", "module:packages/contracts"],
  ["packages/contracts/src/manager-runtime.ts", "module:packages/contracts"],
  ["packages/contracts/src/manager-work.ts", "module:packages/contracts"],
  ["packages/contracts/src/model-registry.ts", "module:packages/contracts"],
  ["packages/contracts/src/model.ts", "module:packages/contracts"],
  ["packages/contracts/src/policy.ts", "module:packages/contracts"],
  ["packages/contracts/src/primitives.ts", "module:packages/contracts"],
  ["packages/contracts/src/runtime.ts", "module:packages/contracts"],
  ["packages/contracts/src/step-up.ts", "module:packages/contracts"],
  ["packages/contracts/src/usage.ts", "module:packages/contracts"],
  ["packages/contracts/test/agent-studio.test.ts", "module:packages/contracts"],
  ["packages/contracts/test/architecture-boundaries.test.ts", "module:packages/contracts"],
  ["packages/contracts/test/contracts.test.ts", "module:packages/contracts"],
  ["packages/contracts/test/identity.test.ts", "module:packages/contracts"],
  [
    "packages/contracts/test/manager-runtime-artifact-provenance.test.ts",
    "module:packages/contracts"
  ],
  [
    "packages/contracts/test/manager-runtime-artifact-task-binding.test.ts",
    "module:packages/contracts"
  ],
  ["packages/contracts/test/manager-runtime-checkpoint.test.ts", "module:packages/contracts"],
  ["packages/contracts/test/manager-runtime-conflict.test.ts", "module:packages/contracts"],
  [
    "packages/contracts/test/manager-runtime-context-validation.test.ts",
    "module:packages/contracts"
  ],
  ["packages/contracts/test/manager-runtime-critic-artifacts.test.ts", "module:packages/contracts"],
  ["packages/contracts/test/manager-runtime-gates.test.ts", "module:packages/contracts"],
  ["packages/contracts/test/manager-runtime-state.test.ts", "module:packages/contracts"],
  ["packages/contracts/test/manager-runtime-suite-gates.test.ts", "module:packages/contracts"],
  ["packages/contracts/test/manager-runtime-task-readiness.test.ts", "module:packages/contracts"],
  ["packages/contracts/test/manager-runtime.test.ts", "module:packages/contracts"],
  ["packages/contracts/test/model-registry.test.ts", "module:packages/contracts"],
  ["packages/contracts/test/policy.test.ts", "module:packages/contracts"],
  ["packages/contracts/test/runtime.test.ts", "module:packages/contracts"],
  ["packages/contracts/test/step-up.test.ts", "module:packages/contracts"],
  ["packages/contracts/test/usage.test.ts", "module:packages/contracts"],
  ["packages/core/src/chat.ts", "module:packages/core"],
  ["packages/core/src/demo-manager-plan.ts", "module:packages/core"],
  ["packages/core/src/index.ts", "module:packages/core"],
  ["packages/core/src/manager-runtime-scenario-runner.ts", "module:packages/core"],
  ["packages/core/src/manager-runtime-suite-runner.ts", "module:packages/core"],
  ["packages/core/src/manager-runtime-task-readiness.ts", "module:packages/core"],
  ["packages/core/src/manager.ts", "module:packages/core"],
  ["packages/core/src/model-service-options.ts", "module:packages/core"],
  ["packages/core/test/chat.test.ts", "module:packages/core"],
  ["packages/core/test/demo-manager-plan.test.ts", "module:packages/core"],
  ["packages/core/test/manager-runtime-scenario-runner.test.ts", "module:packages/core"],
  ["packages/core/test/manager-runtime-suite-runner.test.ts", "module:packages/core"],
  ["packages/core/test/manager-runtime-task-readiness.test.ts", "module:packages/core"],
  ["packages/core/test/manager.test.ts", "module:packages/core"],
  ["packages/db/src/agent-blueprint-store.ts", "module:packages/db"],
  ["packages/db/src/agent-instance-store.ts", "module:packages/db"],
  ["packages/db/src/agent-studio-mutation-store.ts", "module:packages/db"],
  ["packages/db/src/emergency-stop-store.ts", "module:packages/db"],
  ["packages/db/src/general-chat-store.ts", "module:packages/db"],
  ["packages/db/src/identity-store.ts", "module:packages/db"],
  ["packages/db/src/index.ts", "module:packages/db"],
  ["packages/db/src/manager-demo-store.ts", "module:packages/db"],
  ["packages/db/src/manager-work-store.ts", "module:packages/db"],
  ["packages/db/src/migrate.ts", "module:packages/db"],
  ["packages/db/src/pattern-library-store.ts", "module:packages/db"],
  ["packages/db/src/policy-store.ts", "module:packages/db"],
  ["packages/db/src/project-store.ts", "module:packages/db"],
  ["packages/db/src/schema.ts", "module:packages/db"],
  ["packages/db/src/step-up-proof-store.ts", "module:packages/db"],
  ["packages/db/src/usage-store.ts", "module:packages/db"],
  ["packages/db/test/agent-blueprint-store.test.ts", "module:packages/db"],
  ["packages/db/test/agent-instance-store.test.ts", "module:packages/db"],
  ["packages/db/test/agent-studio-mutation-store.test.ts", "module:packages/db"],
  ["packages/db/test/database.test.ts", "module:packages/db"],
  ["packages/db/test/general-chat-store.test.ts", "module:packages/db"],
  ["packages/db/test/identity-store.test.ts", "module:packages/db"],
  ["packages/db/test/manager-demo-store.test.ts", "module:packages/db"],
  ["packages/db/test/pattern-library-store.test.ts", "module:packages/db"],
  ["packages/db/test/policy-store.test.ts", "module:packages/db"],
  ["packages/db/test/step-up-proof-store.test.ts", "module:packages/db"],
  ["packages/db/test/usage-failure-holds.test.ts", "module:packages/db"],
  ["packages/db/test/usage-limits.test.ts", "module:packages/db"],
  ["packages/db/test/usage-store.test.ts", "module:packages/db"],
  ["packages/model-gateway/src/anthropic-compatible-adapter.ts", "module:packages/model-gateway"],
  ["packages/model-gateway/src/gateway.ts", "module:packages/model-gateway"],
  ["packages/model-gateway/src/index.ts", "module:packages/model-gateway"],
  ["packages/model-gateway/src/mock-adapter.ts", "module:packages/model-gateway"],
  ["packages/model-gateway/src/model-registry.ts", "module:packages/model-gateway"],
  ["packages/model-gateway/src/openai-compatible-adapter.ts", "module:packages/model-gateway"],
  ["packages/model-gateway/src/router.ts", "module:packages/model-gateway"],
  ["packages/model-gateway/src/types.ts", "module:packages/model-gateway"],
  [
    "packages/model-gateway/test/anthropic-compatible-adapter.test.ts",
    "module:packages/model-gateway"
  ],
  ["packages/model-gateway/test/gateway.test.ts", "module:packages/model-gateway"],
  ["packages/model-gateway/test/router.test.ts", "module:packages/model-gateway"],
  ["packages/model-gateway/test/stream-completion.test.ts", "module:packages/model-gateway"],
  ["packages/policy-engine/src/agent-delegation.ts", "module:packages/policy-engine"],
  ["packages/policy-engine/src/agent-instruction-plan.ts", "module:packages/policy-engine"],
  ["packages/policy-engine/src/index.ts", "module:packages/policy-engine"],
  ["packages/policy-engine/test/agent-delegation.test.ts", "module:packages/policy-engine"],
  ["packages/policy-engine/test/agent-instruction-plan.test.ts", "module:packages/policy-engine"],
  ["packages/policy-engine/test/policy-engine.test.ts", "module:packages/policy-engine"],
  ["packages/policy-engine/test/policy-profile-integrity.test.ts", "module:packages/policy-engine"],
  ["packages/tool-runtime/src/index.ts", "module:packages/tool-runtime"],
  ["packages/tool-runtime/test/policy-condition-authority.test.ts", "module:packages/tool-runtime"],
  ["packages/tool-runtime/test/tool-runtime.test.ts", "module:packages/tool-runtime"]
] as const;

const moduleDependencyRows = [
  [
    "module:apps/api",
    "module:packages/config",
    "apps/api/package.json:dependencies.@cosmora/config"
  ],
  [
    "module:apps/api",
    "module:packages/contracts",
    "apps/api/package.json:dependencies.@cosmora/contracts"
  ],
  ["module:apps/api", "module:packages/core", "apps/api/package.json:dependencies.@cosmora/core"],
  ["module:apps/api", "module:packages/db", "apps/api/package.json:dependencies.@cosmora/db"],
  [
    "module:apps/api",
    "module:packages/model-gateway",
    "apps/api/package.json:dependencies.@cosmora/model-gateway"
  ],
  [
    "module:apps/api",
    "module:packages/policy-engine",
    "apps/api/package.json:dependencies.@cosmora/policy-engine"
  ],
  [
    "module:apps/api",
    "module:packages/tool-runtime",
    "apps/api/package.json:dependencies.@cosmora/tool-runtime"
  ],
  [
    "module:packages/core",
    "module:packages/contracts",
    "packages/core/package.json:dependencies.@cosmora/contracts"
  ],
  [
    "module:packages/db",
    "module:packages/config",
    "packages/db/package.json:dependencies.@cosmora/config"
  ],
  [
    "module:packages/db",
    "module:packages/contracts",
    "packages/db/package.json:dependencies.@cosmora/contracts"
  ],
  [
    "module:packages/db",
    "module:packages/policy-engine",
    "packages/db/package.json:dependencies.@cosmora/policy-engine"
  ],
  [
    "module:packages/model-gateway",
    "module:packages/contracts",
    "packages/model-gateway/package.json:dependencies.@cosmora/contracts"
  ],
  [
    "module:packages/policy-engine",
    "module:packages/contracts",
    "packages/policy-engine/package.json:dependencies.@cosmora/contracts"
  ],
  [
    "module:packages/tool-runtime",
    "module:packages/contracts",
    "packages/tool-runtime/package.json:dependencies.@cosmora/contracts"
  ],
  [
    "module:packages/tool-runtime",
    "module:packages/db",
    "packages/tool-runtime/package.json:dependencies.@cosmora/db"
  ],
  [
    "module:packages/tool-runtime",
    "module:packages/policy-engine",
    "packages/tool-runtime/package.json:dependencies.@cosmora/policy-engine"
  ]
] as const;

const importRows = [
  ...contractsSourceImportsA,
  ...contractsSourceImportsB,
  ...contractsTestImportsA,
  ...contractsTestImportsB,
  ...coreImports,
  ...modelGatewayImports,
  ...policyToolConfigImports,
  ...dbSourceImports,
  ...dbTestImports,
  ...apiSourceImports,
  ...apiTestImportsA,
  ...apiTestImportsB,
  ...webImportsA,
  ...webImportsB
] as const;

const stableHash = (value: string): string => {
  let first = 2166136261 >>> 0;
  let second = 2246822519 >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619) >>> 0;
    second = Math.imul(second ^ code, 3266489917) >>> 0;
  }
  return `${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
};

export const repositoryStructureFileId = (path: string): string => `file:${stableHash(path)}`;
const edgeId = (value: string): string => `edge:${stableHash(value)}`;

const entry = (input: {
  id: string;
  kind: "Document" | "Entity";
  text: string;
  excerpt: string;
  location: string;
}): AuthorizedIntelligenceGraphFixtureEntry => ({
  ...input,
  created_at: recordedAt,
  verification_status: "verified",
  provenance_kind: "runtime_record",
  confidence_method: "deterministic_check",
  estimated_tokens: 8
});

const relation = (input: {
  type: string;
  from: string;
  to: string;
  location: string;
}): AuthorizedIntelligenceGraphFixtureRelation => ({
  id: edgeId(`${input.type}|${input.from}|${input.to}|${input.location}`),
  type: input.type,
  from: { id: input.from, version: 1 },
  to: { id: input.to, version: 1 },
  location: input.location,
  created_at: recordedAt,
  verification_status: "verified",
  provenance_kind: "deterministic_derivation",
  confidence_method: "deterministic_check"
});

export const cosmoraRepositoryStructureGraphFixture = (): AuthorizedIntelligenceGraphFixture => {
  const moduleIdsByName = new Map(moduleRows.map(([id, , name]) => [name, id]));
  const entries: AuthorizedIntelligenceGraphFixtureEntry[] = [
    ...moduleRows.map(([id, root, name, manifest]) =>
      entry({
        id,
        kind: "Entity",
        text: `${name} workspace module`,
        excerpt: `Workspace module rooted at ${root}.`,
        location: manifest
      })
    ),
    ...fileRows.map(([path, moduleId]) =>
      entry({
        id: repositoryStructureFileId(path),
        kind: "Document",
        text: `repository TypeScript file ${path}`,
        excerpt: `TypeScript source or test file belonging to ${moduleId}.`,
        location: path
      })
    )
  ];

  const relations: AuthorizedIntelligenceGraphFixtureRelation[] = [
    ...fileRows.map(([path, moduleId]) =>
      relation({
        type: "BELONGS_TO_MODULE",
        from: repositoryStructureFileId(path),
        to: moduleId,
        location: path
      })
    ),
    ...importRows.flatMap(([fromPath, kind, target, location]) => {
      const targetId =
        kind === "file" ? repositoryStructureFileId(target) : moduleIdsByName.get(target);
      if (targetId === undefined) return [];
      return [
        relation({
          type: kind === "file" ? "IMPORTS_FILE" : "IMPORTS_MODULE",
          from: fileId(fromPath),
          to: targetId,
          location
        })
      ];
    }),
    ...moduleDependencyRows.map(([from, to, location]) =>
      relation({ type: "DEPENDS_ON_MODULE", from, to, location })
    )
  ];

  return {
    owner_id: "owner-cosmora",
    project_id: "project-nexus-os",
    source: {
      id: "source-repository-structure-62bc523",
      version: 1,
      title: "Nexus-OS deterministic repository dependency graph at main 62bc523",
      excerpt:
        "File membership, source imports and workspace module dependencies derived directly from repository code and manifests.",
      location: "RLM-Company/Nexus-OS@62bc5234b24e3b0c10262b043063fd31be9732bd",
      created_at: recordedAt,
      estimated_tokens: 20
    },
    entries,
    relations
  };
};
