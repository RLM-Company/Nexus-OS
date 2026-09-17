# Unlimited GPT audit — 2026-09-18

## Baseline and scope

Read-only audit baseline: `origin/main` at `59c7c2ba96e405a260ec05d360cad60026bca1ea` (`feat(web): add read-only model connection status page (#144)`).

Reviewed the root README, current readiness/checkpoint/handoff material, `apps/web`, the public API contracts used by the web UI, Model Runtime composition at a read-only level, repository environment templates and the existing browser suite. The root-level `AGENTS.md` requested in the handoff does not exist on this baseline; `apps/web/AGENTS.md` does exist and was used for web-specific guidance.

This document does not modify `apps/api`, Model Gateway, Policy Engine, Tool Runtime, database/migrations, Model Registry, step-up, A6, finance, production or Emergency Stop.

Pending low-risk companion PRs at audit time:

- #146 `gpt/unlimited-e2e-audit` — missing user-facing Playwright coverage;
- #147 `gpt/unlimited-web-hardening` — Model Status transient-error Retry and safe error copy;
- #148 `gpt/unlimited-user-docs` — current local-alpha user guide.

They are not assumed to be merged into this audit baseline.

## Executive result

The existing local mock/demo shell is structurally coherent: ordinary chat is separated from projects, project creation is explicit, the real Next.js routes are reachable, the README explicitly says that autonomous Manager/worker execution is not ready, and no confirmed UI call to a nonexistent API route was found in the audited flows.

The main readiness gap is not a hidden web defect: `main` still describes and implements a controlled Manager demo/contract foundation rather than the live Manager Runtime plus safe tools required for the intended internal alpha. That integration is the primary alpha blocker. Separately, two concrete web defects remain on `main`: raw technical error codes can reach the user, and rapid repeated project confirmation is not guarded against a duplicate POST.

## TODO / FIXME

Repository code search for `TODO` and `FIXME` returned no hits on the audited baseline. This is not proof that no unfinished behavior exists: several surfaces intentionally describe themselves as placeholders or future integrations without using TODO/FIXME markers.

Important intentional incomplete surfaces are visible in `apps/web/src/app/page.tsx`:

- **Code** says execution will appear after safe model/tool connection;
- **Мультиагент** says activation of real agents is disabled;
- **Изображения / Видео / Sound** prepare or store prompts locally and describe external model connection as a later stage;
- external actions remain disabled in the current capability workspace.

These are not dead buttons; they are reachable placeholder surfaces and must not be represented as completed runtime functionality.

## Routes and reachability

Actual top-level Next.js app routes on the baseline are:

- `/` — main console and in-page capability surfaces;
- `/agent-studio`;
- `/control-center`;
- `/model-status`.

No unreachable actual Next.js page was confirmed. Agent Studio and Control Center are linked from the console; Model Status is linked from the model connection status. `Skills`, `Code`, `Work`, `Изображения`, `Видео`, `Sound` and `Мультиагент` are intentionally in-page surfaces controlled by `surface`, not separate routes.

One reachability/empty-state issue remains on mobile: when there are zero projects, tapping **Проекты** calls `newChat()` instead of entering an explicit empty projects state. File: `apps/web/src/app/page.tsx`, mobile navigation handler near the end of the component. Reproduction: start with a fresh database with no projects, use a 390×844 viewport, tap **Проекты**; the console returns to **Новый чат** and never shows a dedicated “no projects” state.

## README currency

No directly false or stale README assertion was confirmed against this baseline in the audited areas. In particular, README correctly states that:

- autonomous Manager and worker-agent task-graph execution are not implemented yet;
- external tool effects are not connected to an autonomous agent loop;
- the local Manager flow is an internal controlled demo;
- phone LAN mode is a temporary trusted-network preview;
- plain LAN HTTP is not enough for installing the PWA to a phone home screen;
- production provider/secret-manager choices are not final.

The main terminology risk is presentational rather than factual: headings such as **Install the Manager Console as an app** can sound more complete than the runtime really is when read out of context. The surrounding README boundary text is correct, and PR #148 adds a shorter user guide that repeats the limitation next to the operating instructions.

## Secrets audit

No committed live credential was confirmed in the reviewed source/configuration material. `.env.example` uses placeholders such as `replace-locally-never-commit`; `.gitignore` excludes `.env` and `.env.*` while explicitly allowing only `.env.example`. The Model Status UI consumes only provider/model/runtime metadata and does not render an API-key field.

The authoritative repository-level confirmation remains the `check:secrets` stage inside `pnpm check`. The final-audit PR must not be declared ready unless that full gate passes.

## UI / API correspondence

Confirmed matching user-facing contracts on the baseline include:

- ordinary chat list/create/detail plus chat-run SSE and cancel endpoints;
- project create/detail plus project-run SSE and cancel endpoints;
- `/api/v1/model-runtime` and the Model Status metadata shape;
- project autonomy-profile reads;
- Manager demo run list/create/execute/cancel endpoints;
- confirmation and recovery-required reads used by the console.

The existing API tests (`general-chat-api.test.ts`, `manager-background-run-coordinator.test.ts`, `demo-manager-api.test.ts`, `model-runtime.test.ts` and related suites) cover the server side of these primary flows. No confirmed web request to a missing route was found.

There is, however, an interface-boundary problem in `apps/web/src/app/page.tsx`: the generic `api()` helper forwards `error.message` from an API response directly to the visible UI, and SSE failure handlers/terminal message rendering expose `error_code` directly. This means internal provider/runtime codes can become user-visible even when they are not useful to the user.

## Priorities

### P0 — blockers for the intended local working alpha

#### P0.1 Live Manager Runtime is not integrated on `main`

**Files/evidence:** `README.md` current boundary; `apps/api/src/model-runtime.ts`; Manager demo/runtime handoff material.

**Current state:** the repository has Model Gateway/Chat/Manager service foundations and a controlled Manager demo, but README explicitly states that Manager and worker agents do not execute task graphs or make model calls as agents yet.

**Reproduction:** run the current local demo and inspect the Manager flow; it is the controlled server-persisted demo workflow, not a live autonomous/agent runtime executing a task graph.

**Alpha impact:** if the September 19 alpha definition requires a Manager that can genuinely reason with the connected live model, this is blocking. It is already assigned to the parallel runtime/model workstream and should not be fixed in this low-risk audit branch.

#### P0.2 Safe external/code tool execution is not connected

**Files/evidence:** `README.md` current boundary and `apps/web/src/app/page.tsx` capability surfaces.

**Current state:** Code explicitly says tools will appear after safe model/tool connection; Multi-agent says real agents are disabled; external actions are disabled.

**Reproduction:** open **Code**, **Work** or **Мультиагент** from the console. The UI describes the safety boundary instead of providing a live external action loop.

**Alpha impact:** blocking only if the September 19 alpha requires Manager-driven actions, repository edits or other real tools. It is not a blocker for a chat-only local alpha.

### P1 — should be fixed before relying on the alpha daily

#### P1.1 Internal technical error codes can leak into user-facing copy

**File:** `apps/web/src/app/page.tsx`.

**Evidence:** `displayedContent()` and `displayedGeneralContent()` render `message.error_code`; the ordinary-chat `run.failed` SSE handler sets `Ответ остановлен: ${error_code}`; the generic `api()` helper uses server `error.message` verbatim.

**Reproduction:** make a run fail with a provider/runtime-specific error code. The error code is rendered directly in the conversation/footer instead of a stable user-facing explanation.

**Risk:** confusing UX and unnecessary exposure of internal implementation vocabulary. Do not solve this by hiding failures completely; map known failures to safe user copy while retaining detailed diagnostics in server logs/trace surfaces.

#### P1.2 Project promotion can be submitted twice

**File:** `apps/web/src/app/page.tsx`.

**Evidence:** `promoteToProject()` guards `projectProposal`, `activeLocalChatId` and `loading`, then sets `sending=true`, but does not guard `sending`; the **Оформить как проект** button is not disabled while the POST is pending. Each call also creates a new `client_message_id`.

**Reproduction:** create a complex-chat project proposal, delay `POST /api/v1/projects`, then rapidly activate **Оформить как проект** twice. Two independent project-create requests can be issued before the first response resolves.

**Risk:** duplicate projects from one user intention. The fix belongs in `apps/web` and should add both function-level and disabled-state protection plus an E2E race test.

### P2 — polish / resilience

#### P2.1 Model Status on `main` has no in-place Retry

**Files:** `apps/web/src/app/model-status/page.tsx`, `model-status.module.css`, `apps/web/e2e/model-status.spec.ts`.

**Reproduction:** return HTTP 503 once from `/api/v1/model-runtime`. The baseline page shows a generic error and tells the user to refresh the whole page.

**Status:** addressed in pending PR #147 with an explicit Retry, loading transition, focus-visible treatment and a test that backend debug text is not rendered.

#### P2.2 Mobile Projects navigation has no true empty state

**File:** `apps/web/src/app/page.tsx`.

**Reproduction:** fresh database, 390×844, tap **Проекты**. With no project, the handler calls `newChat()`.

**Impact:** the navigation label promises a Projects destination but silently returns the user to New Chat. Add a small empty-project state rather than creating a project automatically.

#### P2.3 Root developer instruction file requested by the handoff is absent

**Evidence:** root `AGENTS.md` was not present and repository search did not locate another root copy; only `apps/web/AGENTS.md` was found for this scope.

**Impact:** contributors following a handoff that says “read AGENTS.md” have an ambiguous first step. This is a repository-process issue, not an alpha runtime blocker.

## What blocks a local working alpha by September 19

For an internal **chat + live Manager + safe actions** alpha, the blocking sequence is:

1. Connect and validate one live provider end to end with the local secret path, registry route and secret-free status surface.
2. Complete the live Manager Runtime path so Manager behavior is model-backed rather than only the controlled demo/contract foundation.
3. Connect the minimum approved safe-tool set required by the alpha; keep dangerous/external effects gated and observable.
4. Finalize the minimum owner-approved Manager system prompt needed for that runtime. Do not wait for A6/production policy work if the alpha remains within the already accepted low autonomy scope.
5. Merge the independent low-risk web/E2E/docs PRs only after their full gates pass, then run `pnpm check` again on the integrated `main` and perform a Windows + trusted-LAN phone smoke test.

The following are **not** required blockers for this local internal alpha unless its scope is expanded: A6, production deployment, finance automation, production Secret Manager, unrestricted external actions, or real multi-agent autonomy.

## Recommended merge order after review

Because all companion branches start independently from `main`, they do not need to be stacked. A practical order is E2E audit (#146), web hardening (#147), user docs (#148), then this audit document. After merges, rerun the full gate on integrated `main` to catch interaction or formatting drift.
