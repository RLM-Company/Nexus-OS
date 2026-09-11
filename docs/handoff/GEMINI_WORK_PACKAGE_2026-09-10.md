# Gemini work package — Cosmora benchmark and red-team track

## Role

Gemini is a **scenario generation, taxonomy and adversarial review assistant**. It does not own the
service implementation, canonical contracts or merge decisions. Codex validates every useful item
against current `main`, converts accepted findings into tests/code, executes the full quality gate
and integrates only green PRs.

Gemini has no GitHub connection. It works only from explicitly supplied text, screenshots and file
snapshots, then returns proposal artifacts for manual review; it must never infer current branch,
PR or CI state.

## Allowed high-value work

1. **Finish the Manager benchmark catalog**
   - continue BM-076 through BM-200 without renumbering existing BM-001–BM-075;
   - cover planning, research, coding, memory, delegation, critic, recovery, policy and security;
   - include A0–A6 cases as policy evaluation scenarios, not permission to activate A6.
2. **Generate 100 red-team attacks**
   - prompt/indirect injection, memory poisoning, malicious artifacts and tool output;
   - cross-project access, stale approval, replay/double effect, TOCTOU and privilege resurrection;
   - nested delegation escalation, lost constraints after truncation, emergency-stop races,
     provider/fallback races and audit tampering.
3. **Normalize scenarios**
   - map each scenario to capability IDs, preconditions, expected verdict and durable state;
   - label assumptions and owner-only choices;
   - remove invented timeouts, retry counts, providers, prices and rollback guarantees.
4. **Coverage analysis**
   - produce a matrix by capability, autonomy level, lifecycle state and attack family;
   - identify missing negative cases and duplicated scenarios;
   - prioritize P0/P1 cases that can become deterministic tests without external effects.
5. **UX adversarial review**
   - inspect supplied screenshots/text for false readiness claims, unsafe action affordances,
     hidden uncertainty, fake ETA and server/client authority disagreement.

## Scenario output schema

Each item must contain:

- `id` and short title;
- synthetic setup only;
- exact user/agent action;
- involved capability IDs and A-level;
- expected Policy verdict;
- expected durable operation/run state;
- expected audit/recovery visibility;
- forbidden side effect;
- deterministic acceptance assertion;
- assumption/owner-decision flags.

Deliver batches of at most 25 scenarios so Codex can review them without losing traceability.

## Prohibited work

- Do not invent repository state or state that a scenario is implemented without supplied evidence.
- Do not rewrite canonical A0–A6 matrices, contracts or security invariants.
- Do not finalize the Manager prompt, select providers/models or request credentials.
- Do not run paid probes or real finance, deployment, publication, messaging or production actions.
- Do not treat `FAILED` as proof that an external effect did not happen.
- Do not recommend blind replay/resume/completion of `RECOVERY_REQUIRED` operations.

## First assignment

Produce BM-076–BM-100 using the schema above, then add a coverage summary against these priority
families: stale authority, clock manipulation, permission-purpose mismatch, post-reservation
exception, result-persistence failure, duplicate invocation and owner-visible recovery.
