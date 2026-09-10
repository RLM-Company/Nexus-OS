# Cosmora readiness checkpoint — 2026-09-10

## Executive verdict

**Sunday Manager demo: READY for a controlled owner walkthrough.**  
**Autonomous/production Manager: NOT READY and not claimed.**

Verification target: `main@18d196cfdf8966b53bb9d37111b4ce7ab7628df2`.
At this checkpoint GitHub reports no open pull requests.

The demo is a bounded, persisted vertical slice: the owner creates or reopens a project, gives a
task, sees a three-step plan, reloads it, explicitly starts a deterministic synthetic/read-only
executor, then inspects artifacts, handoff and checkpoint. The existing chat flow separately
demonstrates server-owned background execution, reload/reopen observation, Stop and cancellation.

## Evidence in `main`

| Area                        | PR / merge       | Full CI           | Verified result                                           |
| --------------------------- | ---------------- | ----------------- | --------------------------------------------------------- |
| Manager demo plan           | #111 / `7300c2c` | inherited by #468 | bounded three-step project plan                           |
| Durable demo state          | #112 / `d7040b8` | inherited by #468 | run, artifacts and checkpoint survive reload              |
| Synthetic coordinator       | #113 / `ea6de69` | inherited by #468 | deterministic, no provider/tool/external effect           |
| Owner-bound API             | #114 / `71488e7` | inherited by #468 | create/list/read/start/cancel contracts                   |
| Manager Console slice       | #115 / `095581b` | CI #468 PASS      | visible plan, explicit start, artifacts/checkpoint E2E    |
| Trusted condition authority | #107 / `d3f5a06` | CI #476 PASS      | invocation cannot supply policy expansions                |
| Canonical profile integrity | #108 / `32372be` | CI #455 PASS      | corrupted base grants fail closed                         |
| Manager context binding     | #109 / `4d52279` | CI #454 PASS      | task inputs and role-valid artifacts only                 |
| Reservation-time authority  | #117 / `fecd83b` | CI #480 PASS      | server clock, expiry/TOCTOU and purpose binding           |
| Unknown outcome recovery    | #118 / `18d196c` | CI #482 PASS      | no false `FAILED`, no retry, owner-visible reconciliation |

Every listed CI executes the repository `pnpm check`, including frozen dependency install,
formatting, secret scan, lint, strict TypeScript, unit/API tests, production builds and Playwright
Chromium. PRs #117 and #118 were merged only after a clean full result.

## What can be demonstrated honestly

1. Create a project with the suggested task: `Подготовь план улучшения документации проекта`.
2. Create the persisted Manager demo plan.
3. Reload/reopen and confirm the same plan remains visible.
4. Explicitly start the safe demo executor.
5. Inspect synthetic analysis, artifacts, handoff and checkpoint.
6. Use the existing chat background run to demonstrate reload/reopen observation and Stop.
7. Open Control Center to explain confirmations, Decision Trace, hard limits, emergency stop and
   read-only `RECOVERY_REQUIRED` visibility.

Use the exact phrases **controlled vertical slice** and **synthetic/read-only executor**. Do not
describe this as a production provider, autonomous company or completed multi-agent runtime.

## Readiness matrix

| Gate                              | Status                       | Meaning                                                                          |
| --------------------------------- | ---------------------------- | -------------------------------------------------------------------------------- |
| Demo path                         | PASS                         | one coherent owner-visible flow is persisted and browser-tested                  |
| Reload/Stop                       | PASS                         | server-owned chat run survives observer loss and can be cancelled                |
| Policy fail-closed                | PASS for current scope       | condition, profile, context, timestamp and permission drift are rejected         |
| Unknown external outcome          | PASS for visibility/no retry | remains `RECOVERY_REQUIRED`; resolution is intentionally manual and read-only    |
| Real model Manager                | BLOCKED                      | production provider, evidence, credentials and retention policy are not selected |
| Real tools/sandbox                | BLOCKED                      | no approved production sandbox/daemon and no real A0–A2 tool suite               |
| Final Manager prompt              | OWNER-ONLY                   | must be authored, versioned and approved with the owner                          |
| A6 / finance / production actions | OUT OF SCOPE                 | remain disabled and require separate owner/security/economic gates               |

## Remaining risks after the demo

- The dedicated demo executor is intentionally short and synchronous after explicit start; its
  queued cancel is not evidence of a durable long-running Manager worker.
- `RECOVERY_REQUIRED` has safe visibility but no audited resolution action. Do not add retry,
  success or failure controls without provider evidence and a separate owner-approved contract.
- The synthetic executor does not prove model quality, tool quality, sandbox isolation, cost
  control under a real provider or production observability.
- No claim of monetizable or production readiness is justified by this demo.

## Next owner-independent engineering targets

1. Continue adversarial tests around idempotency, stale authority, restart and persistence failure.
2. Prepare a no-network demo smoke script/checklist without changing the Manager prompt.
3. Keep documentation and delegation work packages current.
4. Pause any real-provider, production, finance, A6 or final-prompt step for an explicit owner
   decision.
