# Private hosted alpha

This stack runs the actual Next interface and Node API on a single VPS. Caddy terminates HTTPS,
requires an owner password for every route, and replaces the browser's Basic authorization with a
short-lived, server-side bearer session before proxying `/api/*`. Only ports 80 and 443 are
published; the API and web server share a private Docker network. SQLite and Caddy certificates
use persistent volumes. This is an owner-only alpha, not a multi-user deployment.

## Before starting

- Use a VPS with Docker Compose 2.30+ and a domain with an A/AAAA record pointing to that VPS. Open
  inbound 80/443. Keep SSH access private. Do not run this stack on a shared public computer.

  A public IP can also be used with the optional `compose.ip.yaml` overlay. Set
  `COSMORA_DEMO_DOMAIN` to that IP in both the shell and `private/site.env`, then use
  `docker compose -f compose.yaml -f compose.ip.yaml` for **every** command below. The IP Caddyfile
  requests a trusted Let's Encrypt `shortlived` certificate and supplies a default SNI for clients
  without SNI. Domain deployments use the base Compose file. The two Caddyfiles share the same
  owner authentication and API proxy rules. See the
  [IP certificate policy](https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability).

- Review and integrate the live route and interface PRs. The source checkout must include both
  changes. No model key, session token or password belongs in Git or chat.
- From the repository root, work in `deploy/alpha`. Put private values in the ignored `private/`
  directory with mode `0700`. The files inside it must have mode `0600`.

Create `private/model.env` containing the reviewed `MODEL_PROVIDER`, `MODEL_PROVIDER_ID`,
`MODEL_NAME`, `MODEL_BASE_URL`, `MODEL_API_KEY`, `MODEL_REGISTRY_PATH`, and
`MODEL_FALLBACK_TO_MOCK=false`. Set `MODEL_MAX_ATTEMPTS_PER_ROUTE=1` for the first live trial.
Use the opt-in Manager route only after checking its still-current evidence, price and privacy
limitations. Never commit the file. `MODEL_API_KEY` must stay on the API service only.

Create `private/site.env` with the following lines. Generate the hash interactively with
`docker run --rm -it caddy:2.11.4-alpine caddy hash-password`, which reads the password without
echoing it. Copy only the resulting hash into this file:

```dotenv
COSMORA_DEMO_DOMAIN=demo.example.com
COSMORA_BASIC_AUTH_HASH=<hash from caddy>
```

Export `COSMORA_DEMO_DOMAIN` in the shell (same value) for Compose interpolation. Do not put the
hash or the password in shell history. Keep `private/site.env` mode `0600`.

## Boot sequence

```sh
cd deploy/alpha
mkdir -m 700 -p private
docker compose -f compose.yaml build
docker compose -f compose.yaml up -d api web
```

After `api` is healthy, issue a seven-day session. This command writes the token to an ignored,
private file for Caddy; it does not print the token:

```sh
docker compose -f compose.yaml run --rm --no-deps \
  -e COSMORA_SESSION_FILE=/run/cosmora/owner-session.env \
  -v "$PWD/private:/run/cosmora" api node deploy/alpha/issue-owner-session.mjs
docker compose -f compose.yaml up -d edge
```

API and Next have container health checks. Caddy starts only after both become healthy.
`docker compose -f compose.yaml ps` reports this state; a running container alone is insufficient.
The API check verifies SQLite, and the checks follow no redirects. These checks establish service
availability, not live-model readiness.

If `owner-session.env` already exists, the issuer refuses to overwrite it. To rotate, stop `edge`,
rerun the issuer with `-e COSMORA_ROTATE_SESSION=1`, then start `edge`. The old active session is
revoked and the new token replaces it atomically on disk. Session expiry is seven days; plan a
rotation before it expires. Caddy credentials and the bearer session are separate; losing one
does not silently grant access to the other.

Keep the separate Basic owner password in `private/owner-password`, mode `0600`, as one line.
Use a private editor; never put it into a shell command, command-line argument, Git or logs.
The access verifier reads this file without printing it and checks the actual HTTPS edge:

```sh
docker compose -f compose.yaml run --rm --no-deps \
  -e COSMORA_ACCESS_ORIGIN="https://$COSMORA_DEMO_DOMAIN" \
  -v "$PWD/private:/run/cosmora:ro" \
  api node deploy/alpha/verify-access.mjs
```

Run it after deployment, credential/session rotation and during manual maintenance checks. It
requires unauthenticated interface and health requests to return 401, then verifies authenticated
interface access, healthy SQLite, exactly one current hosted owner session and global stop status.
A session with 24 hours or less remaining fails with a rotation reminder. This catches an expired
bearer session even when the public API health check still returns 200. Redirects are never
followed, TLS certificate validation stays enabled, and failure output excludes response bodies
and credentials. The command sends only GET requests and never calls a model, rotates credentials
or clears stops. A PASS establishes owner access; it does not establish live AI readiness.
This is a manual command; no timer or automatic renewal is installed.

Check `https://<domain>/api/v1/health` and the Work screen after logging in. The health endpoint
must also be password-protected at the edge. Before a paid trial, run the no-cost hosted preflight
inside the API container:

```sh
docker compose -f compose.yaml exec api node deploy/alpha/preflight.mjs
```

It checks the configured live route, Manager stages, SQLite and emergency stops without a provider
call. Check project limits separately in Control Center. If the route has no verified price, a
monetary cap cannot be proven; keep the first task short and review provider billing before use.
The existing `manager:smoke` command checks two chat responses, **not** the full Manager work
loop. A real Manager task must be observed separately and capped. Never treat mock output as proof
that a model answered.

Run `node scripts/manager-compatible-fixture-smoke.mjs` after building the monorepo to exercise
the external adapter with a local streaming fixture, without contacting the real provider. Creating
a **new** project also starts one chat request. The first full Manager task therefore uses up to
four model requests in this flow: the project chat, plan, draft and Critic. The task's three-request
limit does not include the earlier project chat. Create a short project brief and check its usage
before starting the task.

This deployment is intentionally single-instance: SQLite is not shared across replicas. Back up
`cosmora_data` securely before updates. Do not publish the current static Sites preview as a live
AI demo; it does not include this API or its database.

## Database backup and recovery

The backup command uses SQLite's online backup API, including committed WAL records. It opens
the source read-only, verifies the copied database with `PRAGMA integrity_check`, and publishes
a private snapshot plus a byte count and SHA-256 manifest. It never copies a live database file
with `cp`. Backups contain private chats, projects and identity data; keep them outside Git and
public web directories.

```sh
mkdir -m 700 -p private/backups
docker compose -f compose.yaml run --rm --no-deps \
  -v "$PWD/private/backups:/run/cosmora-backups" \
  api node deploy/alpha/sqlite-backup.mjs create
```

The command prints only the new manifest path. To check an existing snapshot, pass that exact
path to `node deploy/alpha/sqlite-backup.mjs verify <manifest.json>` with the same mount.
Verification checks both hash and SQLite integrity and rejects paths outside the manifest
directory. Each run creates a new snapshot; there is no automatic deletion or retention policy.
Keep a protected copy on another machine as well, because a backup on this VPS cannot survive
loss of the VPS. Transfer the matching `.sqlite` and `.sqlite.json` files together.

For a recovery rehearsal, copy the verified snapshot into a **new** Docker volume or private
directory. Start only an API container against that copy on an unpublished network with
`RUNTIME_EMERGENCY_STOP=true`, no live provider credential and no mock fallback. Verify SQLite
health, saved records and owner identity. The source backup must stay unchanged. Never point the
rehearsal at the active `cosmora_data` volume or expose its routes.

Actual recovery requires a maintenance window: stop edge, API and Next, preserve the current
volume, restore into a new volume, and explicitly select it. Start the API with the environment
emergency stop still enabled. Issue a **new** owner session for the restored database and recreate
edge so it receives the new token. A token/session from after the backup may not exist in the
restored database. Complete authenticated checks before reopening access or resuming model calls.
Application rollback and database recovery are separate operations; an older image must be
compatible with the selected database schema.

Run `pnpm test:deploy` to check WAL snapshot recovery, tampering, missing databases, private Linux
permissions, directory boundaries, container health and owner access verification. It is included
in `pnpm check`.
