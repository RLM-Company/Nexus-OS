# Settings, English Relay, research and media integration

Source: three changed-file archives based on `b15912d`, reconstructed as exact Git
diffs in separate scratch clones and applied with three-way merges onto `7e12e12`.
Shared app/server/page/exports retain every area's changes. No production access,
credentials, paid calls or text-provider configuration changes were used.

## Implemented paths

- Owner preferences, per-chat English Relay override, verified configured model
  selection, response style, usage ledger, token ceiling, JSON export and explicit
  deletion challenge. English Relay defaults OFF. It translates ordinary-chat model
  copies; displayed history remains original. Code/paths/URLs are preserved exactly;
  secrets, unsupported attachments and truncated translations fail closed.
- Owner token ceiling is enforced before provider dispatch on both ordinary chat
  paths and both Project Chat paths (inline SSE and durable background execution).
  Project limits remain independent. Work's owner-budget integration belongs to its
  separate coordinator patch. Relay is ordinary-chat-only; no universal savings claim.
- Research workspace performs bounded SearxNG search and public page reads, saves
  checkpoints, supports pause/resume/cancel and exports actual Markdown/HTML reports.
  Reports are extractive evidence, with citations and source metadata; no hidden
  generative/paid synthesis. DNS responses are checked and TCP is pinned to one
  approved address with automatic address-family selection disabled. Redirects,
  private/reserved networks, oversized/compressed output and robots denial fail closed.
  Search itself now receives the run AbortSignal, so pausing cancels the fetch.
- Image and MP3 jobs use real protocol adapters, durable owner-scoped assets,
  authenticated downloads, cancellation, interruption recovery and asset deletion.
  Paid execution still defaults OFF and requires separate media credentials. The
  production default media directory is `/var/lib/cosmora/media`; only explicit
  `KOSMORA_MEDIA_DIR` overrides it. No SQLite media migration is needed.
- Browser dictation and speech synthesis only start from explicit buttons. Dictation
  is editable before insertion; it never sends a chat message automatically. Server
  recording is bounded to 60 seconds / 1.5 MB. Unmount stops tracks and aborts upload;
  request disconnect cancels transcription. Browser vendor processing is disclosed.

## Accounting contract for Work integrator

`AccountStore.reserve(owner, runId, attempt, maxTokens, 'main', projectId, provider,
model)` returns a hold ID. Call inside `route.selected` before advancing the gateway
iterator: adapters have not dispatched yet. Quota rejection is
`QuotaExceededError.code = 'USAGE_LIMIT_EXCEEDED'`.

On success, call `completeReservation(id, 'main', inputTokens, outputTokens)` only
after committing the canonical model ledger. On failure, cancellation, interruption
or uncertain completion, call `uncertainReservation(id, 'main')`; unknown charged
attempts remain counted by their upper bound. Main holds are deduplicated against
the owner-scoped canonical general/project ledger for the same run and attempt.

`releaseBeforeDispatch(id)` is exclusively for a proven local reservation rejection
while still handling `route.selected`, before the iterator resumes. It only deletes
reserved holds. It must never free a dispatched, cancelled or uncertain paid call.
All callers derive owner identity from authenticated requests or owner-bound queued
runs; no external endpoint accepts arbitrary hold IDs or owners.

## Canonical migrations

- `0027_personal_settings.sql`: journal idx 27, when `1791580800002`.
- `0028_research_workspace.sql`: journal idx 28, when `1791580800003`.

The main integrator inserts document idx 25 and Work idx 26 before these entries.
Production server runs the normal migrations before creating stores. Research's
constructor performs recovery only, never DDL. `AccountStore.migrate()` and
`RESEARCH_SQL` remain test-fixture helpers only.

## Verification and limits

The combined nine-package production build passed before the final Project Chat
quota extension. API/web/gateway type checks passed on the original merged feature
set; subsequent API quota/type checks passed. The broad run tested 173 cases:
172 passed and one newly written fixture expected the wrong project-limit error
code; its corrected two-suite rerun passed all 22 cases. The earlier scoped Relay
integration run passed 27 cases including real canonical SQLite migrations, both
translation directions, exact markers, truncation, no-dispatch quota and accounting.
Archive lint errors were repaired rather than disabled; final root merged build and
acceptance remain required. Secret scan and diff whitespace checks passed.

No live media acceptance is claimed: no media credentials are available here. Media
storage currently supports one API process. Browser voice needs browser support and
microphone permission. Research is extractive and cannot read login/SPA/PDF content.
Account deletion remains transactional and may refuse because of active runs or
immutable/restricting relations; it does not erase auth/security audit history or
new external subsystem assets. JSON export covers the known original owner tables,
not a full backup of all newly integrated subsystems.

Common files to merge carefully: `apps/api/src/app.ts`, `server.ts`,
`general-chat-routes.ts`, `general-chat-background-run-coordinator.ts`,
`manager-background-run-coordinator.ts`, `web-search.ts`; web `page.tsx`,
`workspace-navigation.tsx`, `workspace-sections.tsx`, `web-search-panel.tsx`;
core and gateway `src/index.ts`, gateway `package.json`, migration journal.
