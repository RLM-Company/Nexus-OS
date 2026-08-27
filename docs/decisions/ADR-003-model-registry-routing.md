# ADR-003: Versioned Model Registry and deterministic routing

**Date:** 2026-08-24  
**Status:** ACCEPTED / RUNTIME INTEGRATION IN REVIEW

## Context

Provider configuration currently chooses one adapter and one model directly from environment
variables. That is sufficient for B0.1, but it cannot safely select models by role, task,
confidentiality, capability, context, latency, quality, or budget. Provider-specific data must also
stay outside the web application and Manager prompt.

## Decision

Cosmora uses a versioned, secret-free Model Registry as the only source of routing metadata. Every
entry has a stable provider/model identity, aliases, protocol, capabilities, context/output limits,
quality and latency tiers, optional pricing, privacy declarations, and evidence source.

The Router applies hard filters before scoring:

1. active status and role/task scope;
2. explicit provider and alias constraints;
3. required capabilities;
4. confidential compatibility with declared no-training use and known retention;
5. context and output limits;
6. known price inside the request budget.

If a hard filter removes every candidate, routing fails closed with a distinct machine-readable
reason. Scoring is deterministic and used only among candidates that already satisfy every hard
constraint. Ties are resolved by stable provider/model identity.

## Security and data rules

- The registry never stores API keys, authorization headers, cookies, or account secrets.
- Unknown privacy or price data cannot satisfy confidential or cost-limited requests.
- Discovery data is accepted only from an owner-authorized provider endpoint or documentation.
- An active external route must carry a non-empty evidence reference and verification timestamp,
  an explicit `valid_until`, use `source.kind = authorized_discovery`, and support the Gateway
  streaming contract. The registry constructor rejects activation otherwise and also fails startup
  once the evidence window expires.
- Catalog availability and pricing are point-in-time evidence, not permanent model properties.
  A refresh creates a new registry version; a missing model is disabled rather than silently
  replaced by a similarly named route.
- `confidential_compatible = true` is valid only with declared no-training use and known
  retention; contradictory declarations invalidate the registry instead of silently degrading.
- UI code cannot import Model Gateway or provider adapters.
- Runtime integration must record registry version, provider, model, estimated cost, and final usage
  in the Decision Trace/Usage Ledger.

## Consequences

The bootstrap registry contains only the deterministic mock model. A VibeCode entry is not invented
from assumptions: it remains absent until authorized discovery provides exact model IDs,
capabilities, limits, pricing, and data-policy evidence.

The B0.2 runtime integration resolves every provider attempt through the Router, verifies that the
configured adapter identity and model exactly match the selected registry entry, and fails closed
when they do not. Route attempts are reserved in `model_usage_ledger`; final model, upstream token
usage, and calculated cost are committed atomically with successful run completion. Failed,
cancelled, and restart-interrupted attempts receive terminal ledger states.
