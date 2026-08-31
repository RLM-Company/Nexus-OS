# Control Center confirmation decisions review

Date: 2026-08-31

## Outcome

Adds the second write-enabled owner action to roadmap Step 5: reviewing, approving and rejecting pending Policy Runtime confirmations from the Control Center.

Each pending card now exposes the information required for a decision:

- requested capability action;
- goal and affected objects;
- policy risk explanation;
- expected effect;
- decision expiry;
- whether critical approval requires step-up.

The owner must open one decision at a time and acknowledge that the action, goal, objects, risk and expiry were reviewed. Rejection additionally requires a reason. Critical approval additionally requires a transient step-up token.

## Safety boundary

- The browser sends the server-issued challenge nonce back to the existing approve or reject endpoint.
- The API remains authoritative for owner/project isolation, nonce validity, expiry, already-decided conflicts and step-up proof consumption.
- Confirmation state is not changed optimistically; the card moves to history only after the API returns the decided confirmation.
- Step-up is sent only for critical approval. Rejecting a critical request never requires or consumes the proof.
- The transient token is cleared after every decision attempt and is never rendered in history.
- Profile writes, confirmation decisions and emergency-stop actions cannot run concurrently in this screen.
- Emergency-stop mutation remains outside this increment.

## Acceptance evidence

API coverage proves that a critical confirmation can be rejected with an auditable owner reason without consuming step-up proof. Existing API coverage continues to prove nonce enforcement and verified step-up for critical approval.

The browser scenario uses deterministic network fixtures for two confirmation cards while keeping the real Control Center and project/profile endpoints. It verifies the exact approve payload and step-up header, verifies that reject sends a reason without a step-up header, and checks that only server-confirmed results move from pending cards into APPROVED and REJECTED history.

Full repository CI is required before merge.
