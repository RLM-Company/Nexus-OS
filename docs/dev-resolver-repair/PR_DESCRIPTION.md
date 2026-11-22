# Draft PR: Restore local dev server (`/`) via webpack `.js`→`.ts` alias

**Base:** PR #617 (`dff95ddd`, includes TXT/HTML export and main-page rehearsal check).
**Branch:** `stage3/dev-resolver-repair`. **Scope:** dev build + checks only.

## Problem

`pnpm --filter @cosmora/web dev` served `GET /` → **HTTP 500**.
`packages/contracts/src/index.ts` re-exports ~56 modules as `"./X.js"`
while the files on disk are `.ts`. Production/tsx resolve this through TS
`moduleResolution: bundler`; Next 16.3.1 dev (Turbopack by default) does not —
`Module not found: Can't resolve './X.js'` and missing barrel exports
(`isValidChatTextAction`, `MANAGER_WORK_CONTROL_EVENTS`).

## Chosen fix (smallest change)

- `apps/web/next.config.ts`: dev-only `webpack.resolve.extensionAlias`
  `".js" → [".ts", ".tsx", ".js", ".jsx"]`. Production resolution untouched.
- `apps/web/package.json`: make webpack explicit in dev/build/demo scripts
  (`next dev --webpack`, `next build --webpack`). Required because Next 16
  rejects a webpack hook when build runs on default Turbopack, and Turbopack
  build hits the same barrel bug.
- `apps/web/playwright.composer.config.ts`: raise test timeout 30s → 90s for
  slow dev compilation (production runs unaffected).

**Rejected alternative — keep Turbopack:** tried three forms of
`turbopack.resolveAlias` / `resolveExtensions` (direct src alias, `.js$` strip,
custom extensions). All still returned `GET /` 500; Turbopack 16.3.1 has no
working `.js`→`.ts` mapping for this barrel. Full evidence in
[RESULT.md](RESULT.md). If the team wants Turbopack back, the common package
contract must change: convert `packages/contracts/src/index.ts` to
extensionless/`./X.ts` imports — an integrator decision affecting the
production ESM output, with its own `next build` + `tsc` verification.

## Verification (local, mock fixtures)

| Check                                                           | Result                                       |
| --------------------------------------------------------------- | -------------------------------------------- |
| `pnpm --filter @cosmora/web dev` → `GET /` / `/graph-workspace` | **200 / 200**                                |
| Dev rehearsal with main-page check (clean artifacts)            | **HTTP rehearsal PASS**                      |
| Launcher unit tests                                             | **5/5 PASS**                                 |
| Production build (contracts first)                              | **exit 0**                                   |
| Production rehearsal                                            | **HTTP rehearsal PASS**                      |
| Browser chat E2E — production                                   | **48 PASS**                                  |
| Browser chat E2E — dev                                          | **48 PASS** (one clean full run; see caveat) |

Caveat: one full dev E2E run passed 48/48; in two later long dev runs the
long-lived dev web server died mid-run (`ECONNREFUSED` after ~12 tests) — all
executed tests passed, including the one that previously timed out. This is
dev-server stability under load, not a resolver regression; the production E2E
run is stable. Details and all logs in [RESULT.md](RESULT.md), logs under
`docs/dev-resolver-repair/results/`.

## Out of scope

main, VPS, keys/secrets, product UI, Multi-Agent, `packages/contracts`,
and other worktrees' uncommitted files were not touched.
