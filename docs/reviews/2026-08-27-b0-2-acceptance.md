# B0.2 acceptance and incident drill

**Date:** 2026-08-27  
**Provider-neutral runtime:** ACCEPTED  
**External VibeCode route:** REJECTED  
**B0.2 stage exit:** OPEN

## Decision

The provider-neutral B0.2 runtime is accepted as a safe foundation. The external VibeCode route is
not accepted and remains absent from the active Model Registry. The B0.2 milestone therefore does
not meet its full exit criterion yet: Cosmora has verified real-provider streaming connectivity,
but it does not have a registry-eligible real route with complete limits, privacy evidence, and the
required capability contracts.

This split decision prevents a successful transport smoke check from being misreported as
production-route acceptance.

## Accepted controls

- every runtime attempt is selected from the versioned Model Registry through the deterministic
  Router;
- capability, confidentiality, context, output, and hard-budget mismatches fail before provider
  access;
- retry, fallback, timeout, and exact-route circuit behavior are bounded and separately accounted;
- the Usage Ledger reserves, commits, or fails every selected attempt atomically;
- credentials cross only the server-side `SecretResolver` boundary immediately before adapter
  construction;
- active external entries require authorized-discovery evidence, verification time, and streaming;
- content-free operational metrics and alerts expose route and runtime failures without prompts,
  response deltas, or secrets;
- process/project emergency stops block queued runs and interrupt active runs.

## Durable incident drill

The automated drill creates a queued run, activates the process emergency stop, closes the API and
SQLite connection, reopens the same database, and requests the queued stream after restart.

Required outcome:

1. the stop remains active after restart;
2. the run terminates with `EMERGENCY_STOP`;
3. no model route is selected and no Usage Ledger attempt is created;
4. operational status reports zero active runs, zero route attempts, one failed run, and the
   process-stop alert.

The drill is implemented in `apps/api/test/b0-2-incident-drill.test.ts` and passes deterministically
without a provider credential or network call.

## Rejected external-route evidence

The configured `claude-sonnet-5` VibeCode route passed authentication and streaming transport, but
both separately authorized contract probes failed:

- strict structured output returned HTTP 200 without schema-conforming output;
- forced tool calling returned HTTP 200 without the required schema-valid `tool_use` block.

The public privacy statements also conflict, and exact context/output limits, upstream training
use, regional processing, and contractual retention remain unknown. No registry values may be
invented from public naming, prices, or a successful text stream.

## Remaining stage-exit gates

1. Obtain authoritative, secret-free model limits and contractual privacy/retention/training
   evidence for a candidate route.
2. Select a candidate whose required capability contracts are verified, or explicitly narrow the
   product contract before activation.
3. Choose production hosting and its managed Secret Manager backend.
4. Add the route through a separate reviewed registry change and rerun this acceptance gate.

No additional paid provider call is authorized by this review.
