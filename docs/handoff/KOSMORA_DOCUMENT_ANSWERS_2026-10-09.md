# Kosmora — document answers v2, 2026-10-09

**Exact patch base:** previous document-library ZIP `kosmora-document-library-b15912d-files.zip` SHA-256 `3e675474346f9aebafb8abd8333fee32970a0a99b199b775fec3d7fa9b194882`, overlay on tracked snapshot `b15912d23ab15a99e38370e22e472faf28c99961`. NOT a direct patch against main or a replacement for subsequent integration fixes. First document-library migration **0025** is unchanged; existing empty-PDF-page mapping and DOCX invalid-XML-codepoint filtering are preserved/strengthened.

## Delivered modules

1. `0032_document_answers.sql` (new migration, index **32**, `when=1791580800007`) persists durable model answer jobs and immutable bounded evidence snapshots. `queued/running/done/failed/cancelled`; startup `recoverInterrupted()` marks in-flight jobs `failed/INTERRUPTED_UNCERTAIN` and not-yet-dispatched queued jobs `failed/INTERRUPTED_BEFORE_DISPATCH`, **never** retries model calls automatically.
2. `DocumentAnswerService`: project-owner authorization and ready-file validation, lexical retrieval to at most eight chunks, real `ChatService.buildRequest` + `ModelGateway.stream`; one bounded document prompt (15,000 characters, 900 output tokens, 60s, at most two accounted route attempts); no tool-calling, embeddings, OCR or fallback/mock success. The gateway yields `route.selected` **before** dispatch, and `DocumentAnswerOwnerBudget.reserve` MUST succeed first; `reconcile` receives actual canonical usage; failures/cancellation preserve unknown holds through `uncertain`, not a zero-cost refund. Without the account branch's real ownerBudget implementation, the endpoint fails closed (`503 MODEL_OR_OWNER_BUDGET_UNAVAILABLE`).
3. `validateDocumentAnswer`: every model `[S#]` must belong to the exact retrieved snapshot and every cited `«literal quote»` must occur verbatim (whitespace/NFKC normalized) in that chunk. Unsupported content is explicitly marked **model interpretation/unverified**; verified literal quotation is printed alongside canonical `filename,page,lines`. Citation matching is **not semantic entailment verification**; generated interpretations must not be treated as proved.
4. Studio: select ready files, ask, poll persisted results after reload, cancel while running; **«Экспорт ответа»** DOCX/PDF/CSV includes stored model answer plus attested source excerpts; **«Фрагменты»** DOCX/PDF/CSV remains independent and cannot be mistaken for an answer. Both have preview. Client only sends a bounded selection, never complete original binaries to the model. PDFs remain rasterized, DOCX editable; no OCR.
5. Retry indexing in place (`POST .../:fileId/retry`): failed original preserved, same file ID, no second 20MB binary/quota charge. `POST .../:fileId/cancel`; incomplete `processing` survives reload and can be resumed. Empty PDF pages retain page sequence in indexing request; no renumbering. XML exporter filters illegal Unicode/XML1.0 code points, preserving the main-branch fix.
6. `createDocumentLibraryPrivacyAdapter` exposes `quiesce(ownerId)` / `export(ownerId)` / `delete(ownerId)` / `resume(ownerId)`. Export includes **all owner file metadata, all indexed text chunks, saved Q&A/results, and a complete manifest of authenticated original-binary URLs with SHA256 and sizes**. Coordinator must fetch binaries **before** destructive delete; a manifest on its own is not the original bytes. Quiesce fences active/late writes before export/delete; deletion never modifies accounting, retained usage holds or authentication/audit data.

## Apply to the exact previous package

```sh
# Previous v1 package is already applied in the integration checkout.
git apply --check kosmora-document-answers-v2-modules.patch
git apply kosmora-document-answers-v2-modules.patch
# Inspect/three-way reconcile the small shared-file changes with parallel branches:
git apply --check kosmora-document-answers-v2-integration.patch
git apply kosmora-document-answers-v2-integration.patch
```

Integration patch touches only `apps/api/src/app.ts`, `apps/api/src/server.ts`, `packages/db/src/index.ts`, and `packages/db/migrations/meta/_journal.json`. Make sure main journal already contains 0025/0026/0027/0028; add the single 0032 entry (index 32, `when 1791580800007`) **without removing 0026–0031 from other branches**. Never do startup DDL. Run the existing migrator after a verified SQLite backup. `schema.ts`, package manifest and lockfile unchanged.

**OwnerBudget seam (required for live):** the supplied b159 snapshot has no `AccountStore/ownerBudget`. In `apps/api/src/server.ts`, replace the explicit `undefined` fifth argument in `new DocumentAnswerService(library, store, gateway, chat, undefined)` with the actual shared account module's implementation of `DocumentAnswerOwnerBudget`. That adapter **must use canonical owner reserve/reconcile/uncertain ledger with immutable run+route-attempt IDs**; do not create parallel budget tables or try to reassign project chat runs. Until connected, `GET /answers` reports `available:false`, new asks return HTTP 503 and no paid calls happen. This is a blocking integration dependency, not a claim that live generation is connected.

API endpoints (under `/api/v1/projects/:projectId/document-library`): `GET /answers`, `POST /answers {question,file_ids}`, `GET /answers/:id`, `POST /answers/:id/cancel`, `POST /:fileId/retry`, `POST /:fileId/cancel`. The browser polls stored status and never auto-retries a billed model call. Privacy coordinator should register the separate adapter as **required**, call `quiesce` first, collect export metadata + authenticated originals, then `resume` (export-only) or `delete` (destructive).

## Verification / limitations

**Executed locally (no paid calls):** TypeScript syntax/transpile smoke for changed TS/TSX (not a typecheck); native `node:sqlite` FTS5 integration with exact v1 migration 0025 plus new 0032, fixture gateway streaming, budget reserve/reconcile and uncertain-on-cancel, persisted answer and source references, wrong/unknown citations, privacy SHA256 original manifest, owner isolation, same-original retry, simulated crash recovery, quiesce cancellation fencing, fail-closed absent budget, binary deletion and FTS cleanup. The Vitest HTTP-injection and service test suites are included but **not run** because pnpm/node_modules are unavailable in the isolated source snapshot.

**UNVERIFIED:** full pnpm typecheck, lint/Prettier, Vitest/Next/browser E2E, PDF/DOCX export through a live browser, rendering with real Office and PDF viewers, AccountStore adapter integration with global limits, provider balance/usage reconcile under real outages, multi-instance locking, full private-data export coordinator registration, migration on integrated schema, VPS/deployment. Do not claim production readiness before these gates. No PR, VPS change, secrets or paid provider call was performed.
