# Autonomy Control Center overview review

Date: 2026-08-31

## Outcome

Adds the first UI slice of roadmap Step 5: a read-only owner view of the existing Policy Runtime.

For one owner-visible project the screen reads and presents:

- canonical A0–A6 capability profile and profile version;
- all canonical capability grants and their effective modes;
- active point overrides;
- pending confirmation cards and completed confirmation history;
- step-up requirement visibility on pending confirmations;
- global runtime operations snapshot, process emergency-stop state, project-stop count, run metrics and content-free alerts.

## Safety boundary

This increment intentionally has no policy mutation controls.

- It cannot update A0–A6 or overrides.
- It cannot approve or reject confirmations.
- It cannot activate emergency stop.
- It cannot issue a permission, start an agent, call a model/tool/provider, spend money, communicate externally or deploy production state.
- The API remains the source of truth for owner/project isolation and Policy Runtime state.

The purpose of the split is to make the actual policy state observable before adding owner actions in a later, separately reviewed increment.

## Browser acceptance

The e2e scenario creates an isolated project, updates it through the already-tested API to A3, opens the Control Center, verifies the 19-capability profile and runtime state, confirms that no approve/reject/emergency action buttons exist, then re-reads the profile to prove the page did not mutate it.

Full repository CI is required before merge.
