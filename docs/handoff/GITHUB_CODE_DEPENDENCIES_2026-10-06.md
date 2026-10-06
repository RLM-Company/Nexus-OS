# GitHub/Code integration dependencies

Draft PR #314 remains based on `523bdeec2cda01a367d97178c3cb3ec94f5933d3`
(`codex/owner-form-login-20261004`). It contains the first stage `cec2d1e` and the
daily-workflow continuation. It does not contain #311 / `fc6a391` or other chats'
unfinished changes. The primary chat owns integration and deployment.

The continuation changes only GitHub API/routes, its editor/recovery module, tests
and handoff. No additional changes to shared `page.tsx`, `globals.css`, contracts,
composer, Studio or Windows are needed. The first-stage Code/Apps links in
`workspace-sections.tsx` remain the only shared UI change in this PR; preserve
the #311 Studio content when integrating that small diff.

Ship the GitHub web module and API together:

- `GET /api/v1/github/status` adds `workspace_scope: string | null`. This is an
  opaque recovery/access-context discriminator, not a bearer token. Existing
  owner authentication and configured repository restrictions remain required.
- `GET /api/v1/github/branches?page=1` adds `page`, `next_page` and a ceiling-only
  `limited` flag; page size is 100 and the bounded maximum is 1000 pages.
- Draft preparation accepts optional `workspace_scope` for stale-context rejection.
  New saved plans include the binding inside their immutable review hash. Publication
  verifies it again before any write. Legacy stored plans retain existing owner/repo
  checks; reprepare them under the current binding when updating a change set.
- Browser recovery owns only `cosmora:github-workspace:v1` in `sessionStorage`.
  It does not reuse ordinary chat/Studio draft keys. The existing explicit
  `cosmora:github-import:<uuid>` handoff to an unsent chat remains unchanged.

After integrating onto the primary release, run the GitHub fixtures/E2E set and
the Code brief-to-chat regression against the combined web/API. The tests can use
the ordinary Playwright configuration on unused ports or a temporary override;
this chat used dedicated ports 3300/3400 and its own SQLite fixture database.
