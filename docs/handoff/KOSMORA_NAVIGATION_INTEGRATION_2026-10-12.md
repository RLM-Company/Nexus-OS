# Kosmora navigation branch integration — 12 October 2026

Integrated the six commits from draft PRs #324 (pinning), #325 (quick switcher) and
#326 (project rename) onto local `2450263`, preserving current voice/composer,
chat settings/search, ZIP export, Canvas and executor configuration. The original
branches start from the older `7e12e12` snapshot; cherry-pick conflicts in `page.tsx`
were resolved by keeping both existing controls and the new ones. No graph branch,
default branch, source PR or production data was merged/deleted.

Added integration corrections:

- Pins are scoped to the authenticated owner and browser origin. A private/no-store
  owner context read exposes only `owner_id`; legacy unscoped keys are not migrated.
  Missing owner context/storage degrades to ephemeral pins with a visible notice.
- Pin order preserves server order within both groups; opening a chat does not reorder
  it. Pin button accessible names remain distinct from navigation titles.
- Ctrl+K does not stack on an existing modal, respects IME composition and restores
  the prior focused control on Escape. Search/navigation never sends an AI request.
- Project rename uses the strict TypeBox validator: null/numeric/boolean input is
  rejected rather than coerced. Ownership is enforced in SQL; another owner's project
  returns 404. The project title/list update immediately and survive reload.

Validation: 20 project API/pin unit cases passed, including actual SQLite persistence,
foreign-project HTTP rejection and strict invalid input. Fifteen Chromium cases passed
together: pin reload/account isolation, draft/focus/modal boundary, project rename,
mobile quick switcher and existing search/export regressions. These use local fixtures
and a mock provider. Web/API typecheck, scoped ESLint, format, diff and secret checks
passed. No paid AI request. API changes use existing columns and require no migration.

Deployment is recorded below only after verification. The source PRs remain draft;
CI results from their older bases are not proof for this integrated checkout.
