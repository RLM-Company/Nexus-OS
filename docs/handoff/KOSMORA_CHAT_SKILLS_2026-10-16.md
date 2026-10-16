# Personal Skills in ordinary chat — 16 October 2026

## Delivered

Saved ordinary chats can explicitly select up to three owner-authored instruction revisions. The settings panel provides pinned/current version labels, explicit upgrade, literal text preview, disabling and recovery after a lost PUT response. Concurrent writes preserve the local draft and require loading the server selection. Controls are unavailable while an answer is active. Combined serialized instruction input is bounded to 16,000 UTF-8 bytes.

Selection and run provenance are distinct. Accepting a message transactionally captures an immutable text snapshot with the selection version; both stream and background dispatch consume this snapshot. Catalog edits do not upgrade selections. Deleting a catalog Skill detaches it for future turns, increments the affected selection versions and preserves already accepted run text. The UI documentation states this retention. Branches copy the current selection before accepting their new turn. Idempotent message retries, SSE replay and read-only snapshot recovery do not generate again.

Instructions remain in the user message, outside system authority, with no new tools, permissions or model calls. Existing context admission and usage/account reservations apply. Oversized current input fails explicitly rather than silently omitting selected instructions. Full model input is accounted by the existing gateway; behavior was exercised with mock providers only.

## Integrated base

The starting current Work branch is PR #348, `922b90cb442ca99ddfdb18965aceb83cc64d1ed4`. The presentation history/import work from PR #346, `7e7a7b7da825b9836abbc0a51831d5077de0d2f1`, is retained in a separate integration commit, `ecc2bd59bc9cd2c3dc1013bb115bfc37642b6dff`, with both source commits as parents. All 22 presentation changes are preserved. Work/Code files remain those of the current Work base.

Migration order is therefore 0044 → 0045 presentation history → 0046 chat Skills. Existing migration SQL/journal entries are not edited. The additive upgrade test begins with a database at 0044, preserves its existing chat/run/Skill, applies both newer migrations, reopens the file and verifies pinned text, idempotency, migration count, integrity and foreign keys. Pre-migration runs remain without Skills.

Owner identity comes from the canonical chat/run. Selection, run-snapshot reads, privacy export/deletion and lifecycle fences follow existing account boundaries. Account deletion works when the Skill adapter runs before the chat adapter; cascade deletes then remove the retained run snapshots. No retained usage/ledger rewrite is introduced.

## Validation

- 111 Vitest cases in 14 files passed: ordinary Skills/chat/memory/branches/workspace/background dispatch, owner Skills, presentation routes/history/package/PPTX, presentation migration, chat Skills migration/restart, Work DAG and Manager Work.
- Contracts/core/DB/API/web type checks passed. Scoped source/API/DB test ESLint, formatting/diff and secret checks passed.
- Contracts compiled; API production TypeScript build and Next webpack production build passed (19 routes).
- Four Playwright scenarios were added and test discovery passed: selection/persistence/explicit upgrade/literal rendering/disable; concurrent conflict; one-PUT lost-response recovery; narrow viewport.
- Browser execution remains unverified: Chromium is absent and the Playwright browser download returned an invalid archive. No browser pass, screenshot review or full pnpm check is claimed.
- No live/paid AI request, VPS deployment, main merge or successful hosted CI is claimed for this change.

## Remaining boundaries

Skills can be selected after an ordinary chat is saved. There is no automatic Skill matching or execution, no Manager/Work Skill attachment, and no marketplace installation. A selected Skill can consume substantial input context; adding it is not a claim of improved answer quality. Individual catalog deletion detaches future requests while accepted-run history retains its text. Broader desktop/provider/registration/operational readiness remains outside this block.
