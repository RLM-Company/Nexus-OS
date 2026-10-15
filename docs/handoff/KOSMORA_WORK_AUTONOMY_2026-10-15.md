# Work: bounded automatic plan execution — 15 October 2026

Branch `codex/work-autonomy-20261015` starts from `bc9f46a` (the deployed Chat/Code
feature branch). This change extends the existing Manager/Analyst/Critic file
pipeline and durable dependency plans. It adds no model provider, credential,
external tool authority, dependency, database migration or journal rewrite.

## Delivered behavior

- A saved dependency plan can be explicitly armed for sequential execution.
  Ready steps start on the existing server coordinator timer; reads never dispatch
  a model. Dependency waves are computed locally and shown as execution order;
  they do not claim parallel model execution. This selectively adapts the useful
  dependency-wave idea from PR 330 onto the current implementation.
- A plan has one explicit model-request ceiling, 3–96 requests. Earlier attempts
  count. Before admitting a child, the scheduler accounts for up to all three of
  its requests, plus already-used/allocated requests. Existing per-step 32,000
  input / 6,000 output limits, owner quota and canonical project accounting remain.
  Unused budget is not permission to retry a failed/uncertain request.
- New tasks and new plan steps request Critic review by default in the UI. The
  server ORs the owner's require_critic setting with its existing risk requirement;
  a model cannot waive required review. Complex A2 plans and policy permissions
  retain explicit approval gates. All roles use the configured provider/model.
- Automatic progression waits at those gates and stops on a failed/cancelled
  step. Repeating a failed step still requires an explicit cost acknowledgement;
  completed steps and immutable artifact versions remain. A manual launch cannot
  race the armed scheduler through the public API.
- Pause/cancel preserve saved files; stopping autostart prevents later steps and
  lets the current step finish. A process restart pauses future automatic starts
  until explicit continuation. Uncertain in-flight operations retain the existing
  recovery behavior and budget holds. Editing any unstarted step invalidates the
  prior autostart consent, including edits made while the project is paused.
- The UI shows progress, request usage, wait/failure reasons, Critic verdicts and
  preserved results. If the acknowledgement of run_plan is lost, it reads canonical
  state and reconciles acceptance without another POST. Creation still reuses its
  client request ID after a lost response.
- Completed artifacts can be downloaded individually or as one JSON result bundle
  containing exact contents, versions, hashes, reviews and model sources. The
  bundle is owner/project scoped, attachment-only, private/no-store, at most 2 MB.
  Actual content SHA-256 is checked against the recorded dependency/export hash.

## Boundaries

Work produces inert downloadable files. A Critic verdict is content review,
not evidence that generated code ran. The separate Code executor remains the
path for real code execution and GitHub publication. No new execution permissions
or model retries are inferred from a plan, artifact, memory record or checkpoint.

The current executor runs one Work task at a time in one API process. A user can
submit a goal through the existing Manager panel, or compose dependency steps and
run the whole saved plan; this release does not claim an AI-generated arbitrary
DAG, distributed agents, or automatic external actions.

## Verification

- 59 tests passed: 23 dependency-plan API/coordinator cases, 32 Manager cases,
  and four core Work progress/graph cases. Coverage includes complete automatic
  progression, exact dependency evidence, requested Critic, shared cap including
  prior attempts, explicit failure retry, approval boundaries, pause/cancel,
  restart, privacy/emergency fencing, edit-consent invalidation and corrupted
  export rejection. Provider responses in these tests are fixtures.
- Eight Chromium cases passed across Manager, dependency plans and stop gates.
  The final two dependency-plan cases passed again after the last UI recovery
  change, including one accepted start whose response was deliberately lost.
  Both steps completed with one attempt each, six model requests and PASS reviews;
  reload and the exact two-file bundle were verified. No real model calls there.
- DB/API/web semantic type checks passed; scoped lint has zero errors. Production
  build, copied database rehearsal, deployment and a bounded live acceptance are
  recorded below after completion. Hosted CI success is not claimed.
