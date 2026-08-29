# Agent Studio content-free Decision Trace review

**Date:** 2026-08-29  
**Scope:** atomic owner control-plane change history  
**Runtime status:** not activated

## Implemented

- Append-only project Decision Trace events for function, pattern, blueprint and root-proposal API
  mutations.
- One bounded owner-only read route returning the 1–100 newest events.
- Exact object type, object ID and immutable version/revision marker in every event.
- Ambient-transaction support so version stores join the event transaction instead of committing
  separately.
- Content-free storage: no request body, instructions, result contract, prompt or task text.

## Verified invariants

- Fresh creates, immutable versions, first archive and root proposal each produce one event.
- Exact idempotency replays and repeated archive calls do not produce duplicate events.
- A failure after a domain write rolls back both the domain change and its event.
- Owner/project binding is enforced by query filters and a composite database foreign key.
- Cross-owner reads return project-not-found and agent sessions remain outside the owner API.
- Response contracts reject unexpected content fields.

## Deliberately absent

- delegated proposals and Policy Engine delegation over HTTP;
- activation or any later lifecycle transition;
- runtime/model/tool/network events and external actions;
- full request bodies, prompt text, secrets and user task content;
- UI and production deployment.

The Decision Trace answers who changed which control-plane object and version. It cannot execute
that object or reveal its content.
