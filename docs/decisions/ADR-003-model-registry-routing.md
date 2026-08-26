# ADR-003: Versioned Model Registry and deterministic routing

**Date:** 2026-08-24  
**Status:** PROPOSED / IMPLEMENTED IN B0.2 CANDIDATE

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
- UI code cannot import Model Gateway or provider adapters.
- Runtime integration must record registry version, provider, model, estimated cost, and final usage
  in the Decision Trace/Usage Ledger.

## Consequences

The bootstrap registry contains only the deterministic mock model. A VibeCode entry is not invented
from assumptions: it remains absent until authorized discovery provides exact model IDs,
capabilities, limits, pricing, and data-policy evidence. The existing B0.1 provider path continues
to work until the registry-backed route is integrated behind the same `ModelRequest` boundary.
