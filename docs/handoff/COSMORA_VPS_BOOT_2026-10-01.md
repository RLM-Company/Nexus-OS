# Cosmora VPS boot — 2026-10-01

## Deployed revision

The first private VPS boot uses source commit
`7960579d6f81a8fbcd2e026b9e7070932998a11d` from draft
[PR #270](https://github.com/RLM-Company/Nexus-OS/pull/270), stacked on
[PR #263](https://github.com/RLM-Company/Nexus-OS/pull/263). Neither PR was merged.
The earlier [readiness checkpoint](COSMORA_ALPHA_READINESS_2026-09-30.md) records local checks;
this document adds actual VPS observations. It does not establish live-model readiness.

The exact Git archive was transferred over SSH and its SHA-256 verified on both hosts:
`5ba13771a033b9058576007090722561532e713fe7ea4f99d88e9a84f06f9285`.
No GitHub deploy key was registered. The source is under
`/opt/cosmora/releases/7960579`; private runtime overrides are under `/opt/cosmora/runtime`.

The Ubuntu 24.04 VPS has Docker Engine 29.8.1 and Compose 5.5.1. The production Docker build
completed all nine package builds. Its image is `cosmora-alpha-app:7960579`, image ID
`sha256:fd17924a580046f9fe76bffceaedb5e0657667d83fba4b95d3d6d9d0738cc2c5`.
The Compose project name is `cosmora-alpha`, preserving stable database and certificate volumes.
The server-only `/opt/cosmora/runtime/deployctl` wrapper selects this revision and both Compose
files; use it for `ps`, `logs`, `exec`, `restart` and other maintenance commands.

## Address and protection

The private interface is at `https://13.141.51.16`. The hosting panel is a separate service.
The server hostname `noble-puma.h1cloud.net` had no publicly resolvable A record during the check.

The server-only Caddy override preserves the base stack's owner Basic authentication and API
bearer-session injection. It explicitly uses Let's Encrypt's `shortlived` ACME profile and sets
`default_sni` to the configured IP for clients without SNI. Both settings were needed for verified
IP-address HTTPS. See the [Caddy TLS documentation](https://caddyserver.com/docs/caddyfile/directives/tls),
[default SNI documentation](https://caddyserver.com/docs/caddyfile/options#default_sni), and
[Let's Encrypt IP-certificate announcement](https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability).

The issued certificate covers the IP, has issuer Let's Encrypt YE1 and expires
`2026-10-07T12:04:15Z`. Caddy obtained renewal information and manages certificate renewal through
its persistent data volume. Future automatic renewal has not yet been observed.

Only the edge publishes ports 80/443. API, Next and Caddy administration ports are not published.
The `private/` directory is mode 0700 and its files are mode 0600. A new owner password was generated
separately from hosting credentials. No passwords, hashes, session tokens or model credentials are
recorded here. The owner session expires `2026-10-07T21:02:42.963Z` and requires rotation according
to the [runbook](../../deploy/alpha/README.md).

## Observed checks

- Unauthenticated HTTPS requests to the interface and `/api/v1/health`: 401.
- Authenticated external HTTPS requests from Windows to the interface and Control Center: 200.
- Authenticated `/api/v1/health`: 200, API and SQLite both `ok`.
- Authenticated owner-session and project-list endpoints: 200; one valid owner session, no projects.
- Model runtime: explicit mock configuration, no live credential, fallback disabled, one attempt.
- Operations: environment emergency stop active, zero active runs and zero model route attempts.
- The built image passed `manager-compatible-fixture-smoke.mjs` in a separate container with
  `--network none`: production authentication, project chat plus three streamed Manager stages,
  Critic PASS and file download. It used its own temporary database and loopback provider.
- API and Next containers were restarted. SQLite health, the existing edge owner session and
  the environment emergency stop remained valid afterward.

The Codex in-app browser refused direct IP navigation with `ERR_BLOCKED_BY_CLIENT`. No browser
warning or client restriction was bypassed. The external HTTPS checks above use certificate
validation; a hosted interactive browser walkthrough remains unverified.

## Remaining live gates

The primary instance runs with `RUNTIME_EMERGENCY_STOP=true`. This is an interface and API boot,
not a live AI demo. It has no live API key or reviewed provider route configured.

Configure the provider privately, keep mock fallback disabled, run the no-cost hosted preflight,
and clear the environment stop and persisted process stop deliberately before an authorized capped
live trial. Disabling the environment switch alone does not clear a persisted emergency stop.
The repository's opt-in preview route is evidence to review, not proof of a configured provider.
The owner should complete the hosted browser walkthrough before treating this as a usable release.

GitHub CI for the integration candidate still needs a successful runner result. This deployment
does not change merge approval requirements or integrate the separate Intelligence Graph stack.
