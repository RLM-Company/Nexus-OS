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

5. **#162 — Project Context preview**
   - browser-local mock context only;
   - source preview is required before connecting a new source;
   - connect, disconnect and explicit clear confirmation are implemented;
   - local state is bounded, validated and scoped to the active project before persistence;
   - secret-like source metadata is redacted for rendering and scrubbed from normalized persisted state;
   - offline, reload and 390×844 mobile coverage are included;
   - the missing backend/runtime contract is documented separately;
   - CI run `35393253569` passed with 48 Playwright scenarios.

All five PRs are open, ready for review and mergeable.

Their diffs contain no:

- `.env`;
- `apps/web/next-env.d.ts`;
- package or lockfile changes;
- CI changes;
- forbidden backend packages;
- real credential literals;
- conflict markers.

## Other green PRs

- **#146** — user E2E audit coverage, CI #563 passed.
- **#147** — model runtime status retry/error UX, CI #566 passed.
- **#148** — local user guide, CI #565 passed.
- **#164** — Control Center and Agent Studio mobile smoke coverage at 390×844; CI run `35392811767` passed with 35 Playwright scenarios.
- **#165** — owner-surface API error redaction; CI run `35391174018` passed with 35 Playwright scenarios.
- **#166** — Agent Studio accessible success/error feedback, stacked on #165; CI run `35392815371` passed with 36 Playwright scenarios.

The user guide explicitly states that `manager:smoke` is paid.
It requires separate authorization.

These PRs are not merged automatically.

## Alpha acceptance status

Passed:

- ordinary chat remains separate from projects;
- complex tasks propose a project instead of auto-creating one;
- project creation requires confirmation;
- reload preserves console UI state;
- streaming and running states remain observable;
- 390×844 console and owner-surface coverage exists;
- main-console and owner-surface API errors hide internal details;
- unsafe stream URLs fail closed;
- model-status retry/error UX is covered;
- Skills has a safe preview;
- GitHub has a safe read-only preview;
- Project Context has a bounded browser-local preview with explicit source confirmation;
- Project Context state is isolated by project before persistence;
- secret-like Project Context metadata is scrubbed from normalized browser-local state;
- Agent Studio success/error feedback is exposed through accessible live regions.

Owner-local:

- real model connection using a local `MODEL_API_KEY`;
- non-paid preflight before live use.

Owner permission required:

- real GitHub backend integration.

Manual hardware/network validation:

- physical phone/LAN dry run.

Not ready:

- production or autonomous system claims;
- autonomous Manager/worker task-graph execution.

## Security and scope boundaries preserved

The release stack and follow-up web PRs do not change:

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
2. Add `MODEL_API_KEY` only in the owner's local environment when live-model use is desired.
3. Run non-paid preflight before any live model request.
4. Give separate permission before real GitHub backend work.
5. Perform a physical phone/LAN dry run if that path will be shown.

## Merge discipline

Do not bulk-merge stacked PRs blindly.

Core stack order:

`#153 → #157 → #160 → #161 → #162`

Owner-surface stack order:

`#165 → #166`

Independent green PRs:

`#146`, `#147`, `#148`, `#164`.

After each stacked merge:

1. refresh `origin/main`;
2. retarget or rebase the next PR as needed;
3. verify the intended diff;
4. run the full quality gate;
5. merge only after the updated target is green.

## Superseded and stale work

- #149 is closed historical readiness work and is not the current readiness source.
- #151 is closed and superseded by the green #162 Project Context implementation.
- superseded intermediate release PRs were closed without merge.

## Current conclusion

The local-alpha web release candidate, including the safe Project Context preview, is green.

There is no remaining known P0/P1 defect in this verified web release slice.

The remaining gates are integration/merge authorization, owner-local live-model configuration, optional real GitHub backend permission and physical phone/LAN validation.

This is not evidence of production readiness.
It is not evidence of an autonomous company runtime.
