# B0.1 vertical-slice acceptance

**Date:** 2026-08-24  
**Status:** PASS  
**Scope:** project creation, main chat, durable history, mock-manager streaming, restart recovery,
owner isolation, cancellation, and repository quality gates  
**Pull request:** [#15](https://github.com/RLM-Company/Nexus-OS/pull/15)  
**CI evidence:** [CI #155](https://github.com/RLM-Company/Nexus-OS/actions/runs/32745997014)

## Outcome

B0.1 satisfies its exit criterion: all mandatory checks pass, no active P0/P1 defect remains, and
the persisted project/message/run state survives a full database close and reopen. The UI remains
provider-neutral; real tool execution and autonomous worker agents are outside this acceptance
scope.

## Acceptance matrix

|   # | Criterion                                                                     | Evidence                       | Result |
| --: | ----------------------------------------------------------------------------- | ------------------------------ | ------ |
|   1 | First task creates a project                                                  | API and Playwright             | PASS   |
|   2 | Project receives one main chat                                                | DB and API tests               | PASS   |
|   3 | User message and run are persisted atomically                                 | DB tests                       | PASS   |
|   4 | Mock manager emits typed SSE start, delta, and completion events              | API and Playwright             | PASS   |
|   5 | Assistant response is durable after streaming                                 | API and DB tests               | PASS   |
|   6 | Full SQLite close/reopen restores project history                             | DB restart test                | PASS   |
|   7 | Interrupted queued/running runs fail closed on restart                        | DB recovery test               | PASS   |
|   8 | Active run can be cancelled by its owner                                      | API and Playwright             | PASS   |
|   9 | Cancelled run and assistant message remain cancelled                          | API and DB assertions          | PASS   |
|  10 | A second concurrent stream consumer is rejected                               | API test                       | PASS   |
|  11 | Identical idempotent request replays the original result                      | DB and API tests               | PASS   |
|  12 | Reused idempotency key with another payload returns conflict                  | DB and API tests               | PASS   |
|  13 | Project listing and detail are owner-scoped                                   | DB and API tests               | PASS   |
|  14 | Foreign run streaming and cancellation are denied                             | API test                       | PASS   |
|  15 | Project messages cannot cross the owner boundary                              | DB test                        | PASS   |
|  16 | UI has no provider-adapter imports                                            | architecture boundary test     | PASS   |
|  17 | UI communicates only through the internal API/SSE contract                    | source boundary and Playwright | PASS   |
|  18 | Repository secret scan is part of the mandatory gate                          | `pnpm check:secrets`           | PASS   |
|  19 | Authorization, cookies, and step-up headers are redacted from logs            | API logger configuration       | PASS   |
|  20 | Format, lint, strict types, all tests, build, and browser smoke pass together | GitHub CI                      | PASS   |

## Closed defects

| Severity | Defect                                                                                                | Resolution                                                                              |
| -------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| P1       | A custom-owner project could be re-read through the default owner inside message creation             | Owner identity is propagated through every internal lookup; regression tests added      |
| P1       | Long assistant text violated the 240-character project-preview contract and caused `500` after reload | Preview is bounded in SQL and covered by an API regression test                         |
| P1       | Interrupted runs had no deterministic restart state                                                   | Startup recovery marks unfinished runs/messages failed without retrying external work   |
| P1       | Cancellation was only a UI concept                                                                    | Durable cancel endpoint, abort propagation, terminal events, and tests added            |
| P1       | Bodyless cancel was sent as empty JSON and misclassified as server error                              | Client omits the JSON header without a body; malformed JSON maps to typed `400`         |
| P2       | Browser smoke initially depended on server startup/delete ordering                                    | Each Playwright server receives an isolated database path without deleting an open file |
| P2       | Browser assertions depended on transient button state and SSE body ownership                          | Assertions now target durable UI/API outcomes                                           |

## Residual constraints

- The accepted runtime still uses one built-in local owner identity; real identity and step-up are a
  later roadmap gate.
- Browser acceptance uses the deterministic mock provider. A real provider is B0.2.
- Full security hardening remains scheduled for the pre-release security step; current fail-closed
  policy, owner boundary, secret scan, and log redaction stay mandatory.

## Exit decision

`B0.1 = ACCEPTED`. The next authorized stage is B0.2: Model Registry, deterministic routing, and
authorized VibeCode discovery. No final Manager system prompt is approved by this report.
