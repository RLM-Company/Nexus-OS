# Cosmora private alpha — current status (5 October 2026)

This checkpoint supersedes the **current-state** parts of older launch handoffs without rewriting their historical evidence.

## Current hosted release

- Deployed release: `523bdeec2cda01a367d97178c3cb3ec94f5933d3` from draft PR #296.
- Application feature baseline: draft PR #295 at `7a1222aee46ba763711bc1ad9e33efad955689bb`.
- #296 keeps the #295 application image and adds the owner form-login gateway required by embedded browsers.
- Exact-head CI for #296 is green: workflow run 1181.
- #295 exact-head checks are green: CI run 1176 and Windows desktop run 58.
- The repository source remains unmerged. No automatic merge is authorized.
- Intelligence Graph development is a separate workstream and is not part of this release checkpoint.

## What is working

- Private HTTPS-hosted Cosmora with owner-only access.
- Form-based owner login works in the actual embedded browser; logout revokes browser access and re-login restores it.
- Unauthenticated API requests remain closed.
- Downstream owner bearer-session and API identity checks remain authoritative.
- SQLite health and owner identity were verified after the #296 rollout.
- Ordinary chat and project chat are separately persisted.
- Text/code/PDF/DOCX materials and chat attachments are supported within their documented bounds.
- Owner-operated private GitHub browsing, code import, review and draft-PR publication flow are available.
- Optional private SearXNG result attachment is available.
- Manager bounded plan/draft/Critic/file flow remains available behind the model execution gates.
- Emergency stop remains enabled for live model execution.

## Model/provider boundary

The configured private-alpha candidate remains CheapVibeCode / `gpt-5.5`.

- No paid model task has been accepted as a release gate.
- No automatic top-up or subscription is authorized.
- Global model execution remains stopped until the owner deliberately resumes the funded trial.
- Local fixture success does not establish live-provider quality, pricing, privacy or production readiness.
- Provider catalog evidence recorded in the older launch checkpoint expires on **10 October 2026** and must be refreshed before any later live trial.

## Operational deadlines

Two time-bound items from the last verified hosted checkpoint still require attention:

1. **TLS certificate:** the recorded certificate expires on **7 October 2026 at 12:04:15Z**. Automatic renewal must be observed on the actual VPS and then re-verified through the hosted access/TLS checks.
2. **Owner session:** the rotated hosted owner session recorded on 3 October expires on **10 October 2026 at 09:33:03Z**. Rotate it before expiry if that session is still the active hosted session.

Do not infer either condition from repository state alone; verify the actual hosted edge before relying on it.

## Remaining release gates

1. Verify automatic TLS renewal on the VPS and record the new certificate validity.
2. Re-run hosted owner/access verification after renewal and before the current owner session expires.
3. Keep the model emergency stop active while funding remains deferred.
4. Before any paid live trial, refresh provider evidence, verify balance/limits, define a hard monetary cap and explicitly authorize the trial.
5. Complete a Windows first-run/install acceptance pass on the owner machine using the current Windows release chain. Windows packaging work is continuing in separate draft PRs and should not be duplicated here.
6. Review the unmerged release stack before any integration into `main`.
7. For any public or paid beta, separately close privacy, provider-terms, multi-user, signing and economic release gates.

## Safety invariant

This checkpoint does **not** authorize:

- merging draft PRs;
- clearing the model emergency stop;
- sending paid model requests;
- changing provider credentials;
- exposing secrets;
- mutating Intelligence Graph work.

The current objective is to preserve a reproducible, owner-controlled private alpha while the remaining operational gates are closed.
