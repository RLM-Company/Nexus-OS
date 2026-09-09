# Policy profile base grant integrity hardening

Date: 2026-09-09
Status: `SECURITY HARDENING / FAIL-CLOSED`

## Problem

The Policy Engine previously required exactly one base grant per requested capability, but it trusted the grant's stored `mode` without verifying that the mode matched the profile's declared `base_level` in the canonical `AUTONOMY_MATRIX`.

A structurally valid but corrupted or tampered profile could therefore claim a low autonomy level while embedding a more permissive base grant. Conversely, silent restrictive drift in a base grant could create policy behavior that no longer matched the owner-visible A-level.

## Invariant

For every requested capability:

`baseGrant.mode === AUTONOMY_MATRIX[capabilityId][profile.base_level]`

Any mismatch is ambiguous authority and must fail closed with `PAUSE`; the evaluated capability is returned as `DENY`.

Legitimate changes in authority remain separate mechanisms:

- capability permissions;
- named conditional expansions;
- point overrides.

This hardening does not activate A6, widen any capability, or add an execution path.

## Regression coverage

The focused tests cover:

- an A0 profile tampered to contain `finance.credit=FULL`;
- an A5 profile with a silently altered restrictive base mode;
- a legal restrictive point override;
- a legal bounded permission expansion.

The repository-wide `pnpm check` remains the merge gate.
