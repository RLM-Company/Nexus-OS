# Cosmora private-alpha launch — 3 October 2026

Current integration: [draft PR #283](https://github.com/RLM-Company/Nexus-OS/pull/283), stacked
on unmerged #277 and incorporating #278/#279. The Intelligence Graph remains separate. No merge
is authorized automatically. The deployed implementation is `dd8364af45361644c98cb9fa3764a1e5731c91ae`;
later scripts and documentation do not change the application image.

## Completed

- API and web are healthy on the private VPS at `https://13.141.51.16`; only the HTTPS edge is
  exposed. Owner authentication, SQLite and separate ordinary/project persistence are connected.
- The protected VPS environment and ignored local development `.env` use CheapVibeCode,
  OpenAI-compatible protocol, `gpt-5.5`, `https://ru.cheapvibecode.ru/v1` and the new credential.
  Fallback is disabled, attempts are limited to one, output is capped at 1,200 tokens and
  execution remains stopped. Local `.env` access is limited to the Windows owner and SYSTEM;
  Git and Docker build contexts exclude it. The web process does not load this credential.
- Read-only discovery with the configured key found the model among 42 entries and a zero
  token balance. It sent no generation requests and did not verify streaming with a real model.
- The current profile passed a production-authenticated, isolated loopback fixture: project
  chat, Manager plan, draft, Critic PASS and file download. All four model requests went to the
  local fixture. The fixture copies route constraints and supplies explicitly synthetic evidence
  only to its temporary registry; production evidence and its expiry are unchanged.
- Secret scanning permits ignored private runtime files while rejecting keys in tracked/new
  source and staged changes, including force-added `.env` files and staged secrets hidden by a
  clean working copy. Six regression cases passed; all 13 connection-check cases also passed.
- The hosted owner session was rotated using the release's issuer with network disabled.
  Its prior active session was revoked, and the new session expires `2026-10-10T09:33:03.357Z`.
  The edge was recreated to load it. The authenticated HTTPS verifier passed afterward:
  SQLite healthy, current owner valid, model execution paused, no model request sent.
- Before rotation, a fresh online database backup was verified and copied to protected Windows
  storage. Both local checksum and SQLite integrity passed. Snapshot:
  `cosmora-2026-10-03T09-31-52-534Z-31ef0275-9cfc-4fe7-a071-6688eba34e08.sqlite`.
- The last complete integration checks, CI 1088 and Windows desktop 34, passed at `7a7615e`.
  Current script/documentation follow-up requires its own CI result.
- An unsigned Windows installer is available privately. Its downloaded artifact checksum and
  four desktop policy tests passed; actual installation and interactive first use are pending.

## Remaining launch gates

1. Apply the prepared ten GitHub Actions variables and `MODEL_API_KEY` secret. The connector
   cannot administer these settings; the browser still requires the repository owner's sign-in.
   VPS and local credentials are already configured. Prepared values alone do not update GitHub.
2. Funding is deferred at the owner's latest request. No payment or paid model request occurred.
   The earlier `www`-host CSRF error was avoided through a normal sign-in on `cheapvibecode.ru`;
   the service created an unpaid 100 RUB Lolz Market invoice. Its payment page requires an
   authenticated Lolz Market account. No account was created and no funds were transferred.
   The original approval remains at most 100 RUB total, with no subscription or automatic top-up.
3. After funding is resumed, refresh registry evidence if needed, review route limits and billing,
   deliberately clear environment and persisted stops, and perform the capped real-provider
   trial. Current provider-declared catalog evidence expires `2026-10-10T07:01:39Z`; unknown
   pricing/privacy and successful fixtures do not establish live-model readiness or a monetary cap.
4. Complete a hosted interactive walkthrough and Windows first-run/download check. The in-app
   browser previously blocked IP navigation; no browser restriction or TLS validation was bypassed.
5. Observe automatic certificate renewal. The current trusted certificate expires
   `2026-10-07T12:04:15Z`; existing Caddy storage was preserved during edge recreation.
6. Review the unmerged PR stack before deciding on integration into `main`. For a later public
   or paid beta, separately close privacy, provider-terms, multi-user and economic release gates.

This checkpoint establishes an operational private alpha with execution paused. It does not
claim a completed real AI task or a public production release. Credentials and database contents
are excluded from the repository and this report.
