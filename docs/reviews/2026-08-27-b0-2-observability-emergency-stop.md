# B0.2 review: observability and emergency stop

**Date:** 2026-08-27  
**Status:** implementation candidate

## Scope

This increment adds the operational safety slice required before broader real-provider testing:

- content-free process-lifetime counters for runs, route attempts, failures, cancellation, and
  circuit-open rejections;
- structured logs with run/project correlation, registry route, attempt, normalized error code,
  usage, and calculated cost;
- derived critical/warning alerts exposed through `GET /api/v1/operations/status`;
- migration `0007` and an owner-bound store for durable process/project emergency stops;
- `POST /api/v1/operations/emergency-stop` as an activation-only, fail-closed control;
- immediate interruption of matching active runs and pre-route rejection of queued runs;
- atomic `EMERGENCY_STOP` terminal state across run, assistant message, and reserved/interrupting
  Usage Ledger attempts;
- startup activation through `RUNTIME_EMERGENCY_STOP=true`.

## Safety boundaries

- Metrics and logs never include prompts, response deltas, credentials, headers, or user content.
- A project stop can target only a project inside the current owner boundary.
- A process stop takes precedence over a project stop and survives restart.
- The public runtime API can activate but cannot clear a stop. Resume is deferred until owner
  identity and step-up verification provide an auditable recovery authority.
- Emergency stop does not bypass the existing Policy Engine; it only removes execution authority.

## Verification

Automated coverage proves:

- clean/repeated migration and persistence across database reopen;
- process-stop precedence, project ownership isolation, and internal audited clearing primitives;
- queued-run rejection before any route attempt;
- active-stream interruption with durable `EMERGENCY_STOP` accounting;
- operational counters and alert derivation;
- strict configuration and transport-schema validation.
- a restart-level incident drill that proves the durable process stop blocks a previously queued
  run before route selection or Usage Ledger reservation.

## Remaining B0.2 work

- exact official VibeCode model limits and contractual privacy before registry activation;
- production Secret Manager integration;
- a real provider route with verified required capability contracts. The configured VibeCode route
  failed both authorized structured-output and forced-tool probes.

The provider-neutral acceptance gate and durable incident drill are closed in
[the B0.2 acceptance review](2026-08-27-b0-2-acceptance.md); the full stage exit remains open.
