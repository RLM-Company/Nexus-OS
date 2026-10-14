# Gemini and parallel work reconciliation — 14 October 2026

## Reviewed Gemini delivery

PR #330, `feature/kosmora-updates`, head
`ab5e5591b17cfdb0faf548671fe76bee3c8f295c`, base
`0182e6a612e2c1572be186995463f00857e304b7`.
The user confirmed this is one of their Gemini results, with potentially more
work elsewhere. The known Spark URL did not expose the conversation in the
available browser session; no claim was made that all Gemini work was found.

The actual diff has 21 files, 1,513 additions and 8 deletions. It contains types,
DDL, helper modules and six API acceptance tests, with no web implementation or
routes implementing the advertised four blocks. On its exact unmodified head:

- All six `general-chat-features.test.ts` scenarios fail on missing routes (404):
  fork, regeneration, folders, context exclusion, artifacts and DAG promotion.
- API type checking reports a missing `getChatMemory` method on
  `GeneralChatRuntimeStore`.
- Migration 0036 occupies the same slot as the independently completed account
  registration migration; it also introduces a second FTS index despite the
  canonical 0034 history index already being present.
- `deploy_alpha.sh` directly applies DDL outside the journal, runs compose down,
  and treats a failed health check as success. It was not executed or adopted.

The branch is preserved as `github-audit/gemini-updates` and a local audit branch;
it is not marked complete, merged wholesale, deployed, or substituted for the
current live database. Existing graph work remains separate.

## Other work reconciled

Integrated the existing PR #329 / #331–342 stack at
`3153a27474e15d061a11e0cbc2b8c9de578abeda` with the deployed Studio source
`c7c16d60b4cd5c723e2abe009d7b055520b8c6de`. The single app.ts conflict was resolved
by preserving both the empty-project route and optional registration route setup.
Merge commit: `4f84fcc`. The source stack provides registration/recovery/session
management, presentations, notifications and inert private Skills/version/package
management. This is independent parallel work, not all attributed to Gemini.

Registration is still runtime-gated by `KOSMORA_REGISTRATION_ENABLED=1` and requires
its configured identity/email providers. Integration does not enable it, provision
OAuth credentials, claim the existing owner's account, or change the live proxy.

## Completed manual chat-memory workflow

Built the first connected workflow from the memory-block design, using the current
base rather than carrying over incompatible unfinished scaffolding:

- GET/PUT `/api/v1/chats/:chatId/memory`, strict input, 4,000-character limit,
  optimistic versions, private/no-store reads, owner checks and busy-run conflicts.
- Migration 0042 follows the parallel chain 0036–0041; existing journal entries
  remain intact. Notes cascade with the chat and honor durable owner privacy fences.
- Notes are included in both stream-driven and background requests as quoted user
  context in the latest user turn, never as system authority. Input estimates include
  the actual note bytes. No automatic summarizer, automatic fact extraction or
  guaranteed token reduction is claimed.
- Chat settings load notes on demand, save/clear, preserve drafts after conflicts,
  expose explicit reload, and reconcile a lost PUT response by reading its version.
  A lost response never triggers an automatic second write.
- The account privacy export includes owned notes. Clearing notes stops adding them
  to future user turns; it does not rewrite existing history or erase facts already
  echoed by earlier assistant answers.

This completes manual per-chat notes, not the entire four-block Gemini program.
Branch editing/regeneration, folders/server pins, summaries/context exclusion and
chat-to-Canvas promotion still need their actual connected implementation.

## Validation

63 API/core cases passed together across 14 files, including new memory, stream and
background requests, privacy export/delete/fences, Studio projects and the parallel
account/presentation/notification/Skills modules. The first parallel authentication
run hit a five-second recovery-test timeout; bounded two-worker execution with a
15-second test timeout passed the complete set, without changing security behavior.
Three real HTTP/SQLite Chromium memory cases passed (save/clear/reload, stale edits,
lost PUT response). Six existing export Chromium cases also passed. API and web
type checking passed. Four document-queue Chromium cases and two real presentation/
Skills workflows also passed: create, edit, reload, download an editable PPTX and an
inert Skill package. Three PPTX/quiet-hours unit cases passed. Scoped TypeScript
source/test lint reported zero errors; browser E2E files and deployment JavaScript
are outside that package lint scope. After lint corrections, 20 affected API/core
cases passed again. All providers in these checks are local mocks; no paid call.

Source revision: `601f0ac5c7d92a87c5ce809a66a10c2d4d27deae`.
Integration Draft PR: https://github.com/RLM-Company/Nexus-OS/pull/343.

GitHub Actions run `38524643974` did not start any job steps. Its failure annotation
states that recent account payments failed or the spending limit needs increasing.
No job log exists. This is a GitHub billing gate, not a successful CI check and not
a test failure attributed to application code. No billing setting was changed.

The production API image built successfully offline. The first web build exposed
a missing compiled default export for the new contracts subpath; the release's
web Dockerfile now builds `@cosmora/contracts` before Next. The source revision
does not change, and the old live application stays running throughout image builds.

## Verified production activation

Activated successfully on the existing VPS with source revision `601f0ac`:

- API: `cosmora-alpha-app:workspace-api-601f0ac`.
- Web: `cosmora-alpha-app:workspace-web-601f0ac`.
- Release: `/opt/cosmora/releases/workspace-601f0ac`.
- Source archive: 668,551 bytes; SHA-256
  `28e4e039f11373b566a501064e476f164a0ab0d63a12b79105b221305e9e3efb`.
- Verified pre-activation backup SHA-256
  `4b36b0065bd16deb20546452e04d5608397e643027603f4d814c36e8204f6967`.

Both image builds ran with `--network=none`. Before service replacement, the
verified backup copy passed all seven additive migrations (34 → 41 journal rows),
integrity and foreign-key checks, memory save/stale-version/owner-isolation tests,
new workspace reads and Studio empty-library creation. No model was dispatched.
Production startup applied the same migration set successfully. All existing
project/chat/message/run and identity actor/session rows were preserved (routine
session `last_seen_at` is excluded from the session comparison).

Authenticated health, chats, projects, navigation context, settings, usage, media
capabilities, presentations, Skills and notifications returned 200. Memory read
returned 200 with private/no-store; no live memory was written by acceptance.
The real Code executor completed a synthetic unprivileged check and verified
cleanup. Owner-login and Code-executor container IDs/start times were unchanged;
registration remains disabled. Activation exited successfully without rollback.

The live browser restored the remembered session, six existing chats and one
project. `/presentations` loaded without errors. The saved synthetic chat
`d18ae726-c7b4-4d6d-b327-bfc03086fd17` opened and its new memory field loaded and
became editable. No message/provider request or memory write was sent. Screenshots
are saved locally under `2026-10-14/kosmora-workspace-601f0ac/`.

Rollback records: `deployctl.before`, `deployctl.next`, `overlay.yaml`, `backup/`
and `activate.log` in the release directory. Image rollback intentionally retains
the compatible additive schema; it does not erase user writes by restoring a stale
database automatically. A database restore requires explicit incident review.

The initial activation tool request timed out in automatic permission review
before SSH started. Its single allowed retry was approved and completed; there
is no outstanding permission request.
