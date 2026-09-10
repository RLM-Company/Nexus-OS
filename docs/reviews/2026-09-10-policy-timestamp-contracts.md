# Policy timestamp contract hardening

**Date:** 2026-09-10  
**Scope:** authority-bearing policy transport and persistence schemas  
**Status:** implementation complete; full repository CI required before merge

## Finding

Cosmora already defines a canonical UTC ISO timestamp schema, but policy contracts used generic
non-empty strings for authority windows and audit chronology. A malformed value could therefore
pass transport/schema validation and reach date parsing or SQLite time comparisons later in the
runtime.

Affected fields included:

- point-override expiry and capability-profile issue time;
- permission validity and approval time;
- policy verdict evaluation time;
- Decision Trace evaluation/creation time;
- recovery reservation time;
- confirmation request, expiry and decision time.

Runtime checks already fail closed in many malformed-date paths, but accepting invalid authority
data at the contract boundary creates inconsistent behavior and unnecessary persistence risk.

## Resolution

Every policy timestamp field now uses the shared `IsoDateTimeSchema`. Nullable time fields retain
`null`, while present values must be UTC ISO timestamps in the repository's canonical seconds or
millisecond form.

This is a validation-only narrowing. It does not change valid generated data because server clocks
use `Date.toISOString()` and existing deterministic fixtures already use supported UTC ISO values.

## Regression evidence

Contract tests reject malformed timestamps in:

- capability-profile issue time;
- point-override expiry;
- verdict evaluation time;
- permission validity and approval time;
- confirmation expiry.

The full local gate through production build passes: formatting, secret scan, 9/9 lint, 9/9 strict
TypeScript, all monorepo unit/API tests and 9/9 builds. Full GitHub `pnpm check`, including
Playwright Chromium, remains the merge gate.

## Preserved boundaries

- No policy authority is expanded.
- No Manager Console/runtime-flow or Manager prompt code is changed.
- No provider, paid probe, external effect, finance/production action or A6 activation is added.
