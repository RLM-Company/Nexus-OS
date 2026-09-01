# Control Center Policy Decision Trace review

Date: 2026-09-01

## Outcome

Adds the next bounded roadmap Step 5 slice: an owner-facing Policy Decision Trace in the Autonomy
Control Center. The trace reads the append-only `policy_decisions` records already written by
Policy Runtime and explains the newest `ALLOW`, `ALLOW_WITH_LIMITS`, `NEEDS_CONFIRMATION`,
`DENY` and `PAUSE` verdicts without exposing operation content.

This is distinct from Agent Studio's mutation trace. Agent Studio records which versioned
control-plane object changed; this screen explains why Policy Runtime allowed, limited, paused,
denied or requested confirmation for an operation.

## Safety boundary

- The route is owner-only and first verifies that the selected project belongs to the authenticated
  owner. A cross-owner request receives the same project-not-found response.
- Reads are bounded to an integer limit of 1–100, with 50 used by the Control Center.
- The response is a strict projection containing only decision, operation, project and actor IDs;
  capability IDs; exact object references; verdict; reasons; policy version; and timestamps.
- Purpose, idempotency keys, evaluated grants, permission IDs, request/result payloads, prompts,
  task content and secrets remain outside the response contract.
- Stored intent/verdict/project/operation bindings are revalidated while reading. Corrupt or
  inconsistent rows fail closed instead of being partially rendered.
- Exact idempotency replay does not create another decision event.
- This read-only slice adds no activation, retry, resume, model, tool or external-effect path.

## Acceptance evidence

Contract coverage rejects unexpected content fields. Database coverage verifies newest-first
ordering, the 1–100 bound, content minimization, replay deduplication and the final deny record after
an owner rejection.

API coverage verifies the strict response, invalid-limit rejection and owner/project
non-disclosure. The browser scenario verifies understandable verdict labels, reasons, capability
and object references, actor/operation identity, policy version and defense-in-depth non-rendering
of unexpected hidden fields.

Full repository CI is required before merge.
