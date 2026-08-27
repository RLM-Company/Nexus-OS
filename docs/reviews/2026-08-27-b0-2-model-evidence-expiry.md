# B0.2 review: expiring model evidence

**Date:** 2026-08-27  
**Status:** implementation candidate

## Trigger

The owner reported that VibeCode prices change and that Kimi disappeared from the current catalog.
The existing `verified_at` field preserved evidence age but did not stop an old price or availability
claim from remaining routable indefinitely.

## Delivered

- every Model Registry source now carries `valid_until`, including `null` for non-expiring static
  fixtures such as the local mock adapter;
- an active external route must use authorized discovery and provide a non-null evidence expiry;
- `valid_until` must be later than `verified_at`;
- registry construction fails closed when external evidence is expired;
- the clock is injectable for deterministic boundary tests;
- public catalog prices and `Online` status are explicitly recorded as point-in-time evidence;
- disappearance never triggers name-based substitution: refresh must disable the exact route.

## Safety boundary

This increment does not scrape VibeCode, add Kimi, activate any external model, choose a refresh
cadence, or make a provider request. The owner-reported Kimi disappearance is not independently
machine-verifiable from the supplied screenshot set and is recorded with that limitation.

Production discovery must choose a short validity window appropriate to the provider's volatility
and refresh before expiry. If refresh fails, startup/routing remains unavailable instead of using
stale price or availability evidence.

## Verification

Tests cover missing expiry, expired evidence, reversed evidence windows, static mock compatibility,
schema validation, and the existing Router/Gateway behavior.
