import type { IntelligenceGraphEdge, IntelligenceGraphNode } from "@cosmora/contracts";
import type { IntelligenceGraphSearchRecord } from "../../src/index.js";
import { repositoryStructureFileId } from "./cosmora-repository-structure-graph.js";

const ownerId = "owner-cosmora";
const projectId = "project-nexus-os";
const observedAt = "2026-09-30T19:54:28.000Z";
const sourceId = "source-open-settings-review-stack";

const makeNode = (input: {
  id: string;
  kind: IntelligenceGraphNode["kind"];
  text: string;
  excerpt: string;
  createdAt: string;
  location: string;
  verified?: boolean;
}): IntelligenceGraphNode => ({
  contract_version: 1,
  node_id: input.id,
  node_version: 1,
  kind: input.kind,
  owner_id: ownerId,
  project_id: projectId,
  scope: "project",
  created_at: input.createdAt,
  observed_at: observedAt,
  valid_from: input.createdAt,
  valid_to: null,
  verification_status: input.verified ? "verified" : "discovered",
  sensitivity: "D1_PROJECT",
  source_ref: { source_id: sourceId, source_version: 1, location: input.location },
  provenance_kind: "runtime_record",
  confidence_method: "deterministic_check",
  extractor_version: "github-open-settings-review-v1",
  supersedes: null,
  deleted_at: null
});

const source = makeNode({
  id: sourceId,
  kind: "Source",
  text: "open Settings Companion communication pull request evidence",
  excerpt: "Open unmerged Settings, Companion and communication proposal stack.",
  createdAt: observedAt,
  location: "github:pulls/221,244,246,248,250,252,254,257",
  verified: true
});

const events = [
  makeNode({
    id: "proposal-pr-221-settings-foundation",
    kind: "Event",
    text: "PR 221 bounded communication settings foundation",
    excerpt:
      "Proposes mock-first Settings, Login, Live Companion and communication controls with bounded browser persistence.",
    createdAt: "2026-09-22T20:28:44.000Z",
    location: "pull:221@ef1352ae02d3bb2d06e2b2355b40d92881c289d2"
  }),
  makeNode({
    id: "proposal-pr-244-notification-reconcile",
    kind: "Event",
    text: "PR 244 reconcile notification preference browser permission",
    excerpt:
      "Proposes fail-safe disabling stale local notification preference without silently auto-enabling it.",
    createdAt: "2026-09-22T21:13:02.000Z",
    location: "pull:244@e65e37ae252b3110d65e1ccf35ea10c9476278d0"
  }),
  makeNode({
    id: "proposal-pr-246-timezone-boundary",
    kind: "Event",
    text: "PR 246 bound persisted Settings timezone",
    excerpt:
      "Proposes enforcing the existing 1..64 timezone string boundary with safe UTC fallback.",
    createdAt: "2026-09-22T21:14:12.000Z",
    location: "pull:246@0434f69d720eb6e68fc4d9d4e8b68ff4d5b2d93a"
  }),
  makeNode({
    id: "proposal-pr-248-companion-policy-controls",
    kind: "Event",
    text: "PR 248 expose Companion policy limits in Settings",
    excerpt:
      "Proposes owner controls for minimum gap, unanswered backoff and suppress-when-active.",
    createdAt: "2026-09-22T21:18:00.000Z",
    location: "pull:248@ba75c1266136950a89e92bb8f72924faa9751ae6"
  }),
  makeNode({
    id: "proposal-pr-250-mobile-settings-navigation",
    kind: "Event",
    text: "PR 250 expose Settings in mobile navigation",
    excerpt: "Proposes a Settings destination in the existing mobile navigation.",
    createdAt: "2026-09-22T21:19:21.000Z",
    location: "pull:250@2eaeb0b2bf39dc7cd3cc7625aa2f32d4d20dd5db"
  }),
  makeNode({
    id: "proposal-pr-252-settings-reset-confirmation",
    kind: "Event",
    text: "PR 252 confirm destructive Settings reset",
    excerpt: "Proposes explicit two-step confirmation before resetting local Settings state.",
    createdAt: "2026-09-22T21:20:32.000Z",
    location: "pull:252@e1743b6c64130308d1d4a336cac035524d7cae33"
  }),
  makeNode({
    id: "proposal-pr-254-communication-policy-controls",
    kind: "Event",
    text: "PR 254 expose communication policy toggles in Settings",
    excerpt:
      "Proposes owner-visible controls for canned framing, concrete examples and register preservation.",
    createdAt: "2026-09-22T21:22:39.000Z",
    location: "pull:254@dc9920539576002a87e54ee73a41dcb8aba52043"
  }),
  makeNode({
    id: "proposal-pr-257-push-consent",
    kind: "Event",
    text: "PR 257 separate browser permission local notifications and push consent",
    excerpt:
      "Proposes explicit allow_push consent distinct from browser permission and local notification preference.",
    createdAt: "2026-09-22T21:27:03.000Z",
    location: "pull:257@00ee7561682d02043f15e81f1fe1ec4a8b9af042"
  })
] as const;

const candidateFile = (id: string, path: string): IntelligenceGraphNode =>
  makeNode({
    id,
    kind: "Document",
    text: `open review file ${path}`,
    excerpt: `File exists in the open Settings review stack and is not current main evidence.`,
    createdAt: "2026-09-22T20:28:44.000Z",
    location: `open-review:${path}`
  });

const files = {
  settingsPage: candidateFile(
    "candidate-file-settings-page",
    "apps/web/src/app/settings/page.tsx"
  ),
  communicationContract: candidateFile(
    "candidate-file-communication-contract",
    "packages/contracts/src/communication.ts"
  ),
  settingsSpec: candidateFile(
    "candidate-file-settings-spec",
    "apps/web/e2e/settings.spec.ts"
  ),
  notificationSpec: candidateFile(
    "candidate-file-settings-notification-reconcile-spec",
    "apps/web/e2e/settings-notification-reconcile.spec.ts"
  ),
  timezoneSpec: candidateFile(
    "candidate-file-settings-timezone-spec",
    "apps/web/e2e/settings-timezone-boundaries.spec.ts"
  ),
  companionPolicySpec: candidateFile(
    "candidate-file-settings-companion-policy-spec",
    "apps/web/e2e/settings-companion-policy.spec.ts"
  ),
  mobileSettingsSpec: candidateFile(
    "candidate-file-mobile-settings-navigation-spec",
    "apps/web/e2e/mobile-settings-navigation.spec.ts"
  ),
  resetSpec: candidateFile(
    "candidate-file-settings-reset-confirmation-spec",
    "apps/web/e2e/settings-reset-confirmation.spec.ts"
  ),
  communicationPolicySpec: candidateFile(
    "candidate-file-settings-communication-policy-spec",
    "apps/web/e2e/settings-communication-policy.spec.ts"
  )
};

const settingsSurface = makeNode({
  id: "candidate-entity-settings-surface",
  kind: "Entity",
  text: "candidate Settings owner control surface",
  excerpt: "Open-review-only Settings surface for bounded local owner preferences.",
  createdAt: "2026-09-22T20:28:44.000Z",
  location: "pull:221"
});
const communicationProfile = makeNode({
  id: "candidate-entity-communication-profile",
  kind: "Entity",
  text: "candidate communication preference profile",
  excerpt: "Open-review-only communication preference profile exposed through Settings.",
  createdAt: "2026-09-22T20:28:44.000Z",
  location: "pull:221"
});

const edge = (input: {
  id: string;
  type: string;
  from: string;
  to: string;
  location: string;
  createdAt: string;
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
  created_at: input.createdAt,
  observed_at: observedAt,
  valid_from: input.createdAt,
  valid_to: null,
  verification_status: "discovered",
  sensitivity: "D1_PROJECT",
  evidence_ref: { source_id: sourceId, source_version: 1, location: input.location },
  provenance_kind: "deterministic_derivation",
  confidence_method: "deterministic_check",
  extractor_version: "github-open-settings-review-v1",
  supersedes: null,
  deleted_at: null
});

const stack = [
  ["proposal-pr-221-settings-foundation","proposal-pr-244-notification-reconcile","pull:244","2026-09-22T21:13:02.000Z"],
  ["proposal-pr-221-settings-foundation","proposal-pr-246-timezone-boundary","pull:246","2026-09-22T21:14:12.000Z"],
  ["proposal-pr-221-settings-foundation","proposal-pr-248-companion-policy-controls","pull:248","2026-09-22T21:18:00.000Z"],
  ["proposal-pr-221-settings-foundation","proposal-pr-250-mobile-settings-navigation","pull:250","2026-09-22T21:19:21.000Z"],
  ["proposal-pr-221-settings-foundation","proposal-pr-252-settings-reset-confirmation","pull:252","2026-09-22T21:20:32.000Z"],
  ["proposal-pr-221-settings-foundation","proposal-pr-254-communication-policy-controls","pull:254","2026-09-22T21:22:39.000Z"],
  ["proposal-pr-244-notification-reconcile","proposal-pr-257-push-consent","pull:257","2026-09-22T21:27:03.000Z"]
] as const;

const edges: IntelligenceGraphEdge[] = stack.map(([from,to,location,createdAt],index)=>
  edge({id:`settings-stack-${index+1}`,type:"STACKED_BEFORE",from,to,location,createdAt})
);

const changes = [
  ["proposal-pr-221-settings-foundation",files.settingsPage.node_id,"pull:221","2026-09-22T20:28:44.000Z"],
  ["proposal-pr-221-settings-foundation",files.communicationContract.node_id,"pull:221","2026-09-22T20:28:44.000Z"],
  ["proposal-pr-221-settings-foundation",files.settingsSpec.node_id,"pull:221","2026-09-22T20:28:44.000Z"],
  ["proposal-pr-244-notification-reconcile",files.settingsPage.node_id,"pull:244","2026-09-22T21:13:02.000Z"],
  ["proposal-pr-244-notification-reconcile",files.notificationSpec.node_id,"pull:244","2026-09-22T21:13:02.000Z"],
  ["proposal-pr-246-timezone-boundary",files.settingsPage.node_id,"pull:246","2026-09-22T21:14:12.000Z"],
  ["proposal-pr-246-timezone-boundary",files.timezoneSpec.node_id,"pull:246","2026-09-22T21:14:12.000Z"],
  ["proposal-pr-248-companion-policy-controls",files.settingsPage.node_id,"pull:248","2026-09-22T21:18:00.000Z"],
  ["proposal-pr-248-companion-policy-controls",files.companionPolicySpec.node_id,"pull:248","2026-09-22T21:18:00.000Z"],
  ["proposal-pr-250-mobile-settings-navigation",repositoryStructureFileId("apps/web/src/app/page.tsx"),"pull:250","2026-09-22T21:19:21.000Z"],
  ["proposal-pr-250-mobile-settings-navigation",files.mobileSettingsSpec.node_id,"pull:250","2026-09-22T21:19:21.000Z"],
  ["proposal-pr-252-settings-reset-confirmation",files.settingsPage.node_id,"pull:252","2026-09-22T21:20:32.000Z"],
  ["proposal-pr-252-settings-reset-confirmation",files.resetSpec.node_id,"pull:252","2026-09-22T21:20:32.000Z"],
  ["proposal-pr-254-communication-policy-controls",files.settingsPage.node_id,"pull:254","2026-09-22T21:22:39.000Z"],
  ["proposal-pr-254-communication-policy-controls",files.communicationPolicySpec.node_id,"pull:254","2026-09-22T21:22:39.000Z"],
  ["proposal-pr-257-push-consent",files.settingsPage.node_id,"pull:257","2026-09-22T21:27:03.000Z"],
  ["proposal-pr-257-push-consent",files.notificationSpec.node_id,"pull:257","2026-09-22T21:27:03.000Z"]
] as const;

for(const [from,to,location,createdAt] of changes){
  edges.push(edge({
    id:`settings-change-${edges.length+1}`,
    type:"PROPOSES_CHANGE_TO",from,to,location,createdAt
  }));
}

const semantics = [
  ["proposal-pr-221-settings-foundation","PROPOSES_UI_FOR",settingsSurface.node_id,"pull:221","2026-09-22T20:28:44.000Z"],
  ["proposal-pr-221-settings-foundation","PROPOSES_UI_FOR",communicationProfile.node_id,"pull:221","2026-09-22T20:28:44.000Z"],
  ["proposal-pr-221-settings-foundation","PROPOSES_UI_FOR","entity-auth-flow","pull:221","2026-09-22T20:28:44.000Z"],
  ["proposal-pr-221-settings-foundation","PROPOSES_UI_FOR","entity-companion-gate","pull:221","2026-09-22T20:28:44.000Z"],
  ["proposal-pr-244-notification-reconcile","HARDENS",settingsSurface.node_id,"pull:244","2026-09-22T21:13:02.000Z"],
  ["proposal-pr-246-timezone-boundary","CONSTRAINS",settingsSurface.node_id,"pull:246","2026-09-22T21:14:12.000Z"],
  ["proposal-pr-248-companion-policy-controls","EXPOSES_CONTROL_FOR","entity-companion-gate","pull:248","2026-09-22T21:18:00.000Z"],
  ["proposal-pr-250-mobile-settings-navigation","EXPOSES_NAVIGATION_TO",settingsSurface.node_id,"pull:250","2026-09-22T21:19:21.000Z"],
  ["proposal-pr-252-settings-reset-confirmation","HARDENS",settingsSurface.node_id,"pull:252","2026-09-22T21:20:32.000Z"],
  ["proposal-pr-254-communication-policy-controls","EXPOSES_CONTROL_FOR",communicationProfile.node_id,"pull:254","2026-09-22T21:22:39.000Z"],
  ["proposal-pr-257-push-consent","REQUIRES_EXPLICIT_CONSENT_FOR","entity-companion-gate","pull:257","2026-09-22T21:27:03.000Z"]
] as const;

for(const [from,type,to,location,createdAt] of semantics){
  edges.push(edge({id:`settings-semantic-${edges.length+1}`,type,from,to,location,createdAt}));
}

const candidateNodes = [
  source,
  ...events,
  ...Object.values(files),
  settingsSurface,
  communicationProfile
];

const records: IntelligenceGraphSearchRecord[] = candidateNodes.map((node)=>({
  node:{id:node.node_id,version:1},
  text:node.node_id.replaceAll("-"," "),
  excerpt:node.source_ref.location,
  estimated_tokens:12
}));

export const cosmoraOpenSettingsReviewGraph = () => ({
  nodes:candidateNodes,
  edges,
  records
});

export const COSMORA_OPEN_SETTINGS_NODE_COUNT = candidateNodes.length;
export const COSMORA_OPEN_SETTINGS_EDGE_COUNT = edges.length;
