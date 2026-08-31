# Autonomy profile preview and apply review

Date: 2026-08-31

## Outcome

Adds the first write-enabled owner action to roadmap Step 5: changing a project's canonical A0–A6 profile from the Control Center.

The action is deliberately split into two server-authoritative stages:

1. `POST /api/v1/projects/:projectId/autonomy-profile/preview` builds the proposed canonical profile and reports whether step-up is required without persisting anything.
2. The owner sees every capability mode that will change, acknowledges the diff and applies the proposal through the existing version-checked `PUT` endpoint.

The UI updates its displayed profile only after the API confirms the write.

## Safety boundary

- Preview and apply are restricted to a project owned by the current identity.
- Preview fails closed when `expected_version` is stale.
- Apply retains the existing optimistic version check, so a preview cannot overwrite a newer profile.
- A6 and qualifying high-risk overrides still require a verified step-up proof at the mutation endpoint.
- The transient step-up token is sent only with the apply request and cleared immediately afterward.
- Preview does not consume step-up proof and does not persist a profile, confirmation, permission, operation or audit event.
- Confirmation approve/reject and emergency-stop mutation controls remain outside this increment.

## Acceptance evidence

API coverage proves that an A4 preview proposes the next canonical version while the stored profile remains unchanged, reports step-up for A6, does not consume proof and rejects a stale version.

The browser scenario starts from A3 profile v2, requests an A4 preview, verifies the `finance.spend` authority change, re-reads the API to prove preview is non-mutating, acknowledges and applies the proposal, then verifies A4 profile v3 in both the UI and API. It also preserves the absence of confirmation and emergency-stop action buttons.

Full repository CI is required before merge.
