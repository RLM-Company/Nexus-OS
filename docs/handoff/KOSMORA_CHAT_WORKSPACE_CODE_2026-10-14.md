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

## Subsequent production releases and provider fallback

The compact context panel and bounded repository metadata were activated from
`e03d87feffef4907eea9c80c90822399e2ed4412` in
`/opt/cosmora/releases/code-ready-e03d87f`. Its 684,276-byte source archive has
SHA-256 `0eab211fc880f64fbd39d480e211ea6ba15ab5298eb7550428bbcae5e163a60c`;
verified backup: `cc04a6f77c777e40ae91a6b1fc8208757cdec429906fd8c3712ab2bceec235004`.
The context controls now have a bounded scroll area and do not duplicate sibling
React keys. Live screenshot: `2026-10-14/kosmora-code-ready-e03d87f/chat-context-live.png`.

Gateway diagnostics were activated from
`30b1a7b7115d13ae881b25ea17a4e3f0b661ca35` in
`/opt/cosmora/releases/code-observe-30b1a7b`. Its 146,008-byte API-source archive
has SHA-256 `85c5c7d2758b553014e209e5d1dac5c7bc09270ecfb8cbf0dce0654fb76ec8d4`;
verified backup: `9e665ab6ee6296cdfaea5b6ab817e29ecb8b67b61c4ccaf2890ad659cce56c99f`.
Both releases passed copied database rehearsal and live authenticated reads;
43 migration rows, database integrity/FKs and existing canonical rows were
preserved. Login/executor remained unchanged; the last API-only release also
preserved the web container exactly. The real OCI executor check passed.

Actual `gpt-5.5` Code requests failed after dispatch. Run
`5ada6748-03b1-49e2-a15e-203460cc677a` was originally masked by guarded recovery;
run `4c117867-675e-49ce-9039-1f9bb95e884b` confirmed allowlisted `HTTP_503`.
No provider bodies/secrets are persisted in the diagnostic. Unknown billing
reservations remain; an HTTP failure is not proof of zero charge.

The user explicitly requested selection/testing of a working reserve model in
CheapVibeCode. Read-only discovery returned 42 IDs and token balance 31,231,148.
`gpt-6.1-sol` passed a bounded streaming text request. Vision probing initially
used an invalid PNG, then the existing tiny test fixture yielded no usable
response. A generated valid 32x32 white PNG with correct chunk CRCs succeeded:
answer `White`, 39 input / 5 output tokens. These were operator probes, separate
from canonical Code usage; failed/unknown probes are not claimed free.

The existing runtime has one shared external route for Chat/Manager/Code and
maintenance requires exactly one approved active external route. Therefore the
confirmed reserve temporarily replaces the default model across those services.
The prior gpt-5.5 entry is retained disabled, not silently reused as an alias.
The active route remains conservative: 32,000 context, 1,200 output, streaming
and verified vision, no tool calling/structured output, pricing null, unchanged
privacy declarations. No price, cost or semantic capability was fabricated.

Reversible configuration activation is in
`/opt/cosmora/releases/fallback-sol-20261014`, with registry/wrapper copies,
maintenance lock, idle/stop guards, rollback and verified backup SHA-256
`b32484c5b4b741ca8164130160944caf523f526fb87c90f7fa625033916cc2cdd`.
Only API was recreated. No migrations; login/web/executor IDs and start times
match. Live registry/runtime and DB checks passed. Existing maintenance module
`status` confirms the new route matches the approved provider, neither session
nor registry renewal is due, and discovery/generation requests were zero.

Live reserve-model run `450b3be6-0639-4a6d-9660-dad430dc5515` completed generation
(4,818 input / 625 output tokens), but its diff omitted the required terminal
newline and was rejected before publication (`PATCH_TRUNCATED`). A deliberately
revised task, run `96c2dc2f-e7d9-4271-ace4-62ae37c35637`, completed generation
(4,871 / 824) but failed exact source context at a hunk (`PATCH_CONTEXT`). There
were no automatic paid repairs or blind retries. Known token usage with unknown
pricing still retains the budget reservation.

Source `866cd185744435ab8ac065f641bd1ae9e575be43` adds explicit line labels to the
model context and instructions for JSON/newline/file headers. Canonical snapshot
bytes and strict patch validation remain unchanged. CRLF and final-newline
information survive formatting; no model file-selection round was added.
41 related tests pass (36 Code API + 5 proposal-input cases). Cumulatively 64
unique feature API cases and 13 browser cases passed across incremental runs;
local provider/GitHub fixtures are distinct from the live acceptance above.
DB/API/web type checks passed; scoped lint has zero errors; secret scan passed.

Final activation and end-to-end result follow below.
The numbered-context API image was activated successfully from `866cd18`;
source archive 146,367 bytes, SHA-256
`36e943f525b540b8475d96322ea3b21c98d4d0705277ef5dd6c5b3ef22706c51`,
backup `685756239c1438b4ebe57d0737e4fdfbdfba7235014194a871b77db693a21dcf`.
Copied/live DB checks, preserved rows, authenticated reads and actual executor
passed; login/web/executor were unchanged. Model stays gpt-6.1-sol.

Another explicit acceptance, `00d05121-b041-4351-a80a-4433d1a3cc6f`, used the
numbered source but returned unsupported unified-diff metadata (5,703 input /
637 output tokens). Strict validation rejected it. This is not presented as a
successful autonomous Code acceptance.

The follow-up adds a compact exact-replacement protocol for text-only models:
`summary` plus `edits[{path,old_text,new_text}]`. The server applies at most 32
sequential edits to eight already-read files, requires each non-empty old_text
to match exactly once (including whitespace/CRLF), and renders the canonical
diff itself. No fuzzy positions, silent path changes, deletes, unread files or
publication permissions are inferred. Conflicting response formats are refused.
Existing explicit unified-diff import remains strict and unchanged. The existing
50 KB/file and 160 KB/output bounds also apply to replacement results.

A rejected completed text response is saved as a bounded owner-only recovery
draft, never treated as a validated proposal or executable/publishable content.
Its bytes are not placed in log events. This preserves already-paid work for
explicit inspection/repair rather than automatically calling a model again.
Owner access/foreign-owner rejection are tested. This field currently supports
API/operator recovery; a dedicated end-user recovery editor is not claimed.

44 related tests pass (37 Code API and seven proposal-input cases), including
canonical diff generation, byte preservation, repeated/overlapping/fuzzy matches,
read boundaries, size limits and retained-draft access. Cumulative feature API
coverage is now 65 distinct cases; browser coverage remains 13 cases.