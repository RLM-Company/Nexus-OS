# Cosmora PR backlog audit — 2026-09-22

**Repository:** `RLM-Company/Nexus-OS`  
**Audit branch:** `codex/day-pr-backlog-audit`  
**Remote main audited:** `b2b5030abbfba72ae61ac018bbcec6dd64bff2cb`  
**Audit scope:** open PR backlog only; no merge, close, rebase, code transfer, product edits, dependency changes, CI edits, secrets or paid model requests.

## 1. Current main state

The current remote `main` head is still:

`b2b5030abbfba72ae61ac018bbcec6dd64bff2cb` — `feat(contracts): define Google and Telegram auth flow (#214)`.

Immediately before it:

- `479c01626e71e5e1f6cb69f9bdd4f95514f82d52` — #213, live companion preferences;
- `7acf996832b22b24d0b4ce2b072a07ab1c5d7d9c` — #210;
- the hardening sequence #191–#210 is already represented in `main`.

The merged #191 commit `e4f8b2b8da982f47b97dc8344e58285e87f4b182` is the key cleanup boundary for the old web stack. Its merge description explicitly says it integrated the currently green non-API local-alpha work, and its changed-file set contains the production/test/doc files represented by the still-open component PRs #146–#190.

The latest repository checkpoint under `docs/checkpoints/` remains `2026-09-02-blocks-78-84-step-5-verification.md`. Newer readiness/integration records live under `docs/handoff/`, including the merged #191 non-API integration checkpoint.

### Remote freshness note

This audit was performed directly against GitHub's current remote refs and commit objects. The available GitHub connector does not expose a local shell, so a literal local `git fetch --all --prune` cannot be executed here. To avoid stale local state, the branch is created from the exact current remote `main` SHA above rather than from a cached checkout.

## 2. Open PR audit

| PR   | назначение                  | актуальность           | уникальные изменения | риск                  | зависимость                     | рекомендуемое действие             |
| ---- | --------------------------- | ---------------------- | -------------------- | --------------------- | ------------------------------- | ---------------------------------- |
| #146 | E2E user audit              | в main через #191      | нет                  | stale stack           | #191                            | закрыть как устаревший             |
| #147 | Model Status retry UX       | в main через #191      | нет                  | stale stack           | #191                            | закрыть как устаревший             |
| #148 | Local user guide            | в main через #191      | нет                  | conflict              | #191                            | закрыть как устаревший             |
| #153 | Console persistence         | в main через #191      | нет                  | conflict              | #191                            | закрыть как устаревший             |
| #157 | Console security            | в main через #191      | нет                  | overlap               | #153 → #191                     | закрыть как устаревший             |
| #160 | Skills preview              | в main через #191      | нет                  | stale stack           | #157 → #191                     | закрыть как устаревший             |
| #161 | GitHub mock preview         | в main через #191      | нет                  | stale stack           | #160 → #191                     | закрыть как устаревший             |
| #162 | Project Context             | в main через #191      | нет                  | large overlap         | #161 → #191                     | закрыть как устаревший             |
| #163 | Release checkpoint          | в main через #191      | нет                  | duplicate docs        | #191                            | закрыть как устаревший             |
| #164 | Mobile owner E2E            | в main через #191      | нет                  | stale test            | #191                            | закрыть как устаревший             |
| #165 | Owner error redaction       | в main через #191      | нет                  | conflict              | #191                            | закрыть как устаревший             |
| #166 | Agent Studio a11y           | в main через #191      | нет                  | stale stack           | #165 → #191                     | закрыть как устаревший             |
| #167 | Context recovery test       | в main через #191      | нет                  | stale stack           | #162/#173 → #191                | закрыть как устаревший             |
| #168 | Context dialog a11y         | в main через #191      | нет                  | stale stack           | #162/#173 → #191                | закрыть как устаревший             |
| #169 | Workspace fallback test     | в main через #191      | нет                  | stale stack           | #162 → #191                     | закрыть как устаревший             |
| #171 | iOS install a11y            | в main через #191      | нет                  | conflict              | #191                            | закрыть как устаревший             |
| #172 | sessionStorage failsafe     | в main через #191      | нет                  | stale stack           | #162 → #191                     | закрыть как устаревший             |
| #173 | Context hardening aggregate | в main через #191      | нет                  | obsolete aggregate    | #168 → #191                     | закрыть как устаревший             |
| #174 | Agent Studio submit lock    | в main через #191      | нет                  | stale stack           | #166 → #191                     | закрыть как устаревший             |
| #175 | Cross-project context test  | в main через #191      | нет                  | stale test            | #173 → #191                     | закрыть как устаревший             |
| #176 | Install failure handling    | в main через #191      | нет                  | stale stack           | #171 → #191                     | закрыть как устаревший             |
| #177 | GitHub URL sanitization     | в main через #191      | нет                  | stale stack           | #161 → #191                     | закрыть как устаревший             |
| #178 | Skills manifest isolation   | в main через #191      | нет                  | stale stack           | #160 → #191                     | закрыть как устаревший             |
| #179 | Project tab keyboard        | в main через #191      | нет                  | stale stack           | #173 → #191                     | закрыть как устаревший             |
| #180 | Local media prompts         | в main через #191      | нет                  | stale test            | #191                            | закрыть как устаревший             |
| #181 | Mobile workspace E2E        | в main через #191      | нет                  | stale test            | #191                            | закрыть как устаревший             |
| #182 | Mobile nav semantics        | в main через #191      | нет                  | stale stack           | #191                            | закрыть как устаревший             |
| #183 | Install prompt lock         | в main через #191      | нет                  | stale stack           | #176 → #191                     | закрыть как устаревший             |
| #184 | Extended preflight          | в main через #191      | нет                  | stale scripts         | #191                            | закрыть как устаревший             |
| #185 | Viewport color scheme       | в main через #191      | нет                  | stale UI              | #191                            | закрыть как устаревший             |
| #186 | Transient media copy        | в main через #191      | нет                  | stale UI              | #180 → #191                     | закрыть как устаревший             |
| #187 | Reduced motion              | в main через #191      | нет                  | stale UI              | #191                            | закрыть как устаревший             |
| #188 | Media focus ring            | в main через #191      | нет                  | stale UI              | #191                            | закрыть как устаревший             |
| #189 | Invalid project route       | в main через #191      | нет                  | stale test            | #173 → #191                     | закрыть как устаревший             |
| #190 | Quoted secret redaction     | в main через #191      | нет                  | security overlap      | #173 → #191                     | закрыть как устаревший             |
| #203 | Extended non-API aggregate  | устарел; non-mergeable | нет                  | 53 commits / conflict | #191 + #192–#202                | закрыть как устаревший             |
| #211 | Server GitHub read-only     | уникален, но forbidden | да                   | apps/api; 11 behind   | owner backend decision          | заблокировать до решения владельца |
| #212 | Settings/Login/Companion    | актуален; CI green     | да                   | 3 behind; scoped UI   | current main; review after #215 | оставить                           |
| #215 | Communication profile       | актуален; CI green     | да                   | low; current main +1  | none                            | оставить                           |

## 3. Why #146–#190 should not be merged individually

Merged PR #191 is the authoritative integration point. Its commit includes the exact families of files represented by these still-open component PRs:

- console persistence/security;
- Skills preview;
- GitHub mock/read-only preview;
- Project Context and its integrity/redaction/accessibility/isolation follow-ups;
- Agent Studio and Control Center UI hardening;
- Model Status retry/error UX;
- install/PWA hardening;
- mobile and accessibility coverage;
- local-only media guarantees;
- preflight scripts;
- user guide and release checkpoint.

Therefore the old component PRs are historical stacked inputs, not independent current candidates. A previous green CI result on one of those branches does not prove that merging that old branch into today's `main` is safe.

## 4. #203 disposition

#203 is an obsolete aggregate.

Its own description says it extends #191 with the later hardening from #193/#195/#197/#198/#199/#200/#201/#202. Current `main` already contains #191 and the individual merged hardening sequence #192–#202, followed by #204–#210, #213 and #214.

Current GitHub state also reports #203 as non-mergeable. No code should be transplanted from it unless a future targeted diff proves a specific missing behavior; this audit found no such missing increment from the PR's declared scope.

## 5. PRs that must not be merged from the backlog as-is

### Obsolete/superseded

#146, #147, #148, #153, #157, #160, #161, #162, #163, #164, #165, #166, #167, #168, #169, #171, #172, #173, #174, #175, #176, #177, #178, #179, #180, #181, #182, #183, #184, #185, #186, #187, #188, #189, #190, #203.

### Blocked by forbidden area

#211 — directly modifies `apps/api` and therefore cannot proceed under the current owner constraints.

## 6. Unique changes worth preserving

No open PR requires code transfer into a new clean branch at this checkpoint.

- #212 is already an isolated web/docs candidate. Preserve it as an open PR and refresh/revalidate it before any future merge.
- #215 is already a clean one-commit contract PR on top of current `main`. Preserve it as an open PR.
- #211 contains genuinely unique GitHub server-side read-only work, but because its value is inseparable from an `apps/api` change in the current PR, it is owner-blocked rather than a transfer candidate today.

If the owner later authorizes the backend/API direction for #211, re-audit it from fresh `main` and decide whether to split provider-neutral contracts/web wiring from the API adapter. Do not perform that split without the owner decision.

## 7. Conflict and stale-base risks

- #148, #153, #165, #171 and #203 are currently reported non-mergeable.
- #203 is the largest cleanup risk: 53 commits / 76 files and a stale aggregate over changes already landed elsewhere.
- The old #146–#190 branches diverged before the #191 integration and before later current-main hardening. Even when GitHub reports an old component PR as mergeable, merging it would reintroduce stale history and overlap with already-integrated files.
- #211 is mergeable but is 11 commits behind current main and touches a forbidden API boundary.
- #212 is mergeable but 3 commits behind current main. Its CI is green, but future merge consideration should use refreshed current-main CI rather than treating the historical branch result as sufficient.
- #215 is the cleanest surviving branch: one commit ahead, zero behind, CI green.

## 8. Safe order for further PR work

1. Do not merge anything from this audit branch.
2. Treat #215 as the first surviving candidate for owner/release review because it is current-main +1 and green.
3. Keep #212 open, refresh/rebase it onto the then-current main after #215 is decided, and rerun the full gate before any merge decision.
4. Keep #211 blocked until the owner explicitly decides whether `apps/api` work is allowed.
5. Close the historical component PRs #146–#190 as superseded by #191 when the owner authorizes cleanup actions.
6. Close #203 as obsolete after the same owner-authorized cleanup pass.
7. After closures, re-list open PRs and verify that only intentional active work remains.

## 9. Plan for the next cleanup day

- Reconfirm remote `main` and open PR list before any mutation.
- If owner authorizes backlog cleanup, close #146–#190 in clearly documented superseded batches referencing merged #191.
- Close #203 as superseded by merged #191 + #192–#202.
- Rebase/refresh #212 only in its own branch; do not mix it with the audit branch.
- Re-run full CI on refreshed #212.
- Review #215 independently; do not change communication contracts from the audit branch.
- Ask for an explicit owner decision before touching #211 or any `apps/api` path.
- Re-run backlog audit after cleanup to ensure no useful unique increment was orphaned.

## 10. Counts

- **оставить:** 2 PRs — #212, #215
- **перенести отдельным новым PR:** 0
- **закрыть как устаревший:** 36
- **заблокировать до решения владельца:** 1 — #211
- **total open PRs audited:** 39

## 11. CI evidence available before this audit PR

- #211 head CI: success, but scope is blocked by `apps/api`.
- #212 head CI: success.
- #215 head CI: success.
- #191 merged integration candidate recorded full `pnpm check` success and 84 Playwright scenarios before merge.

A fresh full `pnpm check` for this documentation-only audit must be taken from the audit branch itself. The repository CI workflow is configured so every pull request installs frozen dependencies, installs Playwright Chromium, and runs exactly `pnpm check`.
