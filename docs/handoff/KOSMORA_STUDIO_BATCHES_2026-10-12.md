# Studio document workflows — 12 October 2026

This delivery builds on the deployed navigation integration (`6641bb4`). It adds
three complete workflows without changing provider configuration or migrations.

## Document upload queue

Selected documents are handled sequentially, with explicit waiting/upload/read/index
and terminal states per file. A damaged document or definitive server rejection does
not stop valid later files. Cancellation stops remaining files and asks the existing
server to settle the active indexed file. Server-proven completion remains success;
unverified completion is displayed as uncertain, never silently retried. A lost upload
POST response explicitly tells the user to check the stored library before reuploading.
Retry downloads the retained original and indexes its existing ID; it does not upload
or reserve another original. Queue metadata retains no file bytes after processing.
Selection is bounded to 100 files/100 MB; the existing per-file 20 MB quota remains.

The library is keyed to the selected project and suppresses late UI updates after
unmount. Progress counts processed files rather than inventing network percentages.
Bounded reconciliation requests cannot leave the UI busy indefinitely. Controls remain
monochrome and use the existing Studio layout.

## Original-document ZIP

Selected documents, or all listed originals when nothing is selected, download as one
ZIP with exact saved PDF/DOCX/TXT/CSV bytes, numbered safe paths, original names/IDs,
byte counts and SHA-256 in a manifest. This differs from extracted-text chat exports.
Requests stream and check the declared size; incomplete, excess, unavailable or
cancelled data never creates a partial archive. The local archive budget is 50 MB,
with a 30-second per-original deadline. Compression is asynchronous and dynamically
loaded only on explicit download. No new dependency or model call.

## Empty library project

Studio can create a named empty project without sending a user message or dispatching
a model. Owner-scoped `POST /api/v1/projects/empty` accepts a stable UUID and strict
title. The transaction creates only a DRAFT project and main chat; no run/usage rows.
Repeated identical requests return the same project/chat. Foreign collisions and
changed retry payloads fail closed. Existing database privacy triggers remain in force.
The UI freezes the attempt ID/title, reconciles a lost response through the scoped
project read, then opens the project in Studio. Ordinary AI-backed creation remains.

## Validation

Nine queue/archive unit cases passed: continuation, definitive/uncertain failures,
cancellation, retained originals, exact binary/hash preservation, safe duplicate paths,
size limits and partial data rejection. Two targeted project API cases passed: empty
creation with no model dispatch/runs, idempotency, foreign-owner collision/strict input,
and existing project rename. Fifteen other API cases were not rerun in that filtered
invocation. Five Chromium cases passed together with real local HTTP/SQLite: empty
creation after a lost POST, a damaged stored PDF between valid documents, cancelled
index and in-place retry, lost upload POST and recovery, selected-original ZIP, plus
the previous original/citation/DOCX export workflow. The initial invalid UTF-8 fixture
was rejected before storage, so a damaged PDF was used to cover extraction failure
after a real original had been retained.

Web/API typecheck, scoped lint, formatting, diff and secret gates passed. Fixtures/mock
provider only; no paid AI request. Production activation is recorded after verification.
