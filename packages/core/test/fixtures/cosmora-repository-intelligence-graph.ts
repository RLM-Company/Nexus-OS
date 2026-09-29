import type { AuthorizedIntelligenceGraphFixture } from "../../src/index.js";

const recordedAt = "2026-09-29T04:40:00.000Z";

export const cosmoraRepositoryIntelligenceGraphFixture =
  (): AuthorizedIntelligenceGraphFixture => ({
    owner_id: "owner-cosmora",
    project_id: "project-nexus-os",
    source: {
      id: "source-repository-snapshot",
      version: 1,
      title: "Cosmora repository evidence snapshot",
      excerpt:
        "Authorized non-secret facts from Nexus-OS main@62bc523 and reviewed architecture documents.",
      location: "RLM-Company/Nexus-OS@62bc5234b24e3b0c10262b043063fd31be9732bd",
      created_at: recordedAt,
      estimated_tokens: 28
    },
    entries: [
      {
        id: "project-cosmora-os",
        kind: "Project",
        text: "Cosmora OS owner controlled policy gated AI project workspace",
        excerpt: "Cosmora OS is an owner-controlled, policy-gated AI project workspace.",
        location: "README.md:1-4",
        created_at: recordedAt,
        observed_at: "2026-09-26T11:00:05.000Z",
        valid_from: "2026-09-26T11:00:05.000Z",
        verification_status: "verified",
        provenance_kind: "document",
        confidence_method: "primary_source",
        estimated_tokens: 18
      },
      {
        id: "goal-owner-control",
        kind: "Goal",
        text: "owner controlled safe bounded project work",
        excerpt: "Project behavior remains owner-controlled and policy-gated.",
        location: "README.md:1-4",
        created_at: recordedAt,
        observed_at: "2026-09-26T11:00:05.000Z",
        valid_from: "2026-09-26T11:00:05.000Z",
        verification_status: "verified",
        provenance_kind: "document",
        confidence_method: "primary_source",
        estimated_tokens: 14
      },
      {
        id: "decision-model-registry-authority",
        kind: "Decision",
        text: "model registry only source routing metadata router authority",
        excerpt:
          "The versioned Model Registry is the routing metadata authority; Router applies hard filters before scoring.",
        location: "docs/decisions/ADR-003-model-registry-routing.md:Decision",
        created_at: recordedAt,
        observed_at: "2026-08-24T00:00:00.000Z",
        valid_from: "2026-08-24T00:00:00.000Z",
        verification_status: "verified",
        provenance_kind: "document",
        confidence_method: "primary_source",
        estimated_tokens: 24
      },
      {
        id: "claim-router-hard-filters",
        kind: "Claim",
        text: "router hard filters active role task capability privacy context budget",
        excerpt:
          "Router hard-filters active status, role/task, capabilities, confidentiality, limits and budget before deterministic scoring.",
        location: "docs/decisions/ADR-003-model-registry-routing.md:Decision",
        created_at: recordedAt,
        observed_at: "2026-08-24T00:00:00.000Z",
        valid_from: "2026-08-24T00:00:00.000Z",
        verification_status: "verified",
        provenance_kind: "document",
        confidence_method: "primary_source",
        estimated_tokens: 24
      },
      {
        id: "claim-project-memory-isolated",
        kind: "Claim",
        text: "project memory isolated agents current project confidential chats excluded",
        excerpt:
          "Each project has separate memory; ordinary agents receive current-project memory and confidential chats are excluded from persistent learning.",
        location: "docs/constitution/drafts/memory-learning-constitution-v1.md:1,4,6",
        created_at: recordedAt,
        observed_at: "2026-08-24T00:00:00.000Z",
        valid_from: "2026-08-24T00:00:00.000Z",
        verification_status: "verified",
        provenance_kind: "document",
        confidence_method: "primary_source",
        estimated_tokens: 26
      },
      {
        id: "claim-project-context-preview",
        kind: "Claim",
        text: "project context browser local preview not authoritative runtime memory",
        excerpt:
          "The Project Context surface is browser-local preview state and must not be interpreted as authoritative runtime context.",
        location: "docs/contracts/project-context-web-contract-gap-2026-09-18.md:Current safe boundary",
        created_at: recordedAt,
        observed_at: "2026-09-18T00:00:00.000Z",
        valid_from: "2026-09-18T00:00:00.000Z",
        verification_status: "verified",
        provenance_kind: "document",
        confidence_method: "primary_source",
        estimated_tokens: 24
      },
      {
        id: "claim-readme-manager-no-runtime",
        kind: "Claim",
        text: "readme manager worker agents do not execute task graphs",
        excerpt:
          "README still states that Manager and worker agents do not execute task graphs as agents.",
        location: "README.md:Current boundary",
        created_at: recordedAt,
        observed_at: "2026-09-26T11:00:05.000Z",
        valid_from: "2026-09-26T11:00:05.000Z",
        verification_status: "disputed",
        provenance_kind: "document",
        confidence_method: "primary_source",
        estimated_tokens: 20
      },
      {
        id: "claim-main-durable-manager-runtime",
        kind: "Claim",
        text: "main durable manager work runtime connected coordinator routes",
        excerpt:
          "main@62bc523 adds a durable Manager work coordinator and Manager work routes.",
        location: "commit:62bc5234b24e3b0c10262b043063fd31be9732bd",
        created_at: recordedAt,
        observed_at: "2026-09-26T11:00:05.000Z",
        valid_from: "2026-09-26T11:00:05.000Z",
        verification_status: "verified",
        provenance_kind: "runtime_record",
        confidence_method: "deterministic_check",
        estimated_tokens: 22
      },
      {
        id: "decision-no-automatic-training",
        kind: "Decision",
        text: "project memory retrieval not automatic external model training fine tuning",
        excerpt:
          "Project memory must not be sent to external model training merely because model access is configured.",
        location: "docs/ideas/2026-08-23-model-training-from-project-memory.md:Hard boundary",
        created_at: recordedAt,
        observed_at: "2026-08-23T00:00:00.000Z",
        valid_from: "2026-08-23T00:00:00.000Z",
        verification_status: "verified",
        provenance_kind: "document",
        confidence_method: "primary_source",
        estimated_tokens: 22
      }
    ],
    relations: [
      {
        id: "edge-project-goal",
        type: "HAS_GOAL",
        from: { id: "project-cosmora-os", version: 1 },
        to: { id: "goal-owner-control", version: 1 },
        location: "README.md:1-4",
        created_at: recordedAt,
        verification_status: "verified",
        provenance_kind: "deterministic_derivation",
        confidence_method: "deterministic_check"
      },
      {
        id: "edge-goal-registry-decision",
        type: "CONSTRAINS",
        from: { id: "goal-owner-control", version: 1 },
        to: { id: "decision-model-registry-authority", version: 1 },
        location: "docs/decisions/ADR-003-model-registry-routing.md:Security and data rules",
        created_at: recordedAt,
        verification_status: "verified",
        provenance_kind: "deterministic_derivation",
        confidence_method: "deterministic_check"
      },
      {
        id: "edge-registry-router-filters",
        type: "SUPPORTED_BY",
        from: { id: "decision-model-registry-authority", version: 1 },
        to: { id: "claim-router-hard-filters", version: 1 },
        location: "docs/decisions/ADR-003-model-registry-routing.md:Decision",
        created_at: recordedAt,
        verification_status: "verified",
        provenance_kind: "deterministic_derivation",
        confidence_method: "deterministic_check"
      },
      {
        id: "edge-goal-memory-isolation",
        type: "CONSTRAINS",
        from: { id: "goal-owner-control", version: 1 },
        to: { id: "claim-project-memory-isolated", version: 1 },
        location: "docs/constitution/drafts/memory-learning-constitution-v1.md:Principles",
        created_at: recordedAt,
        verification_status: "verified",
        provenance_kind: "deterministic_derivation",
        confidence_method: "deterministic_check"
      },
      {
        id: "edge-memory-context-preview",
        type: "DISTINGUISHES",
        from: { id: "claim-project-memory-isolated", version: 1 },
        to: { id: "claim-project-context-preview", version: 1 },
        location: "docs/contracts/project-context-web-contract-gap-2026-09-18.md:Runtime handoff",
        created_at: recordedAt,
        verification_status: "verified",
        provenance_kind: "deterministic_derivation",
        confidence_method: "deterministic_check"
      },
      {
        id: "edge-manager-boundary-conflict",
        type: "CONTRADICTS",
        from: { id: "claim-main-durable-manager-runtime", version: 1 },
        to: { id: "claim-readme-manager-no-runtime", version: 1 },
        location: "main@62bc523 vs README.md:Current boundary",
        created_at: recordedAt,
        verification_status: "disputed",
        provenance_kind: "deterministic_derivation",
        confidence_method: "deterministic_check"
      },
      {
        id: "edge-memory-training-boundary",
        type: "CONSTRAINS",
        from: { id: "claim-project-memory-isolated", version: 1 },
        to: { id: "decision-no-automatic-training", version: 1 },
        location: "docs/ideas/2026-08-23-model-training-from-project-memory.md:Hard boundary",
        created_at: recordedAt,
        verification_status: "verified",
        provenance_kind: "deterministic_derivation",
        confidence_method: "deterministic_check"
      }
    ]
  });
