# Policy Engine contracts

Status: `IMPLEMENTATION DRAFT / NOT RUNTIME`  
Version: `1.0.0`  
Constitution baseline: `OWNER APPROVED v1.1`

This package translates the approved A0–A6 specifications into machine-readable inputs and decisions without changing the constitutions.

## Files

- `policy-engine-contract.schema.json` — canonical request, effective capability profile, decision, required controls and trace.
- `autonomy-monotonicity-vectors.json` — executable test vectors for all six level transitions and critical safety invariants.

## Evaluation order

1. Resolve the effective level for the requested capability.
2. Apply immutable legal and system-core limits.
3. Apply the owner mandate and explicit capability constraints.
4. Validate permission freshness and revision.
5. Reserve money and tokens atomically when applicable.
6. Apply idempotency, recipient, data-rights and step-up controls.
7. Return one explicit outcome and reason codes.
8. Write Decision Trace without hidden chain-of-thought.

A higher pure autonomy level may remove product confirmations but may not bypass law, the immutable core, an explicit owner constraint, emergency stop, or integrity controls required to prevent duplicate or inconsistent execution.

## Next implementation step

Add a deterministic evaluator and CI tests that validate this schema, all vectors, permission revocation, hybrid profiles and concurrent ledger behavior.
