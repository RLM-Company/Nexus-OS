# Cosmora local-alpha release checkpoint — 2026-09-18

## Executive status

**Local PC alpha candidate: READY in green, unmerged release PRs.**

**Current `origin/main`:**
`403ed7143f062bb005a21c2fe1dde53434394e2a`
(`feat: add guarded live model smoke test (#150)`).

The release work below is intentionally **not merged**. The owner must explicitly authorize merge.
Production readiness, autonomous A6 behavior, finance, real external effects and a production GitHub
integration are not claimed.

## Green release stack

Merge order after owner authorization:

1. **#153 — console persistence**
   - selected safe workspace persists after reload;
   - explicit streaming state;
   - project creation remains explicit;
   - mobile coverage at 390×844;
   - CI #598 PASS, 35 Playwright scenarios.

2. **#157 — security boundaries**
   - raw backend/API details are redacted from user-visible errors;
   - external/unexpected SSE URLs fail closed;
   - duplicate chat/project submissions are guarded;
   - safe retry and accessible error announcement;
   - CI #612 PASS, 38 Playwright scenarios.

3. **#160 — Skills preview**
   - mock manifest/catalog;
   - read/preview permissions only;
   - arbitrary execution disabled;
   - responsive preview;
   - CI #615 PASS, 41 Playwright scenarios.

4. **#161 — GitHub read-only preview**
   - mock repositories, branches, commits, issues, PR and CI data;
   - loading/empty/offline/error states;
   - github.com URL allowlisting;
   - branch creation, merge and deploy remain disabled preview-only controls;
   - no OAuth, tokens or GitHub write operations;
   - CI #616 PASS, 44 Playwright scenarios.

All four PRs are open, ready-for-review and mergeable. Their diffs contain no `.env`,
`apps/web/next-env.d.ts`, package/lockfile changes, CI changes, forbidden backend packages,
credential literals, conflict markers or trailing whitespace.

## Other green PRs

- **#146** — user E2E audit coverage; CI #563 PASS.
- **#147** — model runtime status retry/error UX; CI #566 PASS.
- **#148** — local user guide, including explicit warning that `manager:smoke` is paid and requires
  separate authorization; CI #565 PASS.

These are not merged automatically.

## Project Context follow-up

The old **#151** Project Context branch passed format, secret scan, lint, typecheck and build but
failed one Playwright scenario and was based on an older `page.tsx`.

A replacement **#162** is being built on top of the green release stack instead of repairing the
stale page directly. Its safe boundary is:

- browser-local mock context only;
- bounded/validated localStorage state;
- source preview before connect;
- explicit clear confirmation;
- secret-like text redaction;
- offline/reload/mobile coverage;
- no database, migrations, arbitrary file upload or Manager Runtime authority.

Until #162 is green, Project Context is not part of the release acceptance set.

## Alpha acceptance status

| Gate | Status | Evidence |
| --- | --- | --- |
| Ordinary chat remains separate from projects | PASS | existing E2E + release stack |
| Complex task proposes a project instead of auto-creating it | PASS | existing PWA/E2E coverage |
| Project creation requires confirmation | PASS | existing E2E + #157 duplicate-submit guard |
| Reload preserves console UI state | PASS | #153 |
| Streaming/running state remains observable | PASS | #153 |
| 390×844 console coverage | PASS | #153 and existing phone E2E |
| API errors hide internal details | PASS | #157 |
| Unsafe stream URL fails closed | PASS | #157 |
| Skills safe preview | PASS | #160 |
| GitHub safe read-only preview | PASS | #161 |
| Project Context preview | PENDING | #162 |
| Real model connection without paid smoke | OWNER-LOCAL | local `MODEL_API_KEY` + preflight |
| Real GitHub integration | OWNER-PERMISSION | separate backend authorization required |
| Production/autonomous system | NOT READY | intentionally out of this alpha scope |

## Security and scope boundaries preserved

The release stack does not change:

- `apps/api`;
- `packages/model-gateway`;
- `packages/policy-engine`;
- `packages/tool-runtime`;
- `packages/db` or migrations;
- Model Registry;
- step-up;
- A6;
- finance;
- production;
- Emergency Stop.

No paid model request was used as release evidence.

## Remaining owner actions

1. Explicitly authorize merge of the green PRs.
2. Add `MODEL_API_KEY` only in the owner's local environment when ready for the live model.
3. Use the non-paid preflight before any live model request.
4. Give separate permission before implementing a real GitHub backend integration.
5. Perform a physical phone/LAN dry run if the phone path will be demonstrated.

## Merge discipline

Do not bulk-merge the stack blindly.

After each merge:

1. refresh `origin/main`;
2. retarget/rebase the next PR onto the new main;
3. confirm its diff contains only its intended scope;
4. run the full quality gate again;
5. merge only after the new merge target is green.

## Superseded/stale work

- #149 is historical and should not be used as the current readiness source.
- superseded intermediate release PRs were closed without merge.
- #151 should be superseded by #162 only after #162 is green.

## Current release conclusion

The core local-alpha web release candidate is green. The remaining work is integration/owner
authorization plus optional safe follow-up surfaces. This is not evidence of production readiness or
an autonomous company runtime.
