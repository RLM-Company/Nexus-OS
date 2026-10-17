# Integrated document/table editing and project evidence

Combines the Canvas history branch (#355, `397e52e`) with document/table editing
and persistent project tables (#353–354, `4a9ca43`). Preserves the Work/Skills and
presentation/history base. Local checkout is partial; publication uses the full
remote base tree and replaces only explicitly changed blobs.

## New behavior

- Project materials can stage reviewed snapshots from Canvas, saved tables and
  published outputs of completed Work. Listing returns scoped metadata only.
  Preview checks project/owner/type, immutable version and canonical SHA-256.
- Sources never silently truncate. Full text must fit 8,000 UTF-16 code units and
  24,000 UTF-8 bytes including provenance. Oversized sources require explicit text
  line ranges, or raw table row ranges and unique positional column selections.
  CSV projection preserves duplicate headings, literal values and quoted newlines.
- Staging is separate from saving materials. Future chat/Work accepts snapshot
  the saved evidence; edits/deletion of the original do not rewrite accepted jobs.
  Sources remain untrusted evidence through the existing context rendering path.
- Material writes obey the existing owner privacy fence and optimistic version.
  Lost write responses are reconciled by exact successor-version/content reads,
  without an automatic second mutation.
- Canvas manual create accepts `client_request_id`. Key collisions with changed
  contents, other owners/projects or table types fail. The browser writes the key
  into its scoped draft before dispatch, restores it on reload, and retains copy
  identity during explicit retries. Lost updates use exact successor reconciliation.
- Documents retain history/review/conflict tools and add DOCX text import/export.
  Tables use their dedicated editor and shared schema, not generic Canvas writes.
  Detailed source feature contracts remain in the two imported handoff documents.

## Validation in this integrated environment

- Full API/package suite: 848 passed, four skipped, 128 files (one skipped file).
- Full web suite: 91 passed in 21 files; total 939 passed.
- Standalone Data Workbench actual-worker regression: 10/10 passed, including
  800K cells, literal/Unicode content, injection-safe CSV and cancellation.
- API/web/DB/contracts and selected E2E TypeScript passed; scoped ESLint and
  Prettier, secret scan and diff checks passed.
- Contracts/API production compilation and Next webpack production build passed
  (19 routes). Twenty selected Playwright scenarios were discovered.
- Browser execution is unconfirmed: direct Chromium launch reports the absent
  headless-shell executable. The default E2E webServer command also trips pnpm's
  dependency-install check in this partial checkout. Neither is a browser pass.

No new migration, dependency, paid model request, deployment or merge. Earlier
source handoffs describe their own historical environments and deployments;
those are not evidence that this combined branch has been deployed or browser-tested.
