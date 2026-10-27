# GitHub/Code daily workflow — 6 October 2026

This continues draft PR #314 on `codex/github-code-personal-mvp-20261006` after
`cec2d1e64594e48f82c975fe8c8cd94abdcec9fb`. The PR still targets
`codex/owner-form-login-20261004` at `523bdeec2cda01a367d97178c3cb3ec94f5933d3`.
The Studio/composer release `fc6a391a3f0b4d79d608d9ecbfb64d799a566a37` (#311)
was read for context; its code is not included in this branch.

## Acceptance criteria and behavior

1. Several modified/new UTF-8 files form one set with unique paths, up to eight files,
   50,000 bytes per file and 160,000 bytes of new content in total. The UI rejects
   duplicate new paths and byte overflow before preparation. Staged new files can be
   reopened, edited and renamed; removing/clearing a set is explicit. Export downloads
   the local material as JSON. Each reviewed file has its own exact before/after text.
2. The full set, repository, base branch, original commit SHA, title and project are
   included in the saved server review. The server hash covers the complete plan,
   including its access binding. Editing content, path, title, project or the set
   invalidates the active review/approval. Selecting an older review cannot publish
   it against a different active set or base. Explicit approval sends only the exact
   saved hash. Concurrent publication requests claim the same draft once: one Git
   tree/commit, one separate branch and one draft PR.
3. Reload restores staged files, the incomplete editor, original base SHA, selected
   project/title and the selected saved review. Approval is never restored. Recovery
   first verifies the authenticated GitHub status; it cannot read material under a
   different binding. Focus/visibility and operations recheck the binding. Denied
   access hides the workspace but retains the saved material for the same binding.
4. Branches are read in pages of 100. Previous/next controls preserve the selected
   branch and local changes. Pages are integers 1–1000; the 100,000-branch ceiling is
   disclosed. GitHub pagination links are never followed to an arbitrary origin.
   A full final page may lead to an empty next page, which is safe to navigate back.
5. A changed base does not silently become the restored set's base. Preparing a
   review is blocked until the owner checks the latest pinned tree and resolves
   every changed original explicitly: keep local text or remove the change. The
   new review then shows the latest original and a new base SHA/hash. Text already
   present in the new base is omitted. There is no automatic merge or conflict guess.
6. Publication writes a local uncertainty marker synchronously before the POST.
   Failure to store that marker prevents publication. A transport failure never
   authorizes another write, even if a later read still reports `review`. The lock
   survives reload and blocks new preparation/publication. Reconciliation is reads
   against GitHub; only a known published result or a received preflight rejection
   with a confirmed review state releases the lock. The server continues to keep
   uncertainty durable after any GitHub write attempt.

## Storage contract

`sessionStorage` holds one versioned active workspace per tab at
`cosmora:github-workspace:v1`, with a seven-day idle expiry and a 1,200,000-byte
serialized cap. New content remains bounded to eight files/160 KB; originals are
individually bounded to 50 KB and the editor to 50 KB per text value. This survives
reload, not closing the tab or clearing browser storage. There is no cross-tab sync.

The server returns `workspace_scope`, an opaque HMAC binding over the configured
owner, repository and effective permission flags, keyed by the existing GitHub
token. The token is never returned. This value is a recovery discriminator, not an
authentication credential. Token/configured owner/repository/permission changes
change the binding. Schema/version/bounds/expiry are checked before recovery;
incompatible data is removed with a notice. Only explicit data fields are stored:
no approval bit, API response object, token or credential field. Recognizable key
content and protected paths are excluded from persistence.

Quota/disabled storage or invalid/oversized text does not truncate the editor or
replace the last successful snapshot. The UI states that the latest material is
not saved and offers export. Closing/reloading in that state may restore only an
older successful snapshot. Reviewed server drafts remain durable in SQLite.
Conflict decisions are local and reapplied only when all conflicts are resolved;
reload may require checking the current base and choosing again.

## Reproduce without paid requests

Open `/github` with the fixture API. Modify a file, stage it, create/stage another
file, select a Cosmora project and enter a title. Reload before review to inspect
the editor/set restoration. Prepare review, inspect every before/after pair and
base SHA, then explicitly approve. Only the fixture publishes during automated
checks. The real product flow remains an owner action; no trial live writes were
performed for this work.

Meaningful checks cover the real Fastify/SQLite draft lifecycle, pagination bounds,
access binding, full-set hashing and concurrent claims with a synthetic GitHub
adapter; browser fixtures cover multi-file edits, reload, owner/repo changes,
access refusal, changed-base decisions, rate-limit retry, uncertain response/reload,
storage failure, duplicate paths, byte overflow and long paths at 390px width.

Validation passed: the full workspace test command, including 23 focused GitHub API
tests; 38 selected Playwright scenarios (including pure storage/URL checks), followed by all 27
GitHub/storage scenarios after the final refresh/connection recovery changes;
strict TypeScript, lint, formatting, secret scan and nine package builds. Desktop
and mobile screenshots were inspected. The temporary local port configuration was
removed after testing. All model/GitHub workflow checks used local fixtures; no
paid request or trial publication through Cosmora was performed.

## Remaining boundaries

- One server-allowed repository. No new credentials, permissions, OAuth or access UI.
- GitHub-truncated trees, binary files, protected/secret paths and existing limits
  still block preparation. Review is exact before/after text, not a patch editor.
- Local expiry/browser clearing can remove unreviewed material. Export is the
  owner's durable local backup; the app does not claim encrypted browser storage.
- Unknown writes can leave a commit/branch without a PR. Read-only recovery cannot
  complete or remove those objects. If no accepted PR can be found, manual GitHub
  inspection remains necessary; the app never silently retries publication.
- Live deployed token/write permissions and paid AI quality were not exercised.
- Integration with #311 and a single production deployment belong to the primary
  chat. Composer, Studio Files, Windows, graphs, production, secrets/access and the
  emergency stop were not modified by this continuation.
