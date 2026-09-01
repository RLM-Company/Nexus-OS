# Control Center emergency-stop activation review

Date: 2026-09-01

## Outcome

Adds the third write-enabled owner action to roadmap Step 5: activating a durable emergency stop
for the selected project or for the full API process from the Autonomy Control Center.

The owner must select the exact scope, enter a bounded reason and acknowledge the effect before the
action is enabled. The UI sends the existing server contract and displays an active stop only after
the API confirms it. A project-bound read endpoint restores the selected project's stop after a
reload without exposing another owner's project state.

## Safety boundary

- Project activation always sends the currently loaded owner-bound project ID; process activation
  omits `project_id` entirely.
- The API remains authoritative for owner/project isolation and persists the stop before returning.
- Emergency-stop activation reduces authority and remains available without step-up proof.
- Profile writes, confirmation decisions and stop activation cannot run concurrently in the
  Control Center.
- Active and queued runs retain the existing fail-closed interruption before route selection and
  Usage Ledger writes.
- No resume, clear or retry action is added. Recovery remains a separate audited operator flow.
- The process-stop browser branch uses a deterministic network fixture so the shared test runtime
  is not left globally stopped.

## Acceptance evidence

API coverage proves that an owner can read the durable stop for an owned project while another
owner receives only `null`, preserving the non-disclosure boundary.

The browser scenarios prove that project activation stays disabled until a reason and explicit
acknowledgement exist, persists through reload and exposes no resume control. A separate isolated
scenario proves that process activation sends `scope: process` without a project ID and updates only
from a server-confirmed response.

Full repository CI is required before merge.
