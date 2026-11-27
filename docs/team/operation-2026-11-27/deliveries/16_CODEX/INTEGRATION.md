# Ordinary chat reliability — integration

Base: `3af92583ccc8ceb49f44c0b8633955f40feaf59f` (main, PR #688).
Branch: `feature/codex-chat-reliability-20261127`.
Scope was claimed in `16_CODEX_CHAT_RELIABILITY_RU.md` after the owner's instruction
to select an unoccupied loop. No dependency on the developer API patches #699/#700.

## Product behavior

- A failed preflight or a crash between queue claim and assistant creation leaves
  a durable failed assistant marker, so history restoration can stop waiting.
- Restart repair also covers the latest legacy failed run without an assistant.
  Older orphan failures are not appended after a newer turn: history order and
  the current queued request are preserved. No request is automatically reissued.
- Starting an assistant is transactional and rejects terminal runs. Late deltas
  cannot modify cancelled, failed or completed answers. Terminal errors are stable.
- Reconnecting to a failed/cancelled run receives its persisted partial text before
  the terminal event. It never reports success or triggers another model call.
- Queued/silent SSE responses emit keep-alive comments, without fabricated progress.
  Heartbeat timers/listeners are released on response completion, disconnect or
  explicit observer cleanup. The active observer polling wait stays referenced
  until completion/abort, preventing terminal delivery from depending on unrelated
  event-loop activity.
- A run removed during observation produces a terminal not-found failure instead
  of silently leaving the client waiting.
- Assistant lookup is constrained by its chat as well as run, using the existing
  chat index; recovery constructs the set of represented runs without a correlated
  whole-message-table scan per run. There is no new schema migration.

## Files and neighbors

Functional changes are limited to `packages/db/src/general-chat-store.ts`,
`apps/api/src/general-chat-routes.ts` and the new `chat-stream-heartbeat.ts` helper.
Memory selection/compaction, Skills, identity, project membership, task plans,
Stars, scheduling and public developer API are unchanged. The modified shared
files must retain any later memory/integration hunks from the team's other PRs.

No app.ts/server.ts registration change is needed: production already calls
`recoverInterruptedRuns()` during startup and registers these chat routes.
The existing preClose hook already aborts observers; the new shutdown scenario
verifies that connection/timer cleanup composes with it.

No UI/layout changes, new packages, secret access, paid calls or VPS deployment.
The owner-window and live-provider acceptance are not replaced by local fixtures.

## Reproduction and validation

Six initial regression checks failed on the original implementation: orphaned
claimed run, latest legacy orphan, preflight failure marker, and late writes after
cancel/fail/complete. They pass after the fix. Additional cases cover transaction
rollback, preserving a newer turn, persisted partial replay, owner isolation, a
database closed/reopened on disk, duplicate POST after lost acknowledgement,
real HTTP observer disconnect, and server shutdown with a queued response.

Commands:

```text
pnpm --filter @cosmora/db exec vitest run test/general-chat-reliability.test.ts test/general-chat-store.test.ts test/general-chat-usage-commit.test.ts test/general-chat-project.test.ts --maxWorkers=1
pnpm --filter @cosmora/db build
pnpm --filter @cosmora/api exec vitest run test/general-chat-recovery.test.ts test/chat-stream-heartbeat.test.ts test/general-chat-api.test.ts test/general-chat-background-run-coordinator.test.ts --maxWorkers=1
pnpm --filter @cosmora/db typecheck
pnpm --filter @cosmora/api typecheck
```

Targeted ESLint/Prettier and diff checks accompany these tests. The exact candidate
must still pass the full GitHub CI before inclusion in the release. Keep local
fixtures, candidate CI and live-server acceptance as separate evidence.
