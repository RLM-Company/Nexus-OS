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
  builds, copied database rehearsal and bounded live acceptance passed as recorded
  below. Hosted CI success is not claimed.

## Deployment and live acceptance

Source revision `ecbaeb9c9300e8f77b7a539196bf7280396f94f0` is deployed on the
owner's VPS. Draft PR: https://github.com/RLM-Company/Nexus-OS/pull/348, based on
`codex/chat-workspace-code-20261014`; no main merge was performed.

- Release: `/opt/cosmora/releases/work-autonomy-ecbaeb9`.
- API image: `cosmora-alpha-app:work-autonomy-api-ecbaeb9`.
- Web image: `cosmora-alpha-app:work-autonomy-web-ecbaeb9`.
- Source archive: 659,695 bytes; SHA-256
  `6009f141216f62e2f0fec5a782f87aa49633e8004add7a5f9d5b53aed00f4b75`.
- Pre-activation database backup SHA-256:
  `6ab34ab9fbc645a7e1f8e0c2022600d140e792d72cc08ecea5c74dedcc3015490`.

Both production images built without network access. Activation held the
maintenance lock, verified the previous image revisions, stopped the API for a
consistent backup, and rehearsed the new code against a copy of the live database.
That copy passed integrity/foreign-key checks, retained all 43 migration journal
rows, and completed a synthetic two-step Work run with six fixture model requests,
required Critic review and the result bundle. Canonical chat/project/identity,
Canvas, Code and Work records were compared before/after activation and preserved.

API/web are healthy and authenticated read routes passed. Login and the separate
Code executor retained their original container identities/start times; the real
OCI executor smoke check passed. Provider/model settings, credentials, registration
policy and maintenance overlays were preserved. No rollback was required.

The bounded real-model acceptance completed on 15 October 2026:

- Project `cc150003-0001-4000-8000-000000000001`, plan
  `2a62f2ba-bb5f-4887-b99b-8c4398ce5228`.
- First step wrote `brief.md` for chat folders; the dependent step consumed that
  exact artifact and wrote `checklist.md`. Both had one attempt, required Critic
  review and a PASS verdict. The final state was `completed`, with exactly six
  real `cheapvibecode/gpt-6.1-sol` requests against a ceiling of six.
- Dependency artifact IDs, published versions, recorded hashes and actual bundle
  contents matched. Subsequent reads did not create requests. There was no paid
  retry, external publication or claim that the described feature was executed.
- The browser visibly showed two completed steps and six of six requests. The
  result bundle was downloaded through the actual authenticated UI; the
  downloaded contents were independently hash-checked locally. The brief covers
  the requested behavior and three acceptance criteria; the checklist has seven
  planned checks with expected results, including preserving chats after removing
  a folder. Content was inspected, not just the PASS labels.

Server evidence is retained as `live-work-result.json` and
`live-work-bundle.json` in the release directory. Local evidence is under
`2026-10-15/kosmora-work-autonomy` in the owner's Codex workspace:
`work-live-result.png`, the UI-downloaded `work-results.json`, and the extracted
`brief.md` / `checklist.md`. These are synthetic acceptance documents, not user
files. Six requests establish request usage; monetary cost is not asserted while
the provider route has no confirmed pricing metadata.
