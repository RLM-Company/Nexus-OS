# Manager demo readiness — 2026-09-10

## Verdict

The first Manager demo is **ready for a controlled owner walkthrough**. It is a bounded
vertical slice, not an autonomous or production Manager.

## Demonstrable flow

1. Create or reopen a project and give the Manager a task.
2. Create a persisted three-step Manager plan from that task.
3. Reload/reopen the project and see the same plan.
4. Explicitly start the safe demo executor.
5. Inspect the persisted plan, synthetic read-only analysis, handoff and checkpoint.
6. Stop a queued Manager demo run explicitly; the existing chat run also preserves
   Stop/reload/cancel/recovery behaviour.

The demo executor is deterministic and bounded. It calls **no model/provider, network,
filesystem, Tool Runtime, external integration, finance, production or A6 capability**.

## Evidence in main

| Layer                 | Main commit | Evidence                                                 |
| --------------------- | ----------- | -------------------------------------------------------- |
| Bounded plan contract | `7300c2c`   | Three project-bound RuntimeTaskGraph steps               |
| Durable demo storage  | `d7040b8`   | Run, artifacts and checkpoint migrations/store           |
| Synthetic coordinator | `ea6de69`   | No external execution path                               |
| Typed API             | `71488e7`   | Owner/project-bound create/list/read/start/cancel routes |
| Manager Console       | `095581b`   | Visible plan, artifacts, checkpoint and explicit actions |

GitHub Actions run **#468** passed the full `pnpm check`, including Playwright Chromium
and the browser scenario `plan -> reload -> execute -> artifacts/checkpoint`.

## Known boundaries for the walkthrough

- The Manager demo execution completes synchronously after explicit start. Its dedicated
  Stop control is meaningful while it is still queued; it is not a long-running worker.
- The pre-existing chat background run remains the demo surface for visible running-state
  Stop/reload/cancel/recovery.
- “Synthetic/read-only” is deliberately stated in the Console. Do not present it as a
  real model-driven autonomous action.

## Not ready / owner-only decisions

- Production model/provider selection, credentials and privacy/retention verification.
- Final Manager system prompt.
- Sandbox/daemon and policy-governed real repository/file/tool execution.
- Durable worker/restart semantics for a real multi-step Manager run.
- A6 activation, finance/billing, production deployment, public/external actions.

## Suggested Sunday walkthrough task

`Подготовь план улучшения документации проекта`.

It demonstrates planning, a visible safe context step, handoff/checkpoint persistence and
reload without suggesting that Cosmora changed an external system.
