# Intelligence Graph → reviewed project model context

## Integration acceptance — 21 October 2026

Integrated PR375 (`8ef7308`) on top of `ade0bcd`, retaining the shipped Work priority/deadline, XLSX and Windows download-center changes. The independent graph panel now renders readable record cards, source quotations and full conflict positions; raw JSON and SHA remain available in a disclosure. Main chat, sidebar, logo and global styles are untouched.

Independent checks on the combined code: 46 core graph cases, 39 Work DAG API cases and 9 context API cases passed. The initial concurrent context API run hit the 5-second SQLite startup timeout; the isolated nine-case rerun passed with a 20-second limit. Five-package type checks, changed-source ESLint, secrets and diff checks passed. Four Chromium scenarios passed: reviewed apply, lost-response recovery, hash mismatch, and a real local HTTP/SQLite round trip covering import, readable literal content, apply, reload and removal while retaining other materials. The real integration scenario uses an active project initialized with the mock provider; no paid request is made. There is no standalone `tsconfig.e2e.json`; no such check is claimed.

The graph continues to require an ACTIVE project. Preparing or applying context itself creates no run. Deployment acceptance will be recorded separately after the release is active.

20 October 2026. Exact parent: integration PR360 `c8e742a5a66e66b05f8192bc3c29a0e2dcbe7df2`, branch `codex/integrate-work-presentations-20261017`. All 1244 parent blobs were reconstructed and Git-SHA verified before implementation. This extends the already integrated graph workspace; it does not revive the old graph-OFF branch or change deployment/flags.

## User workflow

In the separate graph workspace, select a saved revision and enter a retrieval query in “Контекст графа для модели”. Preview shows exact text, source quotes/locations/status, every side of selected conflicts, decision refs, omissions and SHA-256. Explicit review enables adding the snapshot to existing project materials. Preparation, apply and remove do not call a model or queue a run.

One deterministic `graph-context-<graphId>.json` material is used per graph. An existing different snapshot is explicitly replaced after review; other files and instructions are retained. Apply is bound to graph revision, query, content hash and project-materials version. The preview indicates an existing snapshot, replacement and lack of remaining file/byte capacity. Removal targets only this exact material with both hash and CAS.

After a lost mutation response, the UI disables another mutation and requires “Проверить сохранение”. It reads the current material version/hash; no automatic PUT retry occurs. An identical already-present snapshot does not append a file or increase the materials version. An old CAS cannot silently replace newer project edits.

## Context contract and bounds

`kosmora.graph-context.v1` is quoted user data. No node or edge is promoted, no model route/permissions are granted, and no automatic knowledge extraction/training is added. The system prompt is unchanged.

Each context pins graph ID/revision/time, query and search version. Included nodes retain exact ID/version/kind/status/text; included edges carry both endpoint refs and, for a citation, its exact Source/Document version, quote, location and status. Historical superseded citations remain visible as such. Included conflicts contain their full subject/positions/decision closure; if a complete relevant conflict cannot fit, or the upstream conflict selection is truncated, context construction fails rather than passing one side to the model.

Limits: 8000 UTF-16 characters / 16000 UTF-8 bytes, 40 unique node versions / 24 edges. Conflict closure is reserved first, then complete relations/quotes, then remaining matched nodes. Whole units are omitted when bounded space is exhausted, with explicit omitted counts and retrieval truncation. Empty search is a distinct 422 result. Exact original strings and CRLF survive JSON decoding; DEL is escaped for the attachment transport. Hash is SHA-256 of `JSON.stringify([name,content,source_type ?? null])`.

## Existing run/accounting/privacy integration

The snapshot uses existing ProjectStore materials and ManagerService user-material serialization. A subsequent explicit project message snapshots the current materials into its run. Earlier queued runs retain their prior material snapshots; later graph edits do not rewrite them or update the installed material automatically. Manager input accounting includes the actual encoded user-material bytes. Normal dispatch/budget/policy gates are preserved and are not bypassed by applying context.

Removing context stops including it in future project runs, while existing run snapshots/history remain. Existing account-core privacy export/delete covers project materials and per-run snapshots; the mandatory graph adapter covers graph revisions. Atomic ProjectStore material writes honor the durable owner lifecycle fence. No new managed migration, table, provider, dependency or automatic dispatch is added.

## HTTP

All routes remain under the existing enabled graph feature and require active owned project plus graph scope:

- GET `/api/v1/projects/:projectId/intelligence-graphs/:graphId/context?q=...&revision=N`: deterministic preview and current materials state; no-store.
- PUT same path: `{q,revision,expected_sha256,expected_materials_version,reviewed:true}`.
- DELETE same path: `{expected_sha256,expected_materials_version}`.

The optional materials dependency keeps standalone graph seam consumers compatible; the real product app passes its existing ProjectStore. Strict request validation rejects caller owner IDs/extra fields. CAS conflict 409, bad review hash 400, empty evidence 422, context/material bound 413 and durable owner fence 423.

## Validation and limits

953 backend tests across 134 files and 204 web tests across 42 files pass, including 16 new focused cases for literal context, bounds, complete conflict/edge closure, immutable revision content, quoted-user role and token accounting, managed migrations, owner/project/feature isolation, CAS/lost response, retained files/UTF-8 limits, durable fences, queued snapshot behavior and real owner export/delete. Backend builds, API/web types, scoped ESLint/Prettier and secrets/diff checks pass. Production Next webpack build passes. Three new Playwright scenarios are discovered and type-checked (review gate, lost response/read recovery, hash mismatch); Chromium is absent here, so execution is not claimed. Hosted CI status is separate, not a claimed pass.

This is a Draft implementation for integration review, not a VPS deployment.
