# Constitution implementation contracts

Status: `IMPLEMENTATION CONTRACTS / NOT RUNTIME`  
Constitution baseline: `OWNER APPROVED v1.1`

This directory translates approved Cosmora specifications into machine-readable implementation boundaries without changing the constitutions or final agent prompts.

## Policy Engine files

- `policy-engine-contract.schema.json` — canonical request, effective capability profile, decision, required controls and trace.
- `autonomy-monotonicity-vectors.json` — executable test vectors for all six level transitions and critical safety invariants.

## Manager runtime files

- `manager-runtime-contract-v1.md` — Step 6 role, task graph, artifact, critic, conflict and scenario boundary.
- `packages/contracts/src/manager-runtime.ts` — TypeBox runtime schemas and structural validators.
- `packages/contracts/src/manager-runtime-scenarios.ts` — the mandatory machine-readable Step 6 scenario catalog.

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
