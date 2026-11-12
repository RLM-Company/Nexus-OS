# Kosmora four-block draft checkpoint — 2026-10-11

## Scope and provenance

This is a **code-reference draft** built from the remote GitHub `main` at `62bc5234b24e3b0c10262b043063fd31be9732bd`. It does not change the application source tree, release configuration, deployed services, or `main`.

The four examples below are **exact snapshots of previously written code** from commit `8cead61b9b717d54fd84e3de22491dedf2df9d41` (Draft PR #319), staged under `prototypes/` for inspection. These are **not an integrated feature**, and **no new tests have been executed for this branch**. The original message did not name the four requested feature blocks explicitly; this draft uses the four already documented workstreams of PR #319 without claiming they are a final agreed scope.

| Block | Source in PR #319 | Staged reference |
| --- | --- | --- |
| Ordinary chat draft recovery | `apps/web/src/app/composer-draft-storage.ts` | `chat/composer-draft-storage.ts` |
| GitHub / Code local workspace | `apps/web/src/app/github/github-workspace.ts` | `code/github-workspace.ts` |
| Studio CSV parsing and selection | `apps/web/src/app/studio-csv.ts` | `studio/studio-csv.ts` |
| Windows server/download policy | `desktop/windows/connection-policy.cjs` | `windows/connection-policy.cjs` |

All paths in the last column are relative to `prototypes/kosmora-blocks/`.

## Sources and integration

- Draft PR #319: https://github.com/RLM-Company/Nexus-OS/pull/319
- Related chat integration: https://github.com/RLM-Company/Nexus-OS/pull/316
- Related GitHub editor: https://github.com/RLM-Company/Nexus-OS/pull/314
- Follow-on personal chat/hosted runtime: https://github.com/RLM-Company/Nexus-OS/pull/320

Do not treat these copied modules as drop-in replacements: the chat module imports `@cosmora/contracts/chat-attachments`; each original module may have other integration dependencies and tests in its source PR stack. The repository `main` is behind this source commit. Cherry-pick or port only after checking API, contracts, package dependencies, types and tests against the desired integration base.

## Acceptance and remaining work

- [x] Dedicated branch based on remote `main`
- [x] Source-code prototype snapshots, one per existing workstream
- [x] Review checkpoint with source commit and paths
- [ ] Confirm that these workstreams match the four originally requested blocks
- [ ] Integrate into live `apps/` and `desktop/` paths if desired
- [ ] Run tests, typecheck, security checks, Windows lifecycle and relevant CI
- [ ] Review integration and decide separately whether any part should merge

**Status: draft for review, not merge-ready.** There is no automatic merge or deployment.
