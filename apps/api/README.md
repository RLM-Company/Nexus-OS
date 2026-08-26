# API application

Fastify server for Cosmora OS. It applies SQLite migrations during startup and exposes:

- `GET /api/v1/health` for API and database readiness;
- `GET /api/v1/model-runtime` for a secret-free provider summary;
- project, message, and SSE run routes under `/api/v1`.

The API owns provider credentials. They are never sent to the browser.
