# Policy verdict-to-intent binding hardening

**Date:** 2026-09-10  
**Scope:** PolicyStore decision and reservation boundaries  
**Status:** implementation complete; full repository CI required before merge

## Finding

PolicyStore validated stored policy JSON while reading it, and atomic reservation already checked an
operation ID. The write boundary still accepted several internally inconsistent combinations:

- a confirmation verdict could name another operation or another capability;
- a blocked-operation status could disagree with the verdict kind;
- an allowed verdict could omit, duplicate or replace a requested capability;
- a verdict kind could disagree with the strictest evaluated capability mode;
- a confirmation or blocked decision could be recorded before its evaluation time.

These states should never be produced by Policy Engine, but accepting them at the persistence
boundary weakens defense in depth. Some combinations only failed later during readback; others could
produce a contradictory durable audit record.

## Resolution

Before any confirmation or blocked decision is written, PolicyStore now requires:

1. the intent and verdict to pass their runtime schemas;
2. an exact operation-ID match;
3. exactly one evaluated grant for every requested capability, with no omissions, substitutions or
   duplicates;
4. a verdict kind consistent with the evaluated modes (`PAUSE` remains the explicit fail-closed
   exceptional kind);
5. the method-specific verdict kind (`NEEDS_CONFIRMATION`, `DENY` or `PAUSE`);
6. a record timestamp at or after the verdict evaluation timestamp.

Confirmation TTL must also be a positive safe integer. Atomic allowed reservation applies the same
schema, operation, capability and verdict-kind checks inside its transaction and returns
`AUTHORITY_CHANGED` before authority is consumed when they fail.

## Regression evidence

Database tests cover foreign operation IDs, substituted capabilities, inconsistent verdict modes,
backwards decision time, zero confirmation TTL, blocked-status mismatch and invalid allowed
reservations. Every rejected case leaves operations, confirmations and Decision Trace empty.

Targeted database tests, lint and strict TypeScript checks pass locally. The branch must still pass
the repository's complete `pnpm check`, including browser acceptance, before merge.

## Preserved boundaries

- This does not change the Manager Console/runtime flow or finalize its system prompt.
- It does not activate A6 or choose/configure a production model provider.
- It creates no recovery action, automatic retry, finance action or external effect.
- It narrows accepted internal state and does not expand authority.
