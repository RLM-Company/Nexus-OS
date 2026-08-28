# API application

Fastify server for Cosmora OS. It applies SQLite migrations during startup and exposes:

- `GET /api/v1/health` for API and database readiness;
- `GET /api/v1/identity/sessions` for owner-bound token-free session inventory;
- `POST /api/v1/identity/sessions/:sessionId/revoke` for idempotent owner session revocation;
- `GET /api/v1/model-runtime` for a secret-free provider summary;
- `GET /api/v1/operations/status` for content-free runtime counters and safety alerts;
- `POST /api/v1/operations/emergency-stop` for durable process/project execution stops;
- project, message, and SSE run routes under `/api/v1`.

The API owns provider credentials. They are never sent to the browser. Operational logs include
route identity, attempt, error code, token counts, and calculated cost, but never prompts, response
content, or credentials.

The parsed `ServerConfig` contains only `modelApiKeyConfigured`. The actual key is resolved through
the asynchronous `SecretResolver` at the API composition boundary and passed directly into the
server-only adapter.

The external `/api/v1` surface is the owner control plane. A valid bearer session for an
`agent` or `system` actor is authenticated and then denied with `FORBIDDEN`; those actors do not
inherit owner authority. Future agent execution must use a separate internal boundary with explicit
project/capability grants. `GET /api/v1/health` remains public.
