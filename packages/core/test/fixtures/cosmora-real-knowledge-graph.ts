import type { AuthorizedIntelligenceGraphFixture } from "../../src/index.js";

const recordedAt = "2026-09-29T20:20:00.000Z";

const verified = {
  verification_status: "verified" as const,
  provenance_kind: "document" as const,
  confidence_method: "primary_source" as const
};

const derived = {
  verification_status: "verified" as const,
  provenance_kind: "deterministic_derivation" as const,
  confidence_method: "deterministic_check" as const
};

export const cosmoraRealKnowledgeGraphFixture = (): AuthorizedIntelligenceGraphFixture => ({
  owner_id: "owner-cosmora",
  project_id: "project-nexus-os",
  source: {
    id: "source-nexus-os-main-62bc523",
    version: 1,
    title: "Nexus-OS architecture and runtime evidence at main 62bc523",
    excerpt:
      "Verified non-secret architecture decisions, contracts and current Manager runtime evidence from Nexus-OS.",
    location: "RLM-Company/Nexus-OS@62bc5234b24e3b0c10262b043063fd31be9732bd",
    created_at: recordedAt,
    estimated_tokens: 32
  },
  entries: [
    {
      id: "project-cosmora-os",
      kind: "Project",
      text: "Cosmora OS project owner controlled policy gated AI workspace",
      excerpt: "Cosmora OS is an owner-controlled, policy-gated AI project workspace.",
      location: "README.md",
      created_at: recordedAt,
      ...verified,
      estimated_tokens: 16
    },

    {
      id: "doc-adr-model-routing",
      kind: "Document",
      text: "ADR 003 versioned Model Registry deterministic routing",
      excerpt: "Accepted routing architecture for registry metadata, filtering and route evidence.",
      location: "docs/decisions/ADR-003-model-registry-routing.md",
      created_at: recordedAt,
      ...verified,
      estimated_tokens: 18
    },
    {
      id: "doc-adr-agent-studio",
      kind: "Document",
      text: "ADR 004 Agent Studio modular agent composition authority delegation",
      excerpt: "Owner-approved composition, instruction precedence and delegation boundaries.",
      location: "docs/decisions/ADR-004-agent-studio-and-modular-agent-composition.md",
      created_at: recordedAt,
      ...verified,
      estimated_tokens: 20
    },
    {
      id: "doc-manager-work-contract",
      kind: "Document",
      text: "Manager work contract plan draft review publish stages budgets",
      excerpt: "Contract for durable Manager work requests, plans, files, review and stage state.",
      location: "packages/contracts/src/manager-work.ts",
      created_at: recordedAt,
      ...verified,
      estimated_tokens: 18
    },
    {
      id: "doc-manager-runtime-contract",
      kind: "Document",
      text: "Manager runtime roles artifacts task graph critic conflict scenarios",
      excerpt: "Runtime contracts for roles, artifacts, tasks, critic verdicts and scenarios.",
      location: "packages/contracts/src/manager-runtime.ts",
      created_at: recordedAt,
      ...verified,
      estimated_tokens: 20
    },
    {
      id: "doc-runtime-provenance",
      kind: "Document",
      text: "runtime artifact provenance validator project cycle source ordering",
      excerpt: "Artifact provenance must be project-local, acyclic and temporally valid.",
      location: "packages/contracts/src/manager-runtime-artifact-provenance.ts",
      created_at: recordedAt,
      ...verified,
      estimated_tokens: 18
    },
    {
      id: "doc-runtime-checkpoint",
      kind: "Document",
      text: "runtime checkpoint validator task graph project completeness",
      excerpt: "Checkpoint must match its task graph, project and complete task-state set.",
      location: "packages/contracts/src/manager-runtime-checkpoint.ts",
      created_at: recordedAt,
      ...verified,
      estimated_tokens: 17
    },
    {
      id: "doc-runtime-conflict",
      kind: "Document",
      text: "runtime agent conflict lifecycle resolution artifact",
      excerpt: "Resolved conflicts require a resolution artifact and resolution timestamp.",
      location: "packages/contracts/src/manager-runtime-conflict.ts",
      created_at: recordedAt,
      ...verified,
      estimated_tokens: 17
    },
    {
      id: "doc-policy-contract",
      kind: "Document",
      text: "policy autonomy capability grants verdict confirmation step up",
      excerpt: "Policy contracts define autonomy levels, capabilities, permission modes and verdicts.",
      location: "packages/contracts/src/policy.ts",
      created_at: recordedAt,
      ...verified,
      estimated_tokens: 18
    },
    {
      id: "doc-auth-contract",
      kind: "Document",
      text: "auth Google Telegram PKCE S256 external identity session",
      excerpt: "Authentication contract supports Google and Telegram with state, nonce and PKCE S256.",
      location: "packages/contracts/src/auth.ts",
      created_at: recordedAt,
      ...verified,
      estimated_tokens: 17
    },
    {
      id: "doc-companion-contract",
      kind: "Document",
      text: "live companion proactive message preferences gates quiet hours",
      excerpt: "Companion proposals are gated by preferences, activity, authentication and safety.",
      location: "packages/contracts/src/companion.ts",
      created_at: recordedAt,
      ...verified,
      estimated_tokens: 19
    },
    {
      id: "doc-project-context-boundary",
      kind: "Document",
      text: "Project Context browser local preview backend contract gap",
      excerpt: "Browser-local Project Context is preview state and not authoritative runtime context.",
      location: "docs/contracts/project-context-web-contract-gap-2026-09-18.md",
      created_at: recordedAt,
      ...verified,
      estimated_tokens: 19
    },
    {
      id: "artifact-manager-work-runtime",
      kind: "Artifact",
      text: "durable Manager work coordinator routes main commit 62bc523",
      excerpt:
        "Current main connects durable Manager work coordinator and routes with guarded publication.",
      location: "commit:62bc5234b24e3b0c10262b043063fd31be9732bd",
      created_at: recordedAt,
      provenance_kind: "runtime_record",
      confidence_method: "deterministic_check",
      verification_status: "verified",
      estimated_tokens: 20
    },

    {
      id: "entity-model-registry",
      kind: "Entity",
      text: "Model Registry versioned routing metadata authority",
      excerpt: "Versioned, secret-free metadata authority for model routing.",
      location: "docs/decisions/ADR-003-model-registry-routing.md:Decision",
      created_at: recordedAt,
      ...verified,
      estimated_tokens: 12
    },
    {
      id: "entity-router",
      kind: "Entity",
      text: "Router hard filter deterministic model candidate selection",
      excerpt: "Routing component that filters invalid candidates before deterministic scoring.",
      location: "docs/decisions/ADR-003-model-registry-routing.md:Decision",
      created_at: recordedAt,
      ...verified,
      estimated_tokens: 13
    },
    {
      id: "entity-manager-work",
      kind: "Entity",
      text: "durable Manager work execution state machine",
      excerpt: "Durable work flow with plan, draft, optional review, publish and terminal state.",
      location: "packages/contracts/src/manager-work.ts",
      created_at: recordedAt,
      ...verified,
      estimated_tokens: 14
    },
    {
      id: "entity-policy-engine",
      kind: "Entity",
      text: "Policy Engine autonomy capability decision authority",
      excerpt: "Policy layer decides allow, limited allow, confirmation, deny or pause.",
      location: "packages/contracts/src/policy.ts",
      created_at: recordedAt,
      ...verified,
      estimated_tokens: 14
    },
    {
      id: "entity-runtime-artifact",
      kind: "Entity",
      text: "Manager runtime artifact evidence analysis decision handoff checkpoint",
      excerpt: "Project-bound runtime artifact with provenance, data class and data-only treatment.",
      location: "packages/contracts/src/manager-runtime.ts:RuntimeArtifactSchema",
      created_at: recordedAt,
      ...verified,
      estimated_tokens: 16
    },
    {
      id: "entity-runtime-task-graph",
      kind: "Entity",
      text: "Manager runtime task graph dependencies roles memory scope",
      excerpt: "Project-bound task graph with role assignment, dependencies and bounded task settings.",
      location: "packages/contracts/src/manager-runtime.ts:RuntimeTaskGraphSchema",
      created_at: recordedAt,
      ...verified,
      estimated_tokens: 15
    },
    {
      id: "entity-runtime-checkpoint",
      kind: "Entity",
      text: "Manager runtime checkpoint recovery task states",
      excerpt: "Checkpoint represents recovery state tied to one task graph.",
      location: "packages/contracts/src/manager-runtime-checkpoint.ts",
      created_at: recordedAt,
      ...verified,
      estimated_tokens: 13
    },
    {
      id: "entity-agent-conflict",
      kind: "Entity",
      text: "agent conflict positions resolution artifact uncertainty",
      excerpt: "Conflict record preserves multiple role positions and explicit resolution state.",
      location: "packages/contracts/src/manager-runtime.ts:AgentConflictSchema",
      created_at: recordedAt,
      ...verified,
      estimated_tokens: 14
    },
    {
      id: "entity-manager-role",
      kind: "AgentRole",
      text: "manager role delegates arbitrates conflict emits plan decision handoff checkpoint",
      excerpt: "Manager can delegate and arbitrate conflicts but has no external-action or permission authority.",
      location: "packages/contracts/src/manager-runtime.ts:MANAGER_RUNTIME_ROLE_CONTRACTS.manager",
      created_at: recordedAt,
      ...verified,
      estimated_tokens: 18
    },
    {
      id: "entity-critic-role",
      kind: "AgentRole",
      text: "critic role reviews architecture evidence analysis decision",
      excerpt: "Critic can review and emit critic verdicts but cannot delegate or arbitrate conflicts.",
      location: "packages/contracts/src/manager-runtime.ts:MANAGER_RUNTIME_ROLE_CONTRACTS.critic",
      created_at: recordedAt,
      ...verified,
      estimated_tokens: 17
    },
    {
      id: "entity-agent-instance",
      kind: "Entity",
      text: "Agent Studio project bound composed agent instance blueprint",
      excerpt: "Agent instance is assembled from independently versioned composition parts.",
      location: "docs/decisions/ADR-004-agent-studio-and-modular-agent-composition.md:Agent composition",
      created_at: recordedAt,
      ...verified,
      estimated_tokens: 16
    },
    {
      id: "entity-project-context-panel",
      kind: "Entity",
      text: "Project Context browser local preview panel",
      excerpt: "Browser-local preview for bounded source selection and mock token estimates.",
      location: "docs/contracts/project-context-web-contract-gap-2026-09-18.md:Current safe boundary",
      created_at: recordedAt,
      ...verified,
      estimated_tokens: 15
    },
    {
      id: "entity-auth-flow",
      kind: "Entity",
      text: "Google Telegram authentication flow external identity",
      excerpt: "Authentication flow establishes provider identity and session bootstrap.",
      location: "packages/contracts/src/auth.ts",
      created_at: recordedAt,
      ...verified,
      estimated_tokens: 14
    },
    {
      id: "entity-companion-gate",
      kind: "Entity",
      text: "Live Companion proactive message gate",
      excerpt: "Gate decides whether a proactive proposal is allowed or suppressed.",
      location: "packages/contracts/src/companion.ts:CompanionGateDecisionSchema",
      created_at: recordedAt,
      ...verified,
      estimated_tokens: 13
    },

    {
      id: "decision-registry-authority",
      kind: "Decision",
      text: "Model Registry only source of routing metadata secret free",
      excerpt: "Cosmora uses the versioned secret-free Model Registry as the only routing metadata source.",
      location: "docs/decisions/ADR-003-model-registry-routing.md:Decision",
      created_at: recordedAt,
      ...verified,
      estimated_tokens: 18
    },
    {
      id: "decision-hard-filter-before-score",
      kind: "Decision",
      text: "Router hard filters before deterministic scoring",
      excerpt: "Candidates must satisfy hard constraints before scoring or tie-breaking.",
      location: "docs/decisions/ADR-003-model-registry-routing.md:Decision",
      created_at: recordedAt,
      ...verified,
      estimated_tokens: 15
    },
    {
      id: "decision-routing-fail-closed",
      kind: "Decision",
      text: "routing fails closed when all candidates violate hard constraints",
      excerpt: "If hard filters remove all candidates, routing fails closed with a machine-readable reason.",
      location: "docs/decisions/ADR-003-model-registry-routing.md:Decision",
      created_at: recordedAt,
      ...verified,
      estimated_tokens: 17
    },
    {
      id: "decision-route-evidence-freshness",
      kind: "Decision",
      text: "active external model route requires evidence verification valid until",
      excerpt: "External active routes require evidence, verification time and explicit validity window.",
      location: "docs/decisions/ADR-003-model-registry-routing.md:Security and data rules",
      created_at: recordedAt,
      ...verified,
      estimated_tokens: 18
    },
    {
      id: "decision-route-trace",
      kind: "Decision",
      text: "runtime route records registry version provider model cost usage",
      excerpt: "Runtime integration records registry version, provider, model, estimated cost and final usage.",
      location: "docs/decisions/ADR-003-model-registry-routing.md:Security and data rules",
      created_at: recordedAt,
      ...verified,
      estimated_tokens: 18
    },

    {
      id: "decision-agent-six-parts",
      kind: "Decision",
      text: "agent composition function behavior model tools memory lifecycle budget",
      excerpt:
        "Active agents are composed from function, behavior, model profile, permission scope, memory scope and lifecycle/budget.",
      location: "docs/decisions/ADR-004-agent-studio-and-modular-agent-composition.md:Agent composition",
      created_at: recordedAt,
      ...verified,
      estimated_tokens: 21
    },
    {
      id: "decision-instruction-precedence",
      kind: "Decision",
      text: "agent instruction precedence constitution policy function behavior task",
      excerpt: "Instruction authority is constitution, policy, function constraints, behavior, then task.",
      location: "docs/decisions/ADR-004-agent-studio-and-modular-agent-composition.md:Instruction precedence",
      created_at: recordedAt,
      ...verified,
      estimated_tokens: 18
    },
    {
      id: "decision-delegation-no-expansion",
      kind: "Decision",
      text: "delegation never expands tools data budget permission authority",
      excerpt: "Creating or delegating an agent never expands the source mandate or grants extra authority.",
      location: "docs/decisions/ADR-004-agent-studio-and-modular-agent-composition.md:Authority by autonomy level",
      created_at: recordedAt,
      ...verified,
      estimated_tokens: 18
    },

    {
      id: "claim-manager-stage-machine",
      kind: "Claim",
      text: "Manager work stages plan draft review publish done",
      excerpt: "Durable Manager work advances through plan, draft, review, publish and done.",
      location: "packages/contracts/src/manager-work.ts:ManagerWorkStage",
      created_at: recordedAt,
      ...verified,
      estimated_tokens: 14
    },
    {
      id: "claim-manager-publish-workspace-write",
      kind: "Claim",
      text: "Manager publish files requires workspace write capability Policy Engine",
      excerpt: "The publish tool resolves the workspace.write capability and executes through guarded tool runtime.",
      location: "commit:62bc523:manager-work-coordinator.ts:manager.publish-files",
      created_at: recordedAt,
      provenance_kind: "runtime_record",
      confidence_method: "deterministic_check",
      verification_status: "verified",
      estimated_tokens: 18
    },
    {
      id: "claim-manager-no-fallback",
      kind: "Claim",
      text: "Manager work model request disables routing fallback",
      excerpt: "Manager work explicitly sets routing fallback_allowed to false.",
      location: "commit:62bc523:manager-work-coordinator.ts:request",
      created_at: recordedAt,
      provenance_kind: "runtime_record",
      confidence_method: "deterministic_check",
      verification_status: "verified",
      estimated_tokens: 14
    },
    {
      id: "claim-manager-reserves-budget",
      kind: "Claim",
      text: "Manager reserves model request tokens before gateway dispatch",
      excerpt: "Model request count and token budgets are reserved before gateway dispatch continues.",
      location: "commit:62bc523:manager-work-coordinator.ts:model",
      created_at: recordedAt,
      provenance_kind: "runtime_record",
      confidence_method: "deterministic_check",
      verification_status: "verified",
      estimated_tokens: 17
    },
    {
      id: "claim-manager-emergency-stop",
      kind: "Claim",
      text: "Manager work aborts on process or project Emergency Stop",
      excerpt: "Manager work checks process/project stop state and aborts active work when stopped.",
      location: "commit:62bc523:manager-work-coordinator.ts:isStopped",
      created_at: recordedAt,
      provenance_kind: "runtime_record",
      confidence_method: "deterministic_check",
      verification_status: "verified",
      estimated_tokens: 16
    },
    {
      id: "claim-manager-owner-control",
      kind: "Claim",
      text: "owner can pause resume approve cancel Manager work version checked",
      excerpt: "Owner control supports pause, resume, approve and cancel with stale-version rejection.",
      location: "commit:62bc523:manager-work-coordinator.ts:control",
      created_at: recordedAt,
      provenance_kind: "runtime_record",
      confidence_method: "deterministic_check",
      verification_status: "verified",
      estimated_tokens: 17
    },
    {
      id: "claim-manager-approval-autonomy",
      kind: "Claim",
      text: "Manager plan requires owner approval at A0 A1 and complex A2",
      excerpt: "A0/A1 plans and complex A2 plans enter awaiting_approval before drafting proceeds.",
      location: "commit:62bc523:manager-work-coordinator.ts:execute",
      created_at: recordedAt,
      provenance_kind: "runtime_record",
      confidence_method: "deterministic_check",
      verification_status: "verified",
      estimated_tokens: 17
    },

    {
      id: "claim-runtime-artifacts-data-only",
      kind: "Claim",
      text: "runtime artifact instruction treatment always data only",
      excerpt: "RuntimeArtifactSchema fixes instruction_treatment to data_only.",
      location: "packages/contracts/src/manager-runtime.ts:RuntimeArtifactSchema",
      created_at: recordedAt,
      ...verified,
      estimated_tokens: 13
    },
    {
      id: "claim-runtime-project-bound",
      kind: "Claim",
      text: "Manager runtime roles and task artifacts project bound no policy bypass",
      excerpt: "Runtime role contracts are project-bound and deny external-action, permission and policy-bypass authority.",
      location: "packages/contracts/src/manager-runtime.ts:MANAGER_RUNTIME_ROLE_CONTRACTS",
      created_at: recordedAt,
      ...verified,
      estimated_tokens: 19
    },
    {
      id: "claim-runtime-provenance-acyclic",
      kind: "Claim",
      text: "runtime artifact provenance same project no future source no cycles",
      excerpt: "Provenance rejects missing/cross-project/future source artifacts and provenance cycles.",
      location: "packages/contracts/src/manager-runtime-artifact-provenance.ts",
      created_at: recordedAt,
      ...verified,
      estimated_tokens: 18
    },
    {
      id: "claim-checkpoint-bound-graph",
      kind: "Claim",
      text: "runtime checkpoint must match project graph and all task states",
      excerpt: "Checkpoint validation enforces project, graph and complete task membership.",
      location: "packages/contracts/src/manager-runtime-checkpoint.ts",
      created_at: recordedAt,
      ...verified,
      estimated_tokens: 16
    },
    {
      id: "claim-conflict-needs-resolution-artifact",
      kind: "Claim",
      text: "resolved agent conflict requires resolution artifact and resolved timestamp",
      excerpt: "A resolved conflict must carry a resolution artifact and resolved_at.",
      location: "packages/contracts/src/manager-runtime-conflict.ts",
      created_at: recordedAt,
      ...verified,
      estimated_tokens: 16
    },
    {
      id: "claim-manager-role-authority",
      kind: "Claim",
      text: "manager role can delegate arbitrate conflict but cannot bypass policy",
      excerpt: "Manager can delegate and arbitrate conflicts while remaining project-bound with no policy bypass.",
      location: "packages/contracts/src/manager-runtime.ts:MANAGER_RUNTIME_ROLE_CONTRACTS.manager",
      created_at: recordedAt,
      ...verified,
      estimated_tokens: 17
    },
    {
      id: "claim-critic-role-authority",
      kind: "Claim",
      text: "critic role can review but cannot delegate arbitrate or bypass policy",
      excerpt: "Critic can review and emit verdicts but lacks delegation, arbitration and policy-bypass authority.",
      location: "packages/contracts/src/manager-runtime.ts:MANAGER_RUNTIME_ROLE_CONTRACTS.critic",
      created_at: recordedAt,
      ...verified,
      estimated_tokens: 17
    },

    {
      id: "claim-context-not-authoritative",
      kind: "Claim",
      text: "browser local Project Context selection is not authoritative runtime model context",
      excerpt: "Browser-local source selection must never be interpreted as authoritative model context.",
      location: "docs/contracts/project-context-web-contract-gap-2026-09-18.md:Current safe boundary",
      created_at: recordedAt,
      ...verified,
      estimated_tokens: 17
    },
    {
      id: "claim-context-secret-redaction",
      kind: "Claim",
      text: "Project Context redacts secret like title summary metadata before persistence",
      excerpt: "Secret-like title and summary metadata is redacted before normalized local state persists.",
      location: "docs/contracts/project-context-web-contract-gap-2026-09-18.md:Current safe boundary",
      created_at: recordedAt,
      ...verified,
      estimated_tokens: 17
    },
    {
      id: "claim-context-two-step-mutation",
      kind: "Claim",
      text: "future Project Context connection preview then explicit confirmation mutation",
      excerpt: "Future source connection should preview first and mutate authoritative state only after confirmation.",
      location: "docs/contracts/project-context-web-contract-gap-2026-09-18.md:Required preview contract",
      created_at: recordedAt,
      ...verified,
      estimated_tokens: 18
    },

    {
      id: "claim-auth-google-telegram",
      kind: "Claim",
      text: "authentication providers Google Telegram",
      excerpt: "AuthProviderSchema permits google and telegram.",
      location: "packages/contracts/src/auth.ts:AuthProviderSchema",
      created_at: recordedAt,
      ...verified,
      estimated_tokens: 11
    },
    {
      id: "claim-auth-pkce-s256",
      kind: "Claim",
      text: "authentication start requires state nonce PKCE S256 challenge",
      excerpt: "Auth start carries state, nonce, code challenge and fixed S256 challenge method.",
      location: "packages/contracts/src/auth.ts:AuthStartRequestSchema",
      created_at: recordedAt,
      ...verified,
      estimated_tokens: 15
    },
    {
      id: "claim-auth-session-expiry",
      kind: "Claim",
      text: "authentication session bootstrap has issued and expiry timestamps",
      excerpt: "Session bootstrap is provider-bound and includes issued_at and expires_at.",
      location: "packages/contracts/src/auth.ts:AuthSessionBootstrapSchema",
      created_at: recordedAt,
      ...verified,
      estimated_tokens: 14
    },

    {
      id: "claim-companion-preference-bounds",
      kind: "Claim",
      text: "Companion preferences daily cap minimum gap quiet hours push telegram controls",
      excerpt: "Preferences bound proactive frequency, daily cap, gap, quiet hours and surfaces.",
      location: "packages/contracts/src/companion.ts:CompanionPreferencesSchema",
      created_at: recordedAt,
      ...verified,
      estimated_tokens: 17
    },
    {
      id: "claim-companion-gate-reasons",
      kind: "Claim",
      text: "Companion gate suppresses global mute unauthenticated quiet hours cap safety active conversation",
      excerpt:
        "Gate reasons include mute, authentication, scope, quiet hours, caps, cooldown, active conversation and safety.",
      location: "packages/contracts/src/companion.ts:CompanionGateReasonSchema",
      created_at: recordedAt,
      ...verified,
      estimated_tokens: 19
    },
    {
      id: "claim-companion-surfaces",
      kind: "Claim",
      text: "Companion proactive message surfaces in app push telegram",
      excerpt: "CompanionSurfaceSchema permits in_app, push and telegram.",
      location: "packages/contracts/src/companion.ts:CompanionSurfaceSchema",
      created_at: recordedAt,
      ...verified,
      estimated_tokens: 12
    },

    {
      id: "claim-policy-verdict-modes",
      kind: "Claim",
      text: "Policy verdict deny confirmation scoped allow derived from permission modes",
      excerpt: "DENY dominates, then CONFIRM, then SCOPED; otherwise evaluation allows.",
      location: "packages/contracts/src/policy.ts:verdictForModes",
      created_at: recordedAt,
      ...verified,
      estimated_tokens: 16
    },
    {
      id: "claim-policy-capability-profile-project",
      kind: "Claim",
      text: "capability profile project bound versioned autonomy grants",
      excerpt: "CapabilityProfile carries project, base autonomy level, grants, overrides and version.",
      location: "packages/contracts/src/policy.ts:CapabilityProfileSchema",
      created_at: recordedAt,
      ...verified,
      estimated_tokens: 15
    }
  ],
  relations: [
    { id: "r-project-adr-routing", type: "HAS_DOCUMENT", from: { id: "project-cosmora-os", version: 1 }, to: { id: "doc-adr-model-routing", version: 1 }, location: "repository", created_at: recordedAt, ...derived },
    { id: "r-project-adr-agent", type: "HAS_DOCUMENT", from: { id: "project-cosmora-os", version: 1 }, to: { id: "doc-adr-agent-studio", version: 1 }, location: "repository", created_at: recordedAt, ...derived },
    { id: "r-project-manager-work", type: "HAS_DOCUMENT", from: { id: "project-cosmora-os", version: 1 }, to: { id: "doc-manager-work-contract", version: 1 }, location: "repository", created_at: recordedAt, ...derived },
    { id: "r-project-runtime", type: "HAS_DOCUMENT", from: { id: "project-cosmora-os", version: 1 }, to: { id: "doc-manager-runtime-contract", version: 1 }, location: "repository", created_at: recordedAt, ...derived },
    { id: "r-project-policy", type: "HAS_DOCUMENT", from: { id: "project-cosmora-os", version: 1 }, to: { id: "doc-policy-contract", version: 1 }, location: "repository", created_at: recordedAt, ...derived },
    { id: "r-project-context", type: "HAS_DOCUMENT", from: { id: "project-cosmora-os", version: 1 }, to: { id: "doc-project-context-boundary", version: 1 }, location: "repository", created_at: recordedAt, ...derived },

    { id: "r-adr-registry", type: "DECLARES", from: { id: "doc-adr-model-routing", version: 1 }, to: { id: "decision-registry-authority", version: 1 }, location: "ADR-003:Decision", created_at: recordedAt, ...derived },
    { id: "r-adr-hardfilter", type: "DECLARES", from: { id: "doc-adr-model-routing", version: 1 }, to: { id: "decision-hard-filter-before-score", version: 1 }, location: "ADR-003:Decision", created_at: recordedAt, ...derived },
    { id: "r-adr-failclosed", type: "DECLARES", from: { id: "doc-adr-model-routing", version: 1 }, to: { id: "decision-routing-fail-closed", version: 1 }, location: "ADR-003:Decision", created_at: recordedAt, ...derived },
    { id: "r-adr-freshness", type: "DECLARES", from: { id: "doc-adr-model-routing", version: 1 }, to: { id: "decision-route-evidence-freshness", version: 1 }, location: "ADR-003:Security", created_at: recordedAt, ...derived },
    { id: "r-adr-trace", type: "DECLARES", from: { id: "doc-adr-model-routing", version: 1 }, to: { id: "decision-route-trace", version: 1 }, location: "ADR-003:Security", created_at: recordedAt, ...derived },
    { id: "r-registry-authority", type: "GOVERNS", from: { id: "decision-registry-authority", version: 1 }, to: { id: "entity-model-registry", version: 1 }, location: "ADR-003:Decision", created_at: recordedAt, ...derived },
    { id: "r-registry-router", type: "SUPPLIES_METADATA_TO", from: { id: "entity-model-registry", version: 1 }, to: { id: "entity-router", version: 1 }, location: "ADR-003:Decision", created_at: recordedAt, ...derived },
    { id: "r-hardfilter-router", type: "CONSTRAINS", from: { id: "decision-hard-filter-before-score", version: 1 }, to: { id: "entity-router", version: 1 }, location: "ADR-003:Decision", created_at: recordedAt, ...derived },
    { id: "r-failclosed-router", type: "CONSTRAINS", from: { id: "decision-routing-fail-closed", version: 1 }, to: { id: "entity-router", version: 1 }, location: "ADR-003:Decision", created_at: recordedAt, ...derived },
    { id: "r-freshness-registry", type: "CONSTRAINS", from: { id: "decision-route-evidence-freshness", version: 1 }, to: { id: "entity-model-registry", version: 1 }, location: "ADR-003:Security", created_at: recordedAt, ...derived },
    { id: "r-trace-router", type: "REQUIRES_TRACE_FOR", from: { id: "decision-route-trace", version: 1 }, to: { id: "entity-router", version: 1 }, location: "ADR-003:Security", created_at: recordedAt, ...derived },

    { id: "r-agent-six-parts", type: "DECLARES", from: { id: "doc-adr-agent-studio", version: 1 }, to: { id: "decision-agent-six-parts", version: 1 }, location: "ADR-004:Agent composition", created_at: recordedAt, ...derived },
    { id: "r-agent-precedence", type: "DECLARES", from: { id: "doc-adr-agent-studio", version: 1 }, to: { id: "decision-instruction-precedence", version: 1 }, location: "ADR-004:Instruction precedence", created_at: recordedAt, ...derived },
    { id: "r-agent-delegation", type: "DECLARES", from: { id: "doc-adr-agent-studio", version: 1 }, to: { id: "decision-delegation-no-expansion", version: 1 }, location: "ADR-004:Authority", created_at: recordedAt, ...derived },
    { id: "r-sixparts-instance", type: "DEFINES", from: { id: "decision-agent-six-parts", version: 1 }, to: { id: "entity-agent-instance", version: 1 }, location: "ADR-004:Agent composition", created_at: recordedAt, ...derived },
    { id: "r-precedence-instance", type: "CONSTRAINS", from: { id: "decision-instruction-precedence", version: 1 }, to: { id: "entity-agent-instance", version: 1 }, location: "ADR-004:Instruction precedence", created_at: recordedAt, ...derived },
    { id: "r-delegation-instance", type: "CONSTRAINS", from: { id: "decision-delegation-no-expansion", version: 1 }, to: { id: "entity-agent-instance", version: 1 }, location: "ADR-004:Authority", created_at: recordedAt, ...derived },

    { id: "r-work-doc-stage", type: "DECLARES", from: { id: "doc-manager-work-contract", version: 1 }, to: { id: "claim-manager-stage-machine", version: 1 }, location: "manager-work.ts", created_at: recordedAt, ...derived },
    { id: "r-stage-work", type: "DESCRIBES", from: { id: "claim-manager-stage-machine", version: 1 }, to: { id: "entity-manager-work", version: 1 }, location: "manager-work.ts", created_at: recordedAt, ...derived },
    { id: "r-runtime-implements-work", type: "IMPLEMENTS", from: { id: "artifact-manager-work-runtime", version: 1 }, to: { id: "entity-manager-work", version: 1 }, location: "commit:62bc523", created_at: recordedAt, ...derived },
    { id: "r-publish-runtime", type: "CONSTRAINS", from: { id: "claim-manager-publish-workspace-write", version: 1 }, to: { id: "artifact-manager-work-runtime", version: 1 }, location: "manager-work-coordinator.ts", created_at: recordedAt, ...derived },
    { id: "r-publish-policy", type: "REQUIRES", from: { id: "claim-manager-publish-workspace-write", version: 1 }, to: { id: "entity-policy-engine", version: 1 }, location: "manager-work-coordinator.ts", created_at: recordedAt, ...derived },
    { id: "r-nofallback-runtime", type: "CONSTRAINS", from: { id: "claim-manager-no-fallback", version: 1 }, to: { id: "artifact-manager-work-runtime", version: 1 }, location: "manager-work-coordinator.ts", created_at: recordedAt, ...derived },
    { id: "r-budget-runtime", type: "CONSTRAINS", from: { id: "claim-manager-reserves-budget", version: 1 }, to: { id: "artifact-manager-work-runtime", version: 1 }, location: "manager-work-coordinator.ts", created_at: recordedAt, ...derived },
    { id: "r-stop-runtime", type: "CONSTRAINS", from: { id: "claim-manager-emergency-stop", version: 1 }, to: { id: "artifact-manager-work-runtime", version: 1 }, location: "manager-work-coordinator.ts", created_at: recordedAt, ...derived },
    { id: "r-owner-runtime", type: "CONTROLS", from: { id: "claim-manager-owner-control", version: 1 }, to: { id: "artifact-manager-work-runtime", version: 1 }, location: "manager-work-coordinator.ts", created_at: recordedAt, ...derived },
    { id: "r-approval-runtime", type: "GATES", from: { id: "claim-manager-approval-autonomy", version: 1 }, to: { id: "artifact-manager-work-runtime", version: 1 }, location: "manager-work-coordinator.ts", created_at: recordedAt, ...derived },

    { id: "r-runtime-doc-artifact", type: "DECLARES", from: { id: "doc-manager-runtime-contract", version: 1 }, to: { id: "claim-runtime-artifacts-data-only", version: 1 }, location: "manager-runtime.ts", created_at: recordedAt, ...derived },
    { id: "r-runtime-doc-bound", type: "DECLARES", from: { id: "doc-manager-runtime-contract", version: 1 }, to: { id: "claim-runtime-project-bound", version: 1 }, location: "manager-runtime.ts", created_at: recordedAt, ...derived },
    { id: "r-runtime-doc-manager-role", type: "DECLARES", from: { id: "doc-manager-runtime-contract", version: 1 }, to: { id: "claim-manager-role-authority", version: 1 }, location: "manager-runtime.ts", created_at: recordedAt, ...derived },
    { id: "r-runtime-doc-critic-role", type: "DECLARES", from: { id: "doc-manager-runtime-contract", version: 1 }, to: { id: "claim-critic-role-authority", version: 1 }, location: "manager-runtime.ts", created_at: recordedAt, ...derived },
    { id: "r-dataonly-artifact", type: "CONSTRAINS", from: { id: "claim-runtime-artifacts-data-only", version: 1 }, to: { id: "entity-runtime-artifact", version: 1 }, location: "RuntimeArtifactSchema", created_at: recordedAt, ...derived },
    { id: "r-bound-taskgraph", type: "CONSTRAINS", from: { id: "claim-runtime-project-bound", version: 1 }, to: { id: "entity-runtime-task-graph", version: 1 }, location: "MANAGER_RUNTIME_ROLE_CONTRACTS", created_at: recordedAt, ...derived },
    { id: "r-manager-role", type: "DESCRIBES", from: { id: "claim-manager-role-authority", version: 1 }, to: { id: "entity-manager-role", version: 1 }, location: "manager role contract", created_at: recordedAt, ...derived },
    { id: "r-critic-role", type: "DESCRIBES", from: { id: "claim-critic-role-authority", version: 1 }, to: { id: "entity-critic-role", version: 1 }, location: "critic role contract", created_at: recordedAt, ...derived },
    { id: "r-manager-coordinates", type: "COORDINATES", from: { id: "entity-manager-role", version: 1 }, to: { id: "entity-runtime-task-graph", version: 1 }, location: "manager runtime role contract", created_at: recordedAt, ...derived },
    { id: "r-critic-reviews", type: "REVIEWS", from: { id: "entity-critic-role", version: 1 }, to: { id: "entity-runtime-artifact", version: 1 }, location: "critic accepts artifact kinds", created_at: recordedAt, ...derived },

    { id: "r-prov-doc-claim", type: "DECLARES", from: { id: "doc-runtime-provenance", version: 1 }, to: { id: "claim-runtime-provenance-acyclic", version: 1 }, location: "artifact provenance validator", created_at: recordedAt, ...derived },
    { id: "r-prov-artifact", type: "CONSTRAINS", from: { id: "claim-runtime-provenance-acyclic", version: 1 }, to: { id: "entity-runtime-artifact", version: 1 }, location: "artifact provenance validator", created_at: recordedAt, ...derived },
    { id: "r-check-doc-claim", type: "DECLARES", from: { id: "doc-runtime-checkpoint", version: 1 }, to: { id: "claim-checkpoint-bound-graph", version: 1 }, location: "checkpoint validator", created_at: recordedAt, ...derived },
    { id: "r-check-entity", type: "CONSTRAINS", from: { id: "claim-checkpoint-bound-graph", version: 1 }, to: { id: "entity-runtime-checkpoint", version: 1 }, location: "checkpoint validator", created_at: recordedAt, ...derived },
    { id: "r-check-graph", type: "BOUND_TO", from: { id: "entity-runtime-checkpoint", version: 1 }, to: { id: "entity-runtime-task-graph", version: 1 }, location: "checkpoint.graph_id", created_at: recordedAt, ...derived },
    { id: "r-conflict-doc-claim", type: "DECLARES", from: { id: "doc-runtime-conflict", version: 1 }, to: { id: "claim-conflict-needs-resolution-artifact", version: 1 }, location: "conflict validator", created_at: recordedAt, ...derived },
    { id: "r-conflict-entity", type: "CONSTRAINS", from: { id: "claim-conflict-needs-resolution-artifact", version: 1 }, to: { id: "entity-agent-conflict", version: 1 }, location: "conflict validator", created_at: recordedAt, ...derived },
    { id: "r-manager-arbitrates", type: "ARBITRATES", from: { id: "entity-manager-role", version: 1 }, to: { id: "entity-agent-conflict", version: 1 }, location: "manager role contract", created_at: recordedAt, ...derived },

    { id: "r-policy-doc-verdict", type: "DECLARES", from: { id: "doc-policy-contract", version: 1 }, to: { id: "claim-policy-verdict-modes", version: 1 }, location: "policy.ts:verdictForModes", created_at: recordedAt, ...derived },
    { id: "r-policy-doc-profile", type: "DECLARES", from: { id: "doc-policy-contract", version: 1 }, to: { id: "claim-policy-capability-profile-project", version: 1 }, location: "policy.ts:CapabilityProfileSchema", created_at: recordedAt, ...derived },
    { id: "r-policy-verdict-engine", type: "DESCRIBES", from: { id: "claim-policy-verdict-modes", version: 1 }, to: { id: "entity-policy-engine", version: 1 }, location: "policy.ts", created_at: recordedAt, ...derived },
    { id: "r-profile-engine", type: "CONSTRAINS", from: { id: "claim-policy-capability-profile-project", version: 1 }, to: { id: "entity-policy-engine", version: 1 }, location: "policy.ts", created_at: recordedAt, ...derived },
    { id: "r-delegation-policy", type: "ENFORCED_BY", from: { id: "decision-delegation-no-expansion", version: 1 }, to: { id: "entity-policy-engine", version: 1 }, location: "ADR-004 delegation validator boundary", created_at: recordedAt, ...derived },

    { id: "r-context-doc-auth", type: "DECLARES", from: { id: "doc-project-context-boundary", version: 1 }, to: { id: "claim-context-not-authoritative", version: 1 }, location: "Project Context safe boundary", created_at: recordedAt, ...derived },
    { id: "r-context-doc-secret", type: "DECLARES", from: { id: "doc-project-context-boundary", version: 1 }, to: { id: "claim-context-secret-redaction", version: 1 }, location: "Project Context safe boundary", created_at: recordedAt, ...derived },
    { id: "r-context-doc-preview", type: "DECLARES", from: { id: "doc-project-context-boundary", version: 1 }, to: { id: "claim-context-two-step-mutation", version: 1 }, location: "Project Context preview contract", created_at: recordedAt, ...derived },
    { id: "r-context-notauth-panel", type: "CONSTRAINS", from: { id: "claim-context-not-authoritative", version: 1 }, to: { id: "entity-project-context-panel", version: 1 }, location: "Project Context safe boundary", created_at: recordedAt, ...derived },
    { id: "r-context-secret-panel", type: "CONSTRAINS", from: { id: "claim-context-secret-redaction", version: 1 }, to: { id: "entity-project-context-panel", version: 1 }, location: "Project Context safe boundary", created_at: recordedAt, ...derived },
    { id: "r-context-preview-panel", type: "GATES_MUTATION_OF", from: { id: "claim-context-two-step-mutation", version: 1 }, to: { id: "entity-project-context-panel", version: 1 }, location: "Project Context preview contract", created_at: recordedAt, ...derived },

    { id: "r-auth-doc-provider", type: "DECLARES", from: { id: "doc-auth-contract", version: 1 }, to: { id: "claim-auth-google-telegram", version: 1 }, location: "auth.ts", created_at: recordedAt, ...derived },
    { id: "r-auth-doc-pkce", type: "DECLARES", from: { id: "doc-auth-contract", version: 1 }, to: { id: "claim-auth-pkce-s256", version: 1 }, location: "auth.ts", created_at: recordedAt, ...derived },
    { id: "r-auth-doc-session", type: "DECLARES", from: { id: "doc-auth-contract", version: 1 }, to: { id: "claim-auth-session-expiry", version: 1 }, location: "auth.ts", created_at: recordedAt, ...derived },
    { id: "r-auth-provider-flow", type: "DESCRIBES", from: { id: "claim-auth-google-telegram", version: 1 }, to: { id: "entity-auth-flow", version: 1 }, location: "auth.ts", created_at: recordedAt, ...derived },
    { id: "r-auth-pkce-flow", type: "CONSTRAINS", from: { id: "claim-auth-pkce-s256", version: 1 }, to: { id: "entity-auth-flow", version: 1 }, location: "auth.ts", created_at: recordedAt, ...derived },
    { id: "r-auth-session-flow", type: "CONSTRAINS", from: { id: "claim-auth-session-expiry", version: 1 }, to: { id: "entity-auth-flow", version: 1 }, location: "auth.ts", created_at: recordedAt, ...derived },

    { id: "r-companion-doc-pref", type: "DECLARES", from: { id: "doc-companion-contract", version: 1 }, to: { id: "claim-companion-preference-bounds", version: 1 }, location: "companion.ts", created_at: recordedAt, ...derived },
    { id: "r-companion-doc-gate", type: "DECLARES", from: { id: "doc-companion-contract", version: 1 }, to: { id: "claim-companion-gate-reasons", version: 1 }, location: "companion.ts", created_at: recordedAt, ...derived },
    { id: "r-companion-doc-surface", type: "DECLARES", from: { id: "doc-companion-contract", version: 1 }, to: { id: "claim-companion-surfaces", version: 1 }, location: "companion.ts", created_at: recordedAt, ...derived },
    { id: "r-companion-pref-gate", type: "CONSTRAINS", from: { id: "claim-companion-preference-bounds", version: 1 }, to: { id: "entity-companion-gate", version: 1 }, location: "companion.ts", created_at: recordedAt, ...derived },
    { id: "r-companion-reason-gate", type: "GOVERNS", from: { id: "claim-companion-gate-reasons", version: 1 }, to: { id: "entity-companion-gate", version: 1 }, location: "companion.ts", created_at: recordedAt, ...derived },
    { id: "r-companion-auth", type: "DEPENDS_ON", from: { id: "entity-companion-gate", version: 1 }, to: { id: "entity-auth-flow", version: 1 }, location: "owner_not_authenticated gate reason", created_at: recordedAt, ...derived }
  ]
});
