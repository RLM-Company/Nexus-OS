# Kosmora chat export — 11 October 2026

Chat settings now export both ordinary and project conversations as Markdown or
versioned JSON (`kosmora.chat`, version 1). The export contains the original user
and assistant text, code blocks, creation/update timestamps (JSON), message status,
conversation identity and attachment names/types. Project system events and internal
run fields are omitted. Attached file content, embedded images and unsent drafts are
not included; the UI and export explicitly describe metadata-only attachments.

Generation and download run entirely in the browser, without an API write or model
request. Empty conversations and active sending/loading disable download. Historical
cancelled/failed replies retain their text and status. Unicode titles produce bounded
safe filenames with an export timestamp; metadata is escaped for Markdown while the
original message Markdown/code is preserved. This is a transcript export, not a full
account backup or a chat import feature.

Validation: four focused unit cases passed (round-trip Unicode/code, long content,
attachment boundary, status, safe filenames, empty/system-only conversations).
Three Chromium export cases passed together: real Markdown/JSON downloads, project
chat on a 390px viewport, draft preservation, no API writes and empty-state gating.
Six existing history/search/navigation cases also passed in the initial browser run.
The initial export fixtures omitted the collection records and used the ordinary
composer label for a project; those fixtures were corrected. A later run exposed an
implicit label ambiguity on the format select, fixed by an explicit label/id pair.
No paid AI request was sent. Production activation is recorded below after verification.

## Integration boundary

This is an additive web-only change on the current integrated checkout, outside the
four blocks delegated to Gemini. Keep `ChatExportControls` in chat settings when
integrating any future folders/branching/history changes. No migrations, provider
configuration or executor changes are needed.
