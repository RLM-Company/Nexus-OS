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

## Live activation

Final source `057f35660104bf0323bfaa9cd80e00299b8a8a6e` is deployed as
`cosmora-alpha-app:navigation-api-5db34b5` and
`cosmora-alpha-app:navigation-web-5db34b5`. The release directory retains its earlier
short revision name; both image revision labels contain the final full source SHA.
The ten-file source archive is 67,870 bytes, SHA-256
`195b6efdea985e5c9ca12f63956179aeb4f849ebc0653839721e6ca1e9880f37`.
Both production images built with networking disabled.

The first activation rolled back before switching to the new images: the copied-DB
verification omitted a mock Manager/gateway, so project routes were not registered
and PATCH returned 404. Old API/web were confirmed healthy. The verifier was corrected,
passed separately with no network, and retry required an exact match to the restored
deployment wrapper. A fresh `backup-2` was created/verified for the second activation.
No test requirement was removed to obtain success.

Final activation exited 0, verified all original rows of seven chat/project/run tables,
unchanged 34 migrations, integrity and foreign keys, and authenticated health, chat,
project, navigation-context, account/usage and media-capability reads returning 200.
A synthetic check through the running API's real private Code executor passed with
verified cleanup. Exact login/executor container IDs/start times were unchanged.
The backup SHA-256 was `f6da91cf97f3f9612f351e0054e393fea4a42db54a54ad9c2c8240892848cd16`.

Live browser restored the remembered session and six saved chats, displayed the new
quick switcher and searched existing history. A temporary pin survived reload; it was
then removed and the original list order was confirmed restored. No AI request or
production project was created. Positive project rename and foreign-owner/invalid
input checks ran on the real copied database with a mock-only app, plus the local
browser/API suites; no existing user's production project was renamed for verification.

Deployment/rollback material: `/opt/cosmora/releases/navigation-5db34b5`, including
`activate.sh`, `activate-2.log`, `api-build.log`, `web-build.log`, `backup-2/`,
`deployctl.before`, `deployctl.next`, `overlay.yaml`, `unaffected.before/after`.
Restoring the old wrapper and recreating API/web rolls back without a schema change.
Previous static chunks were retained. The corresponding local folder contains
`live-quick-switcher.png` proof.

The integration branch is published as `codex/integrate-navigation-20261012`.
The active Work chat received its SHA/link and a coordination note to avoid duplicating
these closed functions or the separate graph/Gemini blocks. No default-branch merge
or source PR closure was performed.
