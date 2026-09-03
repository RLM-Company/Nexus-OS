# Control Center finite-use point overrides

**Date:** 2026-09-03  
**Status:** `IMPLEMENTED / PREVIEW-FIRST / RUNTIME-ENFORCED`  
**Roadmap:** Step 5 — finite point-override owner control

## Outcome

The owner can explicitly create or edit `remaining_uses` for an object-scoped point override.
Blank means `null` and is shown as no counter; the UI never invents a default. A supplied value
must contain decimal digits only and resolve to a safe integer of at least one before any request
is sent.

The existing server preview remains authoritative. Its exact override diff now includes
`Использования` with the stored and proposed values. Apply still requires acknowledgement of the
capability modes, exact objects, purpose, expiry and counter, and still uses optimistic profile
versioning plus the existing step-up rules.

## Enforcement boundary

This UI does not emulate or decrement the counter. Policy Store consumes a selected finite use in
the same transaction as permission consumption and operation reservation. Last use removes the
override; replay and `RECOVERY_REQUIRED` resolve before consumption; uncertain external failure
does not restore authority.

## Evidence

API coverage rejects zero and preserves a finite value through preview and apply. The browser
scenario proves the counter starts blank, creates a value of two, renders `— → 2`, persists it,
loads the stored value for editing, renders `2 → 1`, applies the new profile version and removes
the override through a final acknowledged preview.

No migration, provider probe, model call, external effect or production configuration is added.
