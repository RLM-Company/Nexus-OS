# B0.2 review: Model Gateway reliability

**Date:** 2026-08-26  
**Status:** CANDIDATE / CI PENDING

## Scope

- retry only normalized retryable failures and only before the first provider text delta;
- limit attempts per registry route and apply bounded exponential backoff;
- keep cancellation active while waiting for the next attempt;
- apply the request timeout independently to each provider attempt;
- assign a monotonically increasing attempt number across retries and fallback routes;
- persist every selected attempt and its terminal error in the Usage Ledger;
- open an in-memory circuit for the exact `provider_id:model_id` route after a configured failure
  threshold;
- skip provider invocation while the circuit is open and record `CIRCUIT_OPEN` explicitly;
- permit one half-open probe after cooldown and close the circuit only after a valid completion;
- expose bounded reliability settings through validated server configuration.

## Safety properties

1. Provider output from different attempts is never combined.
2. A retry or fallback cannot start after any provider text was emitted.
3. Non-retryable errors are not retried.
4. Cancellation cannot open a new provider attempt and interrupts retry backoff.
5. A circuit is isolated to one registry provider/model pair, not an entire provider family.
6. Circuit state does not bypass Router capability, privacy, context, or budget checks.
7. Every selected retry, circuit-blocked route, and fallback has a distinct ledger attempt number.
8. Reliability configuration is bounded and fails startup when malformed.

## Verification

- retry-then-success with attempt sequence `0 → 1`;
- no retry after partial output or a non-retryable failure;
- cancellation before stream creation;
- circuit open, provider suppression, cooldown probe, and recovery;
- fallback remains registry-backed;
- API persistence of two failed retries as two Usage Ledger rows;
- configuration default, override, and invalid-bound tests;
- full monorepo formatting, secret scan, lint, typecheck, unit/API tests, production builds, and
  browser acceptance gate.

## Explicitly deferred

- durable/distributed circuit state across multiple API processes;
- jitter and provider-specific `Retry-After` handling;
- metrics exporter and alert thresholds;
- process-wide and project-scoped emergency stop;
- committing a real VibeCode registry entry without authoritative model metadata;
- structured-output and tool-calling acceptance against a real provider.
