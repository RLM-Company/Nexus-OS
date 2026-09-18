# Project Context web layer — backend contract gap

Date: 2026-09-18
Scope: web-only implementation in `codex/overnight-project-context`.

## Current safe boundary

The current project-context panel is intentionally backed by browser-local UI state and mock metadata.
It does not add a database, migrations, arbitrary file upload, secret handling, or changes to Manager Runtime,
Model Gateway, Policy Engine, Tool Runtime, Emergency Stop, finance, A6, or production behavior.

The web layer needs a server contract before project context can become authoritative or participate in model
requests. Until that contract exists, the UI labels token counts as mock estimates and treats source selection as
local preview state only.

## Required read contract

A future server-owned endpoint should provide a bounded, already-redacted project-context view:

`GET /api/v1/projects/:projectId/context`

Minimum response shape:

```json
{
  "version": 1,
  "summary": "short project-history summary",
  "used_tokens": 13800,
  "token_limit": 64000,
  "sources": [
    {
      "id": "stable-source-id",
      "title": "README.md",
      "kind": "document",
      "summary": "bounded preview text",
      "estimated_tokens": 5600,
      "connected": true,
      "updated_at": "2026-09-18T00:00:00.000Z"
    }
  ]
}
```

The response must not contain credentials, API keys, bearer tokens, raw secrets, model-provider credentials,
hidden prompts, arbitrary filesystem paths, or unbounded source contents.

## Required preview contract

Connecting a source should remain two-step. The server should first return a bounded preview without changing
authoritative state:

`POST /api/v1/projects/:projectId/context/sources/:sourceId/preview`

Expected fields:

- source id and display title;
- source kind;
- bounded/redacted summary;
- estimated token contribution;
- resulting total token estimate;
- limit and whether the source would exceed it;
- current context version.

The preview must not expose raw file contents merely to support the UI.

## Required mutation contract

Only after explicit confirmation should the web app submit a mutation. Suggested version-checked operations:

- `PUT /api/v1/projects/:projectId/context/sources/:sourceId` with
  `{ "connected": true|false, "expected_version": 1 }`;
- `POST /api/v1/projects/:projectId/context/clear` with
  `{ "expected_version": 1, "acknowledgement": "CLEAR PROJECT CONTEXT" }`.

Mutations should return the new bounded context snapshot and fail on stale versions rather than silently
overwriting concurrent changes.

## Source discovery boundary

No arbitrary upload endpoint is requested by this package.

A future source catalog may expose only sources already authorized for the project, for example:

`GET /api/v1/projects/:projectId/context/available-sources`

The catalog should return metadata only and should preserve project isolation and owner authorization.

## Runtime handoff

The Manager/model runtime should consume only server-confirmed connected sources. The browser-local mock state in
this PR must never be interpreted as runtime authority.

Before runtime integration, define:

1. canonical ordering/truncation rules when the token limit is reached;
2. provenance carried into Manager Runtime;
3. server-side secret/content redaction policy;
4. behavior when a source becomes unavailable;
5. ownership/version rules for concurrent tabs or clients;
6. whether context summaries are persisted, regenerated, or derived on read.

These decisions belong in backend/runtime work and are intentionally not implemented in this web-only package.
