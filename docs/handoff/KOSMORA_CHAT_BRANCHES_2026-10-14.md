# Chat editing, regeneration and variants — 14 October 2026

## User workflow

Ordinary chats now offer "Изменить запрос" and "Повторить ответ" below saved
messages. A dialog explains that a new model response will be generated and the
original remains saved. Editing retains the request's original attachments.
The new variant is a separate canonical chat; the selector above its conversation
switches between the original and other variants. Existing chat/project layout and
the standard queue, SSE, stop/recovery and accounting mechanisms are reused.
Project/Manager conversations are outside this ordinary-chat delivery.

## Persistence and isolation

Append-only migration 0043 adds `chat_branches` metadata and leaves old messages,
runs, usage and migration entries intact. The original owner's completed prefix
is copied under fresh message IDs; copied rows have no client-message or run ID,
and no old usage rows are duplicated. Editing excludes the selected user message
and every subsequent message. Regeneration starts from the preceding user turn,
excluding the selected answer and all later messages. Prefix order follows SQLite
insertion order, matching execution context, rather than relying on clock ordering.

The current manual memory note and explicit chat Relay override are copied as a
snapshot. Later edits to the source memory do not alter the variant. A newly
generated answer is billed normally, including its model input; historical ledger
entries are not cloned. No automatic model summary or hidden translation is added.

POST `/api/v1/chats/:chatId/branches` takes a client-generated UUID plus source
message and kind. The UUID is the new chat ID. A request digest rejects changed
replays; identical acceptance, including after completion, returns the same run.
Owner mismatches, wrong roles, ID collisions, busy sources and malformed input fail
before commit. Reads and writes use private/no-store. The read-only family endpoint
never updates chat activity timestamps or reorders old variants when timestamps tie.

All changes commit in one transaction. There are at most 32 variants per family,
400 prefix messages and 8 MiB of copied context. Aggregate size is checked in SQLite
before materializing a potentially large history. Existing owner privacy fences
block creation; metadata is included in owner export and cascades with chat removal.
Source/root links become null when their referenced records are deleted.

## Client reliability

The dialog freezes the attempt ID/body on dispatch. A lost response is reconciled
by reading the known child chat; there is no automatic second generation request.
An uncertain manual retry uses the same ID. Unmount aborts pending local work and
suppresses late navigation. Ordinary composer drafts remain separate from edits
and are restored when returning to the original chat. Saved variants and completed
responses survive reload. Reopening a finished stream replays its recorded result.

## Verification

35 API cases passed together across branches, memory, ordinary chat and background
coordination. The final six branch cases also passed after the stable-order and
wrong-role assertions were added. Coverage includes context isolation, immutable
source history, concurrent/repeated acceptance, completed-stream replay with no
extra model dispatch, copied attachments/memory/Relay, foreign ownership, fences,
privacy export/delete, rollback on invalid requests and bounded family/prefix size.

Six Chromium cases passed against real local HTTP/SQLite and a mock provider:
edit/cancel/draft retention, switching/reload, regeneration, lost creation response,
and the three existing memory workflows. API/web type checking and formatting passed.
No paid model requests have been used in verification.

Scoped lint reported zero errors; secret scanning and `git diff --check` passed.
GitHub Actions remains subject to the previously verified account billing gate;
a green hosted CI result is not claimed.

## Production activation

Source `f3471692d57106e892874e0e395feec17d2511a4` is published in
[Draft PR #344](https://github.com/RLM-Company/Nexus-OS/pull/344), based on
`codex/chat-memory-20261014`. No merge into main was performed.

Release directory: `/opt/cosmora/releases/branches-f347169`. The source archive
contains 671,690 bytes; SHA-256:
`33ec1a41a5ddb3b6f96da67213811351d057dd460296119b67785dd19c12a86d`.
Both production images built successfully with Docker networking disabled:
`cosmora-alpha-app:branches-api-f347169` and
`cosmora-alpha-app:branches-web-f347169`. The web image retains previous static
assets for cached clients. There were no dependency changes.

The verified, consistent pre-migration backup has SHA-256
`64a2f9cdb10eb778676c78e277a99d1cbbeb5247ccaa19cb136b57909fb5537c`.
Migration rehearsal on its copy passed with 42 migration-journal rows (previously
41), database integrity and foreign-key checks, edit/regeneration/idempotency,
history isolation, memory snapshots and workspace routes. It made no model calls.

API and web were activated and became healthy. Read-only production comparisons
confirmed preservation of existing projects, chats, messages, runs, manual memory,
actors and identity sessions, excluding routine session last-seen timestamps.
Authenticated health, chats, projects, navigation, settings, usage, media,
presentations, Skills and notification routes returned 200. Live memory/branch
reads returned private/no-store. The existing private Code executor passed a
synthetic unprivileged Node check and verified cleanup. Login and executor
container IDs/start times remained unchanged; registration remains disabled.

The remembered browser session loaded the published ordinary-chat actions.
Both edit and regeneration dialogs opened successfully and were cancelled before
generation. No new live chat, variant, message or paid model request was created.
Screenshot: `2026-10-14/kosmora-branches-f347169/chat-edit-live.png` in the parent
Codex workspace. Activation completed with
`KOSMORA_CHAT_BRANCHES_ACTIVE_LOGIN_AND_EXECUTOR_UNCHANGED`.

The deployment rollback restores previous API/web images while retaining the
compatible additive migration; it does not overwrite subsequent user writes with
an older database. No rollback was needed.
