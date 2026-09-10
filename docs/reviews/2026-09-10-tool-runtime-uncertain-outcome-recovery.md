# Tool Runtime uncertain-outcome recovery hardening

**Date:** 2026-09-10  
**Scope:** post-reservation Tool Runtime failure semantics  
**Status:** implementation complete; full repository CI required before merge

## Finding

Tool Runtime reserves an operation before calling its handler. At that point a finite override or
one-use permission is already consumed and the external effect may begin. The previous catch path
converted every handler or result-persistence exception to durable `FAILED`.

That state was safe from automatic retry, but it incorrectly implied a known failure and removed
the operation from the owner-visible `RECOVERY_REQUIRED` queue. The runtime cannot infer that no
external effect occurred merely because the handler threw or the returned value could not be
persisted.

## Resolution

Every exception after successful atomic reservation is now treated as an unknown outcome:

- the durable operation remains `RESERVED`;
- the invocation returns `RECOVERY_REQUIRED`;
- consumed finite authority is not restored;
- a duplicate invocation resolves from persisted state and does not call the handler again;
- the existing read-only reconciliation queue exposes the operation to the owner without adding
  retry, resume, success or failure controls.

This is deliberately conservative. A future known-no-effect failure path would require an explicit
tool error contract that proves the external effect did not start; no such contract exists today.

## Regression evidence

Tool Runtime tests cover both ambiguous paths:

1. the handler rejects after reservation;
2. the handler returns successfully, but its cyclic result cannot be serialized for durable
   completion.

Both cases remain `RESERVED`, appear in `listRecoveryRequired`, return `RECOVERY_REQUIRED` on the
first and duplicate invocation, consume finite authority only once and call the handler only once.

Targeted Tool Runtime tests, lint and strict TypeScript checks pass. Full repository `pnpm check`,
including API, builds and Playwright Chromium, remains the merge gate.

## Preserved boundaries

- No external operation is executed by these tests.
- No blind retry or inferred reconciliation result is added.
- No Manager Console/runtime-flow code or Manager prompt is changed.
- No provider, paid probe, finance/production effect or A6 activation is introduced.
