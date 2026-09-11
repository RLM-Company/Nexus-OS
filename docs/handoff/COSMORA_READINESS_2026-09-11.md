# Cosmora readiness checkpoint — 2026-09-11

## Executive verdict

**Sunday internal Manager demo on PC: READY.**  
**Optional phone demo on a trusted private network: READY at the software gate; one physical-device
dry run remains.**  
**Autonomous or production Manager: NOT READY and not claimed.**

Verification target: `main@40e6447a42e7cb54c29a8385966a0ffcf39ec8af`. At this checkpoint
GitHub reports no unfinished implementation PR from this workstream.

The demonstrable Manager remains a bounded persisted vertical slice with a deterministic
synthetic/read-only executor. The startup path, database migration, web-to-API proxy and safety
preflight have now been exercised against fresh temporary databases as well as the repository CI.

## Evidence added after the 2026-09-10 checkpoint

| Area                               | PR / main commit | Full CI   | Verified result                                                                             |
| ---------------------------------- | ---------------- | --------- | ------------------------------------------------------------------------------------------- |
| Canonical policy timestamps        | #120 / `d6b305e` | #486 PASS | invalid or non-canonical authority time fails schema validation                             |
| Exact intent binding               | #121 / `3a2b7b3` | #488 PASS | verdict capability/order and operation bindings cannot drift before persistence             |
| Phone layout                       | #122 / `70df7aa` | #490 PASS | 390×844 Manager demo has no horizontal overflow and preserves controls                      |
| Terminal policy transitions        | #123 / `5f74fca` | #492 PASS | lost or duplicate completion/failure transitions are rejected, not silently accepted        |
| Atomic authority re-evaluation     | #124 / `fa38694` | #494 PASS | reservation recalculates the current profile, permissions, overrides and trusted conditions |
| Point-override purpose binding     | #125 / `3cd246d` | #496 PASS | an exception approved for one purpose cannot authorize another intent                       |
| Desktop/LAN startup and preflight  | #126 / `54eaf4c` | #499 PASS | repeatable PC/phone startup, aligned migration, mock-only live preflight and runbook        |
| Unique point-override identity     | #128 / `1579cc3` | #503 PASS | duplicate override IDs are rejected by API, persistence and policy evaluation               |
| Unambiguous point overrides        | #129 / `939316a` | #505 PASS | an intent must match exactly one scoped override; overlapping grants pause fail-closed      |
| Step-up and decision preconditions | #130 / `2c1b09b` | #507 PASS | stale, terminal or expired mutations fail before proof use; decision time is transactional  |
| Confirmation operation binding     | #131 / `8a34ee9` | #509 PASS | confirmation-derived one-use authority belongs only to the exact approved operation         |
| Step-up mutation binding           | #132 / `e088f36` | #511 PASS | critical proofs bind to the exact canonical authority or hard-limit mutation                |

CI #511 passed the complete `pnpm check`: frozen install, formatting, secret scan, 9/9 lint,
9/9 strict TypeScript, 329 unit/API tests, 9/9 production builds and 22 Playwright Chromium
scenarios.

## Demo entry points

| Goal                                 | Command               | Exposure                                          |
| ------------------------------------ | --------------------- | ------------------------------------------------- |
| Prepare SQLite explicitly            | `pnpm db:migrate`     | local database only; API also migrates at startup |
| Start the PC walkthrough             | `pnpm demo`           | Web and API on loopback                           |
| Start the optional phone walkthrough | `pnpm demo:lan`       | Web on the trusted LAN; API remains on loopback   |
| Verify safety before presenting      | `pnpm demo:preflight` | read-only loopback checks                         |

Preflight requires healthy API/SQLite, expected Cosmora HTML, a working web proxy, mock-only model
mode, no configured model credential and no active emergency stop. It makes no write and refuses a
non-loopback target.

The exact five-minute walkthrough and fail-safe responses are recorded in
`docs/handoff/SUNDAY_MANAGER_DEMO_RUNBOOK_2026-09-11.md`.

## Readiness matrix

| Gate                               | Status                       | Meaning                                                                                         |
| ---------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------- |
| PC startup                         | PASS                         | the documented command and live preflight work on a fresh database                              |
| Persisted Manager demo             | PASS                         | plan, reload, explicit safe execution, artifacts and checkpoint are browser-tested              |
| Reload and Stop                    | PASS                         | server-owned chat run can be observed again and cancelled after reload/reopen                   |
| Responsive phone UI                | PASS (automated)             | 390×844 viewport is covered by CI                                                               |
| LAN phone path                     | PASS (software)              | frontend binds to LAN while API stays on loopback; physical phone dry run remains               |
| Policy fail-closed                 | PASS for current scope       | atomic checks bind current authority, exact override, confirmation operation and proof mutation |
| Unknown external outcome           | PASS for visibility/no retry | state remains `RECOVERY_REQUIRED`; resolution is intentionally read-only                        |
| Real model Manager                 | BLOCKED                      | production provider, evidence, credentials and retention policy are not selected                |
| Real tools/sandbox                 | BLOCKED                      | no approved production sandbox/daemon or real policy-governed tool suite                        |
| Final Manager prompt               | OWNER-ONLY                   | must be authored, versioned and approved with the owner                                         |
| A6, finance and production effects | OUT OF SCOPE                 | remain disabled behind separate owner/security/economic gates                                   |

## What may be claimed in the demo

The owner can honestly show:

1. a project task entering the Manager chat through the local mock route;
2. a persisted three-step Manager plan;
3. the same plan after page reload and project reopen;
4. an explicit bounded synthetic/read-only execution;
5. persisted analysis, handoff artifacts and checkpoint;
6. server-owned background observation and Stop after reload;
7. owner-visible Control Center surfaces without approving or activating dangerous actions.

Use the phrases **controlled vertical slice** and **synthetic/read-only executor**. Do not describe
the result as a production provider, autonomous company, external tool executor or completed
multi-agent runtime.

## Remaining risks before Sunday

- Perform one physical phone dry run on the exact private Wi-Fi and PC that will be used. Automated
  viewport and live LAN binding are evidence, but not proof of that router/firewall combination.
- LAN mode uses the development owner identity. Anyone who can reach the temporary frontend on the
  trusted network could operate that local demo session; use a private network and stop it
  immediately afterward.
- The dedicated demo executor completes synchronously after explicit start. Its queued Stop is not
  evidence of a durable long-running task worker.
- `RECOVERY_REQUIRED` is intentionally visibility-only. No success/failure/retry button should be
  added without provider reconciliation evidence and a separately approved contract.
- Critical step-up challenges are mutation-bound on the server, but no production step-up/MFA
  provider has been selected or connected; this is a security contract, not production MFA proof.
- The mock route does not establish real-model quality, privacy, cost, tool quality, sandbox
  isolation or production observability.

## Owner decisions still required after the demo

1. Select and evidence a production model/provider, including privacy, retention, pricing and
   credential handling.
2. Co-author and approve the final Manager system prompt.
3. Approve the sandbox/daemon and the first real A0–A2 tool contracts.
4. Choose production identity, hosting and operational support boundaries.
5. Separately authorize any later A6, finance, production, public or external-effect work.
