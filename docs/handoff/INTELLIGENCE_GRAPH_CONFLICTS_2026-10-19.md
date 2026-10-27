# Intelligence Graph — manual conflict review, 19 October 2026

Parent: Draft PR370 (`7262f597bfc010c06ecfc27d9053e1903d2cd3b5`). This remains the separate graph branch. Runtime stays OFF pending managed schema and product privacy registration. No startup DDL or migration allocation.

## Behavior

- Optional `workspace.conflicts` preserves compatibility with older snapshots. Maximum 50 conflicts; 2–20 distinct Claim identities in each. Subject can be any active node.
- `open_conflict` pins exact subject and position versions. `revise_conflict` explicitly replaces the positions of an open review. All earlier states remain in immutable workspace revisions.
- `resolve_conflict` accepts an active Decision created at or after conflict creation, only while the subject and every pinned position remain active. Stale positions require explicit revision. Wrong kind, older decision, foreign/missing refs and stale graph CAS fail without a write.
- `reopen_conflict` clears the current resolution association; the previous decision and its association remain in history. Resolved reviews cannot be silently overwritten.
- Node edit/delete does not rewrite conflict refs. Historical exact text remains visible; the UI marks changed/removed versions. A resolved decision whose node is edited remains pinned to its old version and can be reopened manually.
- Resolution is an owner organizational decision. It never changes node/edge verification, creates causal links, executes actions, calls models, or claims logical proof.

## Transfer and privacy

Portable v1 adds optional content-only `conflicts: [{subject, positions, resolution}]` where refs are package node keys and resolution is a Decision key or null. IDs, scopes, authority and timestamps are rejected. Export carries referenced historical node texts as independent portable nodes. Import assigns fresh graph/node/conflict IDs and current local dates, reconstructs the organizational decision relationship and marks every imported node/edge `discovered`. Portable content does not carry full audit history; owner privacy export does.

Old packages without `conflicts` retain their original canonical bytes and SHA-256. The existing 800kB / 150 node / 300 edge limits still apply. Conflict content participates in the reviewed hash and durable import replay.

The complete privacy export validates the optional conflict schema, unique IDs, Claim/Decision kinds, owner/project scope, exact refs and temporal consistency in every revision; inconsistent history fails the whole export. Existing transactional delete removes the snapshots containing all conflict history and preserves foreign/accounting data.

## Interface and checks

Russian grayscale review form shows exact positions and decision text, explicit review checkboxes, disabled stale resolution and retained drafts after a rejected revision. Revision comparison includes status, pinned refs and resolution. Editable node types now have Russian labels and stable enum values.

262 focused checks across 21 files pass on the exact graph source. Backend package/API builds, web and browser-spec TypeScript, scoped ESLint/Prettier, secrets/diff checks and production Next webpack build pass. Nine Playwright scenarios are discovered and type-checked; actual Chromium execution remains unconfirmed in this environment. Hosted CI status is recorded separately and is not represented as a test pass.
