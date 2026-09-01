# Manager Runtime Step 6 contract acceptance

Date: 2026-08-31  
Status: `PASS — CONTRACT FOUNDATION / NO AGENT RUNTIME`  
Verification target: `main@26c019c5d0e38539769f7e9c80abfac7d060e7ef`

## Verdict

The roadmap Step 6 contract foundation is complete. Cosmora now has machine-readable role, graph,
artifact, context, conflict, checkpoint and scenario-gate boundaries that can be composed by later
runtime increments without granting any new authority.

This acceptance does not claim that Manager or worker agents execute yet. It accepts the contracts
and deterministic release-gate harness that must constrain that future execution.

## Acceptance matrix

| Roadmap requirement                                           | Evidence                                                                                                                                            | Result |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Manager, architect, researcher, analyst and critic interfaces | Canonical role schemas and role contracts in `manager-runtime.ts`; contract tests keep every role project-bound and unable to bypass Policy Runtime | PASS   |
| Task graph with deterministic dependency state                | Structural/semantic graph validation plus `deriveRuntimeTaskReadiness` and package-local tests                                                      | PASS   |
| Typed artifact exchange and bounded context                   | Artifact exchange checks, context envelope and context materialization validation                                                                   | PASS   |
| Artifact provenance and task ownership                        | Closed provenance graph validation plus task/project/role/input/output/chronology binding                                                           | PASS   |
| Explicit critic and conflict behavior                         | Critic pause rules, distinct conflict positions, manager-only arbitration and lifecycle chronology validation                                       | PASS   |
| Checkpoint and recovery boundary                              | Exact task-state coverage; no permission, session or autonomy restoration; graph/project chronology checks                                          | PASS   |
| Mandatory system scenarios                                    | 19 canonical scenario entries cover all 13 required categories and every autonomy level A0–A6                                                       | PASS   |
| Automatically checkable verdicts                              | Deterministic single-scenario runner and aggregate suite runner fail closed on missing, duplicate or mismatched observations                        | PASS   |
| No hidden runtime authority                                   | Contracts and evaluators have no model, tool, permission, persistence or external-effect execution path                                             | PASS   |

## Verified composition

The latest full monorepo quality gate on the accepted tree covered formatting, secret scanning,
lint, strict TypeScript, unit and API tests, production builds and the Playwright browser scenario.

The final hardening sequence on top of the aggregate suite gates added:

1. parsed-instant checkpoint chronology;
2. closed artifact provenance validation;
3. parsed-instant conflict chronology;
4. artifact-to-task graph binding.

Each increment was rebuilt on the then-current `main`, reviewed as a bounded diff and merged only
after a fresh full CI pass.

## Intentionally deferred

The following remain required later and are not misrepresented as Step 6 runtime functionality:

- real fixture adapters that collect observations from Policy Runtime, Model Gateway, Tool Runtime,
  memory and recovery subsystems;
- persisted execution of task graphs, artifacts, conflicts and checkpoints;
- Manager or worker-agent model calls;
- tool execution and external effects;
- final Manager and role system prompts;
- prompt-version activation and rollback.

Those items belong to later runtime increments and must consume these contracts rather than bypass
them.

## Post-acceptance roadmap update

At the moment of this acceptance, roadmap Step 5 was globally incomplete and its Control Center
slice was read-only. Subsequent PRs #76 and #77 added authority-diff preview plus version-checked
profile apply, and guarded confirmation approve/reject actions.

Step 5 remains globally incomplete: point-override editing, owner-facing Decision Trace,
cost/limit controls, emergency-stop mutation and explicit `RECOVERY_REQUIRED` handling still need
UI slices.

Step 7 final prompt work still requires direct owner collaboration and must not begin as an
autonomous rewrite.
