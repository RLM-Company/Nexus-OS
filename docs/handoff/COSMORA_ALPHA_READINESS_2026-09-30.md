# Cosmora alpha readiness — 2026-09-30

## Integration candidate

This checkpoint describes `RLM-Company/Nexus-OS` at the exact private-alpha candidate
`59821d725d6df68692f33e7792e7bd9421f566c2` from draft [PR #263](https://github.com/RLM-Company/Nexus-OS/pull/263),
plus the documentation and verification work recorded here.

The observed default branch is `main@62bc5234b24e3b0c10262b043063fd31be9732bd`.
The candidate contains the current interface branch from [PR #262](https://github.com/RLM-Company/Nexus-OS/pull/262)
at `602ae114753250d26b238ae8431e2d34140925ac` and the opt-in Manager live-route preparation.
Neither release PR is merged. Historical September 18–19 checkpoints describe older revisions.

## Working product boundary

- Ordinary chats and project chats persist separately, stream through the API and support cancellation.
- Manager work persists a bounded plan → draft → optional Critic review → policy-checked publication flow.
  It can create up to eight inert downloadable files. Generated code is not executed.
- Owner controls cover plan approval, pause after the current model request, resume and cancellation.
  A0–A1 require plan approval; A2 requires it for complex plans. File publication separately checks
  `workspace.write` through Policy Runtime.
- The interface lists up to 30 saved tasks, retains selection during polling and lets the owner
  inspect and download an earlier result after a new task or reload. Another unfinished task blocks
  creation in the same project.
- A work request permits two or three model attempts and bounded input/output reservations. The UI
  uses three attempts, 32,000 input and 6,000 output tokens. Project usage limits apply separately.
- The default registry is mock-only. A configured live credential is insufficient: each role and
  `manager_work_*` stage must have a valid route. Unknown price prevents claiming a monetary cap.
- The API stores task state and reconciles interrupted requests after restart without silently
  repeating an uncertain model charge. Process/project emergency stops remain authoritative.

Project Context is browser-local preview state. Skills and the product's GitHub screen use mock
read/preview data. Studio prepares prompts. Authentication contracts and graph work in separate
PRs are not evidence that multi-user login, graph retrieval or creative generation is connected to
this candidate. No general agent task-graph loop, research, shell, repository editing, deployment
or messaging tool is provided by Manager work.

## Verification in this Windows checkout

Node.js 24.19.0 and pnpm 11.19.0 are used with the frozen lockfile. The first installation timed out;
the retry completed without changing dependency manifests or the lockfile.

The final `pnpm check` completed successfully after the fixes below:

- Prettier and the repository secret scan;
- lint and strict TypeScript across the monorepo;
- 417 unit/API tests (unchanged suites can use Turbo results from the earlier executed pass);
- production builds of all nine packages;
- all 95 Chromium E2E scenarios, including saved Manager tasks, old downloads, project isolation,
  offline context, desktop/mobile navigation, owner controls and usage-limit preview/apply.

The production-auth OpenAI-compatible fixture smoke also passed: one project-chat request plus
three streamed Manager work stages, Critic PASS and a file download. All provider traffic used
loopback fixtures. These results establish local verification; HTTPS, Docker/VPS deployment and
an actual live-provider task still require their own evidence.

The initial Windows checkout converted LF repository text to CRLF through Git's `core.autocrlf`
setting, causing Prettier to reject 440 files before other checks ran. Restoring the original LF
bytes cleared that failure without changing those repository blobs. The added `.gitattributes`
keeps automatic text detection and enforces LF in future checkouts, matching `.editorconfig`.
An actual checkout probe with `core.autocrlf=true` produced LF text and preserved the committed
WebP blob hash exactly.

Four API live-smoke budget tests initially failed before their assertions could inspect the
smoke guard: the child ESM process imported a Windows filesystem path instead of a file URL.
The test now passes `new URL(..., import.meta.url).href` to dynamic import. All four focused cases
then passed, including the assertion that no POST was dispatched; production smoke behavior and
its authorization guard are unchanged.

The first executable Chromium run finished with 89 passed / 6 failed. Three failures were stale or
ambiguous navigation locators; they now use the owner account menu and scoped sidebar/workspace
controls. Two exposed Project Context overflowing its grid row under the composer: the panel now
has a zero minimum height and its own vertical scroll. The sixth exposed overlapping Control Center
loads resetting edited usage limits. Only the most recent load can now publish data, errors and
loading state. All six previously failing browser scenarios passed together after these fixes.

## Current release gates

1. Obtain a successful GitHub runner result. The observed PR #263 CI run 907 (`36457760991`)
   concluded failure with no reported job steps; its log endpoint returned BlobNotFound.
   Quota/billing cause is not established by this evidence.
2. Finish VPS source access and build the exact reviewed candidate. The earlier deployment report
   says Docker is installed, but source checkout, containers, HTTPS and hosted browser flows were
   not verified. That report has not been replaced with a new server inspection here.
3. Configure private credentials on the server, rotate the owner session as needed and execute
   `node deploy/alpha/preflight.mjs` before a live request. See [deployment runbook](../../deploy/alpha/README.md).
4. After a reviewed route is available, explicitly authorize and observe a capped live Manager
   task. Creating a new project can add one chat request before the three work-stage requests.
5. Review the integration candidate for merge. Do not automatically merge the overlapping interface
   PR or the graph stack into this release.

The existing static Sites preview is frontend-only. This checkpoint does not claim a running VPS
service or production readiness. No live provider call, server deployment or merge is part of this
verification package.

## Parallel work

The Intelligence Graph stack (#264–#269) remains separate. Its fixtures and synthetic scale results
must be assessed on their own commits and do not establish runtime integration in the alpha.
This chat maintains the main product integration and release path; specialized branches should
provide their own code, verification and handoff before being proposed for integration.
