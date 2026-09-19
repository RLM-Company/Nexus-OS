# Project Context web layer — backend contract gap

Date: 2026-09-18
Scope: browser-local preview only.

## Current safe boundary

The project-context panel stores only bounded UI state in browser localStorage and mock metadata.
Restored local state rejects empty or duplicate source IDs and fails safe when connected sources exceed
the declared token budget. Secret-like title and summary metadata is redacted before normalized state is
persisted again.
It does not create a database, migrations, arbitrary file upload, secret handling, or runtime authority.
Manager Runtime, Model Gateway, Policy Engine, Tool Runtime, Emergency Stop, finance, A6 and production
behavior remain unchanged.

The UI labels token counts as mock estimates. Browser-local source selection must never be interpreted as
authoritative model context.

## Required read contract

A future server-owned endpoint should provide an already-redacted bounded snapshot:

`GET /api/v1/projects/:projectId/context`

Minimum fields:

- version;
- bounded project-history summary;
- used token estimate and token limit;
- stable, unique and non-empty source id, title and kind;
- bounded source summary;
- estimated token contribution;
- connected state;
- a server-authoritative invariant that the sum of connected source contributions does not exceed the
  declared context limit;
- updated timestamp.

The response must not expose credentials, API keys, bearer tokens, hidden prompts, raw secrets, arbitrary
filesystem paths or unbounded source contents.

## Required preview contract

Connecting a source should remain two-step. A future endpoint such as

`POST /api/v1/projects/:projectId/context/sources/:sourceId/preview`

should return only bounded/redacted metadata and the expected token impact without changing authoritative
state. Preview must fail closed when the proposed source would exceed the authoritative context limit.

## Required mutation contract

Only after explicit confirmation should the UI submit a mutation. Suggested version-checked operations:

- `PUT /api/v1/projects/:projectId/context/sources/:sourceId`;
- `POST /api/v1/projects/:projectId/context/clear`.

Mutations should fail closed on stale versions instead of silently overwriting concurrent changes.

## Source discovery boundary

No arbitrary upload endpoint is requested by this package. A future source catalog may expose only sources
already authorized for the project.

## Runtime handoff

Before any runtime integration, define ordering/truncation, provenance, server-side redaction (including
quoted secret-like assignments), unavailable source behavior, unique source identity, authoritative budget
enforcement, ownership/version semantics across clients and summary persistence/regeneration rules.
