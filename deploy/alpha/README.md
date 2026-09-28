# Private hosted alpha

This stack runs the actual Next interface and Node API on a single VPS. Caddy terminates HTTPS,
requires an owner password for every route, and replaces the browser's Basic authorization with a
short-lived, server-side bearer session before proxying `/api/*`. Only ports 80 and 443 are
published; the API and web server share a private Docker network. SQLite and Caddy certificates
use persistent volumes. This is an owner-only alpha, not a multi-user deployment.

## Before starting

- Use a VPS with Docker Compose 2.30+ and a domain with an A/AAAA record pointing to that VPS. Open
  inbound 80/443. Keep SSH access private. Do not run this stack on a shared public computer.
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

If `owner-session.env` already exists, the issuer refuses to overwrite it. To rotate, stop `edge`,
rerun the issuer with `-e COSMORA_ROTATE_SESSION=1`, then start `edge`. The old active session is
revoked and the new token replaces it atomically on disk. Session expiry is seven days; plan a
rotation before it expires. Caddy credentials and the bearer session are separate; losing one
does not silently grant access to the other.

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
