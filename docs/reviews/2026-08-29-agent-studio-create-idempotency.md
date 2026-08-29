# Agent Studio create idempotency review

**Date:** 2026-08-29  
**Scope:** durable replay protection for fresh owner catalog creates  
**Runtime status:** not activated

## Implemented

- Required `Idempotency-Key` header for function, pattern and blueprint creation.
- A project/owner-bound SQLite mutation ledger with canonical request SHA-256.
- Atomic domain create and result-reference persistence in one immediate transaction.
- Exact replay returning the original immutable object with an explicit replay response header.
- Typed conflict when one key is reused for another operation or request body.

## Verified invariants

- A replay after closing and reopening the database does not execute the create callback again.
- JSON object key order does not change request identity.
- The ledger contains no pattern instructions, prompt text or full request payload.
- A failure after a domain insert rolls the insert and mutation record back together.
- The composite database foreign key prevents a mutation record from crossing owner/project.
- Missing keys fail request validation before a catalog write.
- Version writes still use transactional `expected_version`; archive is idempotent by design.

## Deliberately absent

- root or delegated proposal HTTP writes;
- idempotency around network calls or external side effects;
- activation and lifecycle transitions;
- executable prompt composition;
- provider/model routing, paid calls, tools and external actions;
- UI and production deployment.

The mutation ledger is intentionally restricted to local database catalog creation. Reusing it for
future external effects requires a separate outbox/execution design and is not authorized here.
