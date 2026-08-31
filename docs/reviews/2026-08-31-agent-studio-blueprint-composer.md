# Agent Studio blueprint composer review

Date: 2026-08-31

## Outcome

Agent Studio can now create immutable agent blueprints and create later blueprint versions through the existing owner-only Agent Studio API.

The composer binds exact current function and behavior-pattern versions, keeps archived patterns out of new compositions, prefilters behavior patterns by their declared `allowed_function_ids`, and captures the complete persisted blueprint contract: model profile reference, declared grant, budget, delegation depth, validity, memory scope, task contract, start condition, and close conditions.

## Safety boundary

This increment remains control-plane only.

- A saved blueprint is inert persisted data.
- `grant` in the blueprint is a declared future boundary, not an issued runtime permission.
- No proposal is activated.
- No agent lifecycle route is added.
- No instruction plan is rendered into model messages.
- No provider, model, tool, network action, paid request, external action, or production deployment is triggered.
- Server-side project ownership and immutable-version conflict checks remain authoritative.

## Versioning behavior

Creating a blueprint requires a fresh idempotency key. Creating a later version sends `expected_version`, so stale clients fail closed instead of silently overwriting a newer blueprint.

The UI composes only from active behavior patterns returned by the default pattern list. If a pattern has been archived, it is not offered for a new blueprint version.

## Verification target

The browser acceptance path covers:

1. create and version a function;
2. create and version a compatible behavior pattern;
3. create blueprint v1 from the versioned catalog;
4. create blueprint v2 through optimistic concurrency;
5. observe `blueprint.create` and `blueprint.version` in Decision Trace;
6. archive the behavior pattern and confirm it disappears from the active catalog;
7. confirm no activation control exists.

Full repository CI is required before merge: formatting, secret scan, lint, strict TypeScript, unit/API tests, production build, and Playwright Chromium.
