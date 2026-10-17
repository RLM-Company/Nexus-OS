# Work Skills, reusable plans and answer provenance — 16 October 2026

## Delivered

- Work project selection: up to three explicitly pinned personal Skill revisions, at most 16,000 serialized UTF-8 bytes. Each standalone task captures instructions at admission; a graph captures them at creation for all nodes and explicit retries. Updates/deletion cannot rewrite accepted text. Legacy tasks/graphs do not resolve current selections retroactively. Read-only literal previews expose task and graph snapshots.
- Independent graph copies: original or current target-project Skills chosen explicitly; new graph ID, fresh node states, empty attempts/artifacts/results, no inherited approvals, usage or automatic execution. Canonical source graph/version and Skill mode are recorded. API supports another owned active target project; UI copies into the current project. A stale source fails and an idempotent replay returns the same copy even after source deletion.
- Portable JSON: strict `kosmora.work-plan.v1`, 600,000-byte transport bound, only title and task/dependency/Critic inputs. Local literal preview and explicit review precede import into a fresh graph with the project's saved Skill selection. No owner identity, snapshots, results, grants, usage or execution state are exported/imported. Server independently checks shape, byte size, duplicate IDs, missing dependencies and cycles. Lost clone/import responses recover with reads, without an automatic second POST.
- Ordinary chat: opening **Skills этого ответа** lazily reads the already accepted instruction snapshot. It retains exact versions/text after catalog deletion and never generates a new answer.

All model stages receive Skills as JSON user context. Existing system authority, policy checks, per-task/per-plan limits and AccountStore reservations remain authoritative. A focused regression proves large accepted Skill text fails the task input ceiling before provider dispatch or charging.

## Persistence and integration

Base: PR #349, `adf3665dd856a6868575203bfde8ed708baf67e3`, including Work #348 and presentation history #346. The branch is stacked on `codex/chat-skills-20261016`. Published trees preserve all untouched base files, including files not hydrated into the local checkout; each changed baseline blob was checked against the remote tree before publication.

Migration `0047_work_skills` follows 0046. Settings/selection are project-bound, snapshots parent-bound and immutable on UPDATE. Owner consistency and global/local privacy fences are enforced. Admission and checkpoint writes share a transaction; injected snapshot failure rolls back both the graph/work and checkpoint. Work privacy includes both snapshot tables and selections and removes them with either catalog adapter order. Original/copy deletion cannot cascade into the other's accepted text. No existing migration, usage ledger, provider evidence or credential has been rewritten.

The single topology validator moved into the browser-safe contracts package and is re-exported by core for compatibility. Oversized HTTP request bodies now retain HTTP 413 through the API error handler. Historical provider construction/routing tests use the original evidence interval; a separate regression asserts refusal after expiry. Those tests use mocked transport and do not renew current provider readiness.

## Verification

- Backend: full 123-file run, 785 passing tests and four skipped tests. The subsequently added Skill input-budget regression passed in a 33-test Manager run, bringing distinct passing backend tests to 786. The expanded migration/reopen check also passed separately.
- Web: all 65 unit/acceptance tests passed across 16 files.
- Type checks passed for contracts, core, database, API and web. Changed source/test ESLint, Prettier, diff whitespace and secret scans passed.
- Contracts build, production API TypeScript build and Next webpack production build passed; all 19 routes generated.
- Eight Playwright scenarios in the two affected feature files were discovered, including four new scenarios for Work selection/provenance, one-copy lost-response recovery, portable import/narrow-screen behavior and per-answer Skill history.
- Browser execution is unverified. The configured server launcher attempted a pnpm dependency reinstall and stopped for missing TTY; independently, the expected Chromium executable is absent. No browser pass, screenshot review, paid/live model request, VPS deployment, main merge or hosted CI success is claimed.

See `docs/OWNER_SKILLS.md` and `docs/WORK_PLANS.md` for API contracts and user behavior. Work still creates inert downloadable files through the existing single executor; arbitrary Skill execution, marketplace installation and autonomous external actions are outside this change.
