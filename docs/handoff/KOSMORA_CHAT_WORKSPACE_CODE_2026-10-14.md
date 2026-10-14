# Chat workspace and Code delivery — 14 October 2026

## Connected features

- Owner-scoped folders with creation, rename, assignment, filtering and removal.
  Removing a folder keeps its chats; metadata operations do not touch activity order.
- Canonical server pins for chats and projects. Legacy browser pins are imported
  once after validating canonical ownership; subsequent unpins are not reintroduced.
  New browser profiles restore server organization. Foreign IDs cannot be assigned.
- Explicit per-chat context selection with optimistic versions, idle-run guards,
  bounded input and lost-write reconciliation. Stored history remains unchanged;
  the current user turn is always included in model input. Exclusion is per message,
  not an assertion that a fact echoed elsewhere has been erased.
- Editable extractive draft of early history, generated locally without a model.
  The user reviews and saves it before it replaces the earlier prefix in future
  requests. Eight recent messages at draft creation remain intact. Summary is quoted
  user data, not system authority, and actual input is accounted normally.
  No automatic semantic AI summary or guaranteed cost/quality benefit is claimed.
- An ordinary saved answer can be transferred to project Canvas with source
  attribution. Deterministic per-owner/project/source artifact IDs prevent duplicates
  on repeated import; importing again returns the existing artifact/current revision.
- Variants inherit copied exclusions under their new message IDs and folder placement.
  They do not inherit a summary that could contain facts beyond the fork point.
- Code creation has a durable client request ID/digest and owner-scoped recovery read.
  Identical retries return the existing run without another generation; changed
  retries conflict. A unique JSON-expression index protects competing inserts.
- Code can create an active workspace directly, without an initial Manager model
  run. The explicit creation action configures A2 local work in that new project;
  check and GitHub publication retain their separate exact-review approvals.
  Existing project profiles are not expanded by replay.
- Late Code action responses cannot change a different selected project.

## Storage and operational boundaries

Append-only migration 0044 follows the deployed 0043 journal. New context metadata,
folders, assignments, pins and import markers are included in owner privacy export
and deletion. Context/assignment rows cascade; durable lifecycle fences block writes.
No old journal entry or usage ledger is rewritten. Both stream and background chat
paths use the canonical filtered context. Existing manual memory remains separate.

Limits: 50 folders, 100 pins per kind, 500 excluded message IDs, 8,000 summary
characters. Extractive drafting accepts at most 508 completed messages and reads at
most 2,000 characters per message. Older attachments are not included in that draft.
The full original messages and attachments remain available in history/export.

## Verification

61 API cases passed across workspace, chat variants, memory, Canvas and Code.
After adding direct Code workspace creation, 42 affected API cases passed again
(34 Code cases and eight workspace cases); 62 unique API cases passed in total.
Coverage includes real local gateway/HTTP transport with deterministic provider
and GitHub fixtures, exact-check publication, reconciliation without extra writes,
source isolation, privacy fences, legacy pin import, and idempotent Canvas import.

Seven unique Chromium chat/workspace cases passed with real local HTTP/SQLite and
mock AI, including another browser profile and saved extractive summary. Six Code
browser cases passed, including recovery of lost creation/publication responses.
Direct Code workspace creation passed its browser scenario without starting a
model task. A duplicate React sibling key exposed while opening context was fixed
by giving the context panel a distinct namespace. No paid request has been used in these local checks.

DB/API/web semantic type checks passed; scoped source/test lint has zero errors.
Production activation, source IDs and a real Code/GitHub acceptance are recorded
below after verification. Hosted CI is still affected by the previously confirmed
GitHub billing gate; hosted CI success is not claimed.

## Initial verified activation and real Code finding

Source `6eee1548fc44e68e337773d530e744898cb73064` is published in Draft PR
[#345](https://github.com/RLM-Company/Nexus-OS/pull/345). Release directory:
`/opt/cosmora/releases/workspace-code-6eee154`. The 683,679-byte archive has SHA-256
`94603ba8a209d3fe56954270263ee8fe4adbd361c85dfdea4cbd3a1e1b5b71cc`.

Both production images built with networking disabled for build steps. An initial
incorrect self-reference in the Dockerfile base image was corrected before any
service replacement. The verified consistent backup has SHA-256
`1e2278d3d89334abfe904d7dbcebe07ccd741039b29c0f9a97bd734b39e0541e`.
The copied live database passed migration rehearsal (42 to 43 journal rows),
integrity/FK checks, folders/pins/context, source ownership, idempotent Canvas
imports and existing workspace checks without calling a model.

API/web became healthy, existing project/chat/message/run/identity/memory/branch
rows were preserved, and authenticated workspace, navigation, memory and context
reads passed. Login and the private executor retained their exact container IDs
and start times. The executor completed a real synthetic unprivileged check with
verified cleanup. Registration remains disabled. Browser context/folder controls
loaded in the remembered session; no existing chat context was changed by probing.

The actual Code acceptance created a dedicated A2 project
`cc140005-0001-4000-8000-000000000001` with no Manager request. It read the correct
GitHub base commit and selected files, but run
`2c8062c0-0ce1-4484-b936-2704e831450b` failed with `ROUTE_UNAVAILABLE` before a model
dispatch; usage, unknown attempts and cost records are all zero. The full
repository tree in the model prompt exceeded the route's conservative context.

The correction bounds model tree metadata to selected/nearby paths (128 entries,
12,000 bytes), labels a partial tree explicitly, and preserves the complete tree
for server-side path validation. A new 3002-file regression passes with one mock
generation; all 35 Code API cases passed. The context panel also gains a bounded
scroll area and a compact toggle after live viewport inspection. Production
activation and the next deliberately initiated Code attempt are recorded below.
