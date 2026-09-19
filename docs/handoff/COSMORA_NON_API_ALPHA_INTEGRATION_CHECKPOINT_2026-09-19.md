# Cosmora non-API local-alpha integration checkpoint — 2026-09-19

## Status

A single non-API integration candidate is assembled in **PR #191**:

`codex/non-api-alpha-integration-2026-09-19`

The default branch remains:

`main@403ed7143f062bb005a21c2fe1dde53434394e2a`

Nothing is merged automatically. Owner authorization is still required before changing `main`.

## Integrated scope

PR #191 contains every changed file from the green component work #146–#190 that remains relevant to
the local-alpha web release, including:

- ordinary-chat / project separation and explicit project confirmation;
- persisted workspace surface and safe browser-storage fallbacks;
- distinct running / streaming UI state and guarded same-origin stream URLs;
- main-console API-error redaction and duplicate-submit locks;
- safe Project Context preview, per-project isolation, source preview, explicit clear confirmation,
  bounded state, source-ID integrity, context-budget enforcement and secret-like metadata redaction;
- keyboard-accessible Project Context dialogs and project tabs;
- Skills preview with read/preview-only permissions and isolated mock manifest data;
- GitHub mock/read-only preview with strict `https://github.com` URL sanitization and disabled writes;
- Agent Studio / Control Center safe errors, accessible feedback, mobile coverage and synchronous
  Agent Studio mutation locks;
- model-status retry and safe error UX;
- browser/PWA install dialog focus handling, safe prompt failure feedback and duplicate-prompt lock;
- mobile coverage for all main workspaces and active mobile navigation semantics;
- Image / Video / Sound local-only prompt preparation with accurate transient wording;
- reduced-motion handling and visible keyboard focus for media prompt fields;
- expanded non-paid local preflight checks;
- updated README and local user guide.

## Verification evidence

All source component PR heads used to build #191 had green CI before integration.

The first combined #191 quality-gate run reached Playwright after passing:

- Prettier;
- secret scan;
- lint;
- typecheck;
- unit tests;
- build.

That run produced **82 passed / 2 failed** E2E scenarios. Both failures were the same test-fixture race:
a synthetic `beforeinstallprompt` event could fire before the React listener was mounted. Production
install behavior was not the failing assertion.

The integration branch now uses the previously green hydration-safe install-prompt fixture, which
re-publishes the synthetic event until the listener has actually exposed the install control.

**Release condition:** the current PR #191 head must pass the complete `pnpm check` quality gate before
the PR is marked ready for merge review.

## Scope guard

The integrated diff intentionally contains no changes to:

- `apps/api`;
- `packages/model-gateway`;
- `packages/policy-engine`;
- `packages/tool-runtime`;
- `packages/db` or migrations;
- Model Registry;
- step-up policy;
- A6 behavior;
- finance;
- production;
- Emergency Stop;
- package manifests or lockfiles;
- CI workflows;
- `.env` or secret values.

No paid model request is used as release evidence.

## Product boundary

This checkpoint does **not** claim production readiness or an autonomous company runtime.

Manager and worker agents still do not execute arbitrary task graphs or external effects autonomously.
Project Context is a browser-local preview and is not authoritative Manager Runtime memory.
Skills execution and real GitHub writes remain disabled in these preview surfaces.

## Remaining owner-only / manual gates

1. Explicit merge authorization for the final green integration candidate.
2. Local `MODEL_API_KEY` configuration when live-model use is desired.
3. Non-paid preflight before any live model request.
4. Separate permission before real GitHub backend/write integration.
5. Physical phone/LAN dry run for the exact hardware/network path that will be demonstrated.

## Merge discipline

Prefer the single green integration candidate #191 over independently merging overlapping component PRs.
If #191 is approved later, use a normal reviewed merge/squash flow; do not bulk-merge the component stacks
on top of it.
