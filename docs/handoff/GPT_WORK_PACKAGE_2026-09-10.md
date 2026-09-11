# GPT work package — Cosmora support track

## Role

GPT is a **GitHub-connected review, specification and QA assistant** for bounded side work. It may
read current `main`, open PRs and CI, and create a separate support branch/PR when the assignment
explicitly allows it. It does not own security architecture, the core service or merge decisions.
Codex remains responsible for integrating runtime changes, validating cross-system contracts,
running the authoritative `pnpm check` and merging only green results.

## Allowed high-value work

1. **Requirements normalization**
   - turn raw product discussions into short acceptance criteria;
   - separate current behavior, proposal, owner decision and prohibited action;
   - flag contradictions against A0–A2, no-blind-retry and owner-only boundaries.
2. **Test-case drafting**
   - propose deterministic unit/API/E2E scenarios for idempotency, reload, cancellation, stale
     state, isolation and recovery;
   - use synthetic identities and data only;
   - state expected server-authoritative outcomes, not implementation guesses.
3. **Documentation review**
   - find stale claims, inconsistent counts, missing links and unsupported readiness language;
   - rewrite user-facing explanations in clear Russian and concise English;
   - prepare release notes from a supplied list of merged PRs and CI results.
4. **Demo preparation**
   - draft a five-minute owner walkthrough and observer FAQ;
   - distinguish the synthetic demo from production/autonomous capability;
   - produce a failure checklist for reload, Stop, empty state and unavailable policy reads.
5. **Contract critique**
   - review supplied JSON/TypeScript contracts for ambiguous optional fields, missing bindings and
     unsafe default behavior;
   - return findings with severity, exploit/precondition, expected invariant and proposed test.
6. **Repository-side support**
   - begin from the current remote `main` and record its SHA plus all open PRs that overlap the task;
   - fix stale documentation, broken internal links and deterministic test fixtures only when the
     assigned scope names those files;
   - use a fresh branch and one narrowly scoped PR; never push to another worker's branch;
   - report the exact workflow run and leave the PR open for Codex/owner integration.

## Required output format

For each assignment return:

1. `Scope read` — exact files/text supplied;
2. `Findings` — numbered, with severity and evidence;
3. `Proposed acceptance` — observable behavior;
4. `Test cases` — setup, action, expected result;
5. `Owner decisions` — only genuinely product/authority-changing choices;
6. `Unknowns` — never fill gaps with invented provider, timeout, retry, price or model facts.

## Prohibited work

- Do not rely on handoff implementation facts until current `main`, overlapping PRs and CI have
  been checked through the available GitHub access.
- Do not produce merge-ready patches for security/runtime code as if verified.
- Do not edit Manager Console/runtime, Policy Engine, Tool Runtime, identity, secrets, provider or
  production code unless Codex/owner supplies a new exact file-level assignment.
- Do not merge PRs, rewrite shared history or update another worker's branch.
- Do not finalize the Manager system prompt or activate A6.
- Do not choose a production provider/model, request credentials or suggest paid probes.
- Do not approve real finance, deployment, publication, email or other external effects.
- Do not propose blind retry for `RECOVERY_REQUIRED` or promise rollback of irreversible actions.

## First assignment

From a fresh branch at current `main`, perform a documentation-only consistency audit outside the
active Manager/runtime and policy-security workstreams:

- verify root setup/demo commands against `package.json` without starting external services;
- find broken internal Markdown paths, stale readiness links and contradictory synthetic/production
  wording;
- create one narrow docs-only PR for objective corrections;
- include the base SHA, changed files, local formatting result and GitHub CI URL in the handoff;
- leave subjective product wording and every owner-only decision as findings, not edits.
