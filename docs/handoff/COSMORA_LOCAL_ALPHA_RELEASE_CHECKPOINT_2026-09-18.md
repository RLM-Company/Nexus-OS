# Cosmora local-alpha release checkpoint — 2026-09-18

## Executive status

**Local PC alpha candidate: READY in green, unmerged release PRs.**

Current `origin/main`:

`403ed7143f062bb005a21c2fe1dde53434394e2a`

Commit:

`feat: add guarded live model smoke test (#150)`

The release work below is intentionally not merged.
The owner must explicitly authorize merge.

Production readiness is not claimed.
Autonomous A6 behavior, finance and real external effects remain out of scope.

## Green release stack

Merge order after owner authorization:

1. **#153 — console persistence**
   - safe workspace selection persists after reload;
   - project creation remains explicit;
   - streaming has a distinct UI state;
   - 390×844 coverage is included;
   - CI #598 passed with 35 Playwright scenarios.

2. **#157 — security boundaries**
   - raw backend error details are hidden from user-visible UI;
   - external or unexpected SSE URLs fail closed;
   - duplicate chat and project submissions are guarded;
   - safe retry and accessible error feedback are included;
   - CI #612 passed with 38 Playwright scenarios.

3. **#160 — Skills preview**
   - mock manifest and catalog only;
   - permissions are limited to read or preview;
   - arbitrary execution is disabled;
   - responsive coverage is included;
   - CI #615 passed with 41 Playwright scenarios.

4. **#161 — GitHub read-only preview**
   - mock repositories, branches, commits, issues, PRs and CI;
   - loading, empty, offline and error states;
   - github.com URL allowlisting;
   - branch creation, merge and deploy remain disabled;
   - no OAuth, tokens or GitHub write operations;
   - CI #616 passed with 44 Playwright scenarios.

All four PRs are open, ready for review and mergeable.

Their diffs contain no:

- `.env`;
- `apps/web/next-env.d.ts`;
- package or lockfile changes;
- CI changes;
- forbidden backend packages;
- credential literals;
- conflict markers;
- trailing whitespace.

## Other green PRs

- **#146** — user E2E audit coverage, CI #563 passed.
- **#147** — model runtime status retry/error UX, CI #566 passed.
- **#148** — local user guide, CI #565 passed.

The user guide explicitly states that `manager:smoke` is paid.
It requires separate authorization.

These PRs are not merged automatically.

## Project Context follow-up

The old **#151** Project Context branch is stale.

It passed:

- formatting;
- secret scan;
- lint;
- typecheck;
- build.

It failed one Playwright scenario.
It also modifies an older `page.tsx`.

A replacement **#162** is being built on the green web release stack.

Its intended boundary is:

- browser-local mock context only;
- bounded and validated localStorage state;
- source preview before connect;
- explicit clear confirmation;
- secret-like text redaction;
- offline, reload and mobile coverage;
- no database or migrations;
- no arbitrary file upload;
- no Manager Runtime authority.

Until #162 is green, Project Context is not part of release acceptance.

## Alpha acceptance status

Passed:

- ordinary chat remains separate from projects;
- complex tasks propose a project instead of auto-creating one;
- project creation requires confirmation;
- reload preserves console UI state;
- streaming and running states remain observable;
- 390×844 console coverage exists;
- API errors hide internal details;
- unsafe stream URLs fail closed;
- Skills has a safe preview;
- GitHub has a safe read-only preview.

Pending:

- Project Context preview through #162.

Owner-local:

- real model connection using a local `MODEL_API_KEY`;
- non-paid preflight before live use.

Owner permission required:

- real GitHub backend integration.

Not ready:

- production or autonomous system claims.

## Security and scope boundaries preserved

The release stack does not change:

- `apps/api`;
- `packages/model-gateway`;
- `packages/policy-engine`;
- `packages/tool-runtime`;
- `packages/db`;
- migrations;
- Model Registry;
- step-up;
- A6;
- finance;
- production;
- Emergency Stop.

No paid model request was used as release evidence.

## Remaining owner actions

1. Explicitly authorize merge of green PRs.
2. Add `MODEL_API_KEY` only in the owner's local environment.
3. Run non-paid preflight before any live model request.
4. Give separate permission before real GitHub backend work.
5. Perform a physical phone/LAN dry run if that path will be shown.

## Merge discipline

Do not bulk-merge the stack blindly.

After each merge:

1. refresh `origin/main`;
2. retarget or rebase the next PR;
3. verify the intended diff;
4. run the full quality gate;
5. merge only after the updated target is green.

## Superseded and stale work

- #149 is historical and is not the current readiness source.
- superseded intermediate release PRs were closed without merge;
- #151 should be superseded only after #162 is green.

## Current conclusion

The core local-alpha web release candidate is green.

The remaining work is:

- integration;
- owner authorization;
- optional safe follow-up surfaces.

This is not evidence of production readiness.
It is not evidence of an autonomous company runtime.
