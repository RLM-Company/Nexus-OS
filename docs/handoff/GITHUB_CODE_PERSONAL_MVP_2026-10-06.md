# GitHub and Code personal MVP — 6 October 2026

Based on `523bdeec2cda01a367d97178c3cb3ec94f5933d3`, with PR base
`codex/owner-form-login-20261004`. Work was done in a separate clone. The original
checkout and the concurrent panel/Studio Files work were left untouched.

## Confirmed problems corrected

- Code and the Apps GitHub card described repository editing as unavailable or
  demonstrated with mock data even though `/github` uses the real server integration.
  Both now lead to and accurately describe that integration.
- Unstaged editor text could disappear when another file, branch, or connection
  refresh was selected. These actions now require staging or discarding the text.
  Leaving the page warns about changes that have not been saved in a reviewed draft.
- Empty new files could not be staged. They can now be reviewed, and creating a new
  file over an existing tree entry is blocked. Staged new files can be reopened.
- The browser silently hid all files after the first 500. It now offers more files,
  reports an empty filter result and discloses the existing 100-branch API limit.
- A lost publication response followed by a failed recovery read left the browser's
  draft in `review`. The tab now treats publication as uncertain until a server read
  establishes the result, including when reselecting a saved draft. It offers a
  read-only reconciliation action rather than another publication.
- A known preflight failure (for example a changed base) marked a draft uncertain
  even though no write was attempted. The store releases the claim back to review
  only before any write attempt. After a write attempt, uncertainty remains durable.
- Preparation/publication resolved an arbitrary commit ref as the base branch.
  They now verify `refs/heads/<branch>` and read its pinned commit, including slash
  branch names. Returned branch/commit and draft PR details must match the plan.
- Successful but malformed GitHub payloads could escape as unhandled errors or
  be accepted as confirmation. Read/write response shapes, PR URLs and returned
  branch/commit/draft details are checked. Blob base64 and declared size are checked.
  Access denial and rate limits receive safe, distinct errors without provider text.
- The live editor used mostly native controls without coherent spacing or focus
  treatment. Scoped styling now provides accessible focus, selected-file state,
  primary review/publication actions and separate before/after backgrounds.

## Local acceptance

API tests exercise the real Fastify routes and SQLite draft store with a synthetic
GitHub fetch implementation. Browser tests exercise the actual React interface with
intercepted GitHub responses and the local fixture API. No live model generation or
trial GitHub publication was performed.

Covered flows include the allowed repository, branch/tree/file reads, importing a
file into an unsent chat, edits and empty new files, persisted review, exact review
approval, separate branch and draft PR publication, access denial, rate limits,
changed bases, malformed responses, lost PR responses and read-only recovery.
The browser editor/review is checked at 390px width and inspected in desktop/mobile
screenshots. Existing Code brief-to-chat behavior remains covered.

Validation passed: formatting, secret scan, lint and strict TypeScript; 457 unit/API
tests (including 20 GitHub tests); 23 selected Chromium scenarios, followed by all
12 GitHub scenarios after the scoped styling change; nine package builds; 23 local
deployment tests, 13 connection-check tests, six secret-scanner tests and the
compatible-provider fixture. The browser fixture used dedicated loopback ports
3300/3400 to avoid other chats' servers. The temporary port configuration was removed.

## Remaining boundaries

- Only the server-configured repository is allowed; the repository selector
  discloses this and cannot grant access to another repository.
- The branch list remains bounded to 100; file navigation can reveal more than 500
  entries, but a GitHub-truncated tree still blocks preparation.
- UTF-8 text only: 50 KB/file, eight changes, 160 KB total. Chat import remains
  bounded to 8,000 characters/file. Service/secret paths retain their existing rules.
- Unreviewed editor/staged changes stay in the tab. Reviewed drafts are persisted
  on the server; browser leave warnings are best effort, not autosave.
- Diff is an exact before/after text review, not a line-by-line patch editor.
- A write may create a commit or branch without a PR. Reconciliation can discover
  an accepted PR, but cannot automatically retry writes or remove orphaned objects.
  An ambiguous write before a saved commit checkpoint may need manual GitHub review.
- Local fixtures do not verify the deployed service's token or live write permissions.
  Live product publication remains an explicit owner action after review.
- No merge, deployment, credential/access change, emergency-stop change, paid AI
  test, Windows app, composer, Studio or graph branch work was part of this change.
