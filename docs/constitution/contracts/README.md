# Constitution implementation contracts

Status: `IMPLEMENTATION CONTRACTS / NOT RUNTIME`  
Constitution baseline: `OWNER APPROVED v1.1`

This directory translates approved Cosmora specifications into machine-readable implementation boundaries without changing the constitutions or final agent prompts.

## Policy Engine files

- `policy-engine-contract.schema.json` — canonical request, effective capability profile, decision, required controls and trace.
- `autonomy-monotonicity-vectors.json` — executable test vectors for all six level transitions and critical safety invariants.

## Manager runtime files

- `manager-runtime-contract-v1.md` — Step 6 role, task graph, artifact, critic, conflict, recovery and scenario boundary.
- `manager-runtime-conflict-validation-v1.md` — conflict lifecycle and manager-only arbitration boundary.
- `manager-runtime-context-materialization-v1.md` — task, role, memory, data-class and source materialization boundary.
- `manager-runtime-checkpoint-validation-v1.md` — project/task checkpoint validation without restored authority.
- `manager-runtime-task-readiness-v1.md` — pure dependency readiness derivation.
- `manager-runtime-artifact-provenance-v1.md` — closed same-project provenance graph validation.
- `manager-runtime-artifact-task-binding-v1.md` — artifact binding to graph, task, role, inputs, output kind and chronology.
- `manager-runtime-scenario-runner-v1.md` — deterministic assertion-to-observation release gate.
- `manager-runtime-suite-runner-v1.md` — aggregate fail-closed release verdict for one runtime increment.
- `packages/contracts/src/manager-runtime*.ts` — TypeBox schemas, canonical catalogs and semantic validators.
- `packages/core/src/manager-runtime*.ts` — deterministic readiness and scenario gate evaluators.
- `packages/contracts/test/manager-runtime*.test.ts` and `packages/core/test/manager-runtime*.test.ts` — executable contract coverage.

## Policy evaluation order

1. Resolve the effective level for the requested capability.
2. Apply immutable legal and system-core limits.
3. Apply the owner mandate and explicit capability constraints.
4. Validate permission freshness and revision.
5. Reserve money and tokens atomically when applicable.
6. Apply idempotency, recipient, data-rights and step-up controls.
7. Return one explicit outcome and reason codes.
8. Write Decision Trace without hidden chain-of-thought.

A higher pure autonomy level may remove product confirmations but may not bypass law, the immutable core, an explicit owner constraint, emergency stop, or integrity controls required to prevent duplicate or inconsistent execution.

Manager runtime contracts add no new authority. They define how roles exchange bounded artifacts and which system scenarios must pass before later runtime increments can ship.
