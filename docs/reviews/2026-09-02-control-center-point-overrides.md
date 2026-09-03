# Control Center point-override editor

**Date:** 2026-09-02  
**Status:** `IMPLEMENTED / OWNER-ONLY / PREVIEW-FIRST / VERSIONED`  
**Roadmap:** Step 5 — A0–A6 profile and point overrides

## Outcome

The Autonomy Control Center now creates, edits and removes object-scoped capability overrides
through the existing owner-bound profile API. No mutation is submitted directly from the editor.
Every candidate is first sent to the server preview, rendered as an exact added, updated or removed
diff, acknowledged by the owner and then applied against the previewed profile version.

The editor does not silently choose a capability or mode. It requires at least one exact object ID
and a purpose, preserves a stable override ID while editing and converts an optional local expiry to
an explicit timestamp. A missing expiry remains `null`; it is not replaced with an invented date.

## Authority boundary

- canonical grants remain server-generated from the selected A0–A6 level;
- the client can submit only `base_level`, strict overrides and `expected_version`;
- another owner's project remains project-not-found;
- stale previews fail with a profile version conflict;
- A6, every `FULL` override and critical capability expansion require a bound one-time step-up
  proof before apply;
- a restrictive removal does not require step-up when no remaining proposed authority triggers it;
- the token is never persisted and is cleared after the request.

## Finite-use boundary

Tool Runtime now atomically validates and consumes stored finite-use overrides with the policy
operation reservation, as reviewed separately in
`2026-09-02-finite-override-consumption.md`. Idempotent replay does not consume another use, and the
last use removes the override from the next versioned profile.

The editor now creates and alters a finite-use value as a separate tested slice. Blank remains an
explicit `null` with no hidden default; a supplied value must be a safe positive integer. The
server preview shows the exact before/after counter and apply remains version-checked and
owner-acknowledged. Browser and API evidence are recorded in
`2026-09-03-control-center-finite-overrides.md`.

Expiration remains enforceable: Policy Engine ignores an override after its valid timestamp. The
editor rejects invalid or already elapsed new timestamps before preview.

## Evidence

API coverage verifies that preview does not mutate the stored profile, `FULL` is denied without
step-up, the verified apply persists the exact override and a restrictive removal succeeds without
consuming another proof. The browser scenario proves empty capability and mode choices remain
empty, renders the exact object/mode/purpose diff, applies the versioned profile, reloads the stored
shape and removes the override through a second acknowledged preview.

## Step 5 status

The owner-facing A0–A6 profile, point overrides, confirmations and history, Decision Trace, usage
and hard limits, emergency stop and explicit `RECOVERY_REQUIRED` visibility are all present. This
closes the Step 5 UI slice; it does not activate a Manager or external tool loop.
