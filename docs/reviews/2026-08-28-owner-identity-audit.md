# B0.3 review — owner identity audit API

Date: 2026-08-28  
Scope: bounded visibility of existing identity lifecycle audit

## Contract

`GET /api/v1/identity/audit-events?limit=N` returns the newest identity audit events for the
verified owner. `limit` defaults to 50 and is restricted to 1–100.

The response reuses the provider-neutral audit contract: event ID, owner/actor/session IDs, event
type, outcome, reason code and timestamp. It contains no bearer token/hash, step-up token/hash,
challenge, prompt, model response or user content.

## Invariants

- The common owner-only API boundary authenticates and authorizes the caller first.
- SQL always filters by the verified `owner_id`; clients cannot supply another owner.
- Ordering is deterministic: newest timestamp first, then newest SQLite row.
- The store rejects invalid/unbounded limits even if called outside HTTP.
- API validation rejects values above 100.
- Owner isolation and token absence are covered by API tests.

## Deferred

This is recent operational visibility, not a complete compliance export. Cursor pagination,
retention policy, download/export and UI presentation belong to the later control-center/data
governance work.
