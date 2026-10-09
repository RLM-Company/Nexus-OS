# Kosmora research v1 — blocks 23–24 handoff (source b15912d)

**Integration update 2026-10-09:** See
`KOSMORA_SETTINGS_RESEARCH_MEDIA_INTEGRATION_2026-10-09.md` for the integrated
checks and final contracts. Production schema now uses canonical migration 0028;
ResearchStore no longer creates tables. Search cancellation and pinned transport
address-family selection were corrected during integration. The historical
authoring-environment limitations below are retained as provenance, not current gates.

## Integration / routes

The feature is an additive research workspace. It reuses `WebSearch.search()` and its pinned
SearxNG origin; no credential, model-gateway, Manager, document-retrieval, production, or lockfile
change. The integration files are separated in `kosmora-research-23-24-integration.patch`:

- `packages/core/src/index.ts`: export the pure research contract/report functions.
- `apps/api/src/app.ts`: register owner-authenticated, project-scoped research routes and lifecycle hook.
- `apps/api/src/server.ts`: bootstrap the feature store on the **existing** SQLite connection.
- `apps/web/src/app/web-search-panel.tsx`: entry link in the existing search panel.
- `apps/web/src/app/workspace-navigation.tsx`: navigation entry to `/research-workspace`.

To install on a clean checkout at **exactly** `b15912d23ab15a99e38370e22e472faf28c99961`:

```sh
git switch -c feature/kosmora-research-23-24
git apply --check kosmora-research-23-24-feature.patch
git apply kosmora-research-23-24-feature.patch
git apply --check kosmora-research-23-24-integration.patch
git apply kosmora-research-23-24-integration.patch
pnpm install --frozen-lockfile
pnpm exec prettier --write packages/core/src/research apps/api/src/research apps/api/test/research-workflow.test.ts apps/web/src/app/research-workspace docs/handoff/KOSMORA_RESEARCH_BLOCKS_23_24_2026-10-08.md
pnpm --filter @cosmora/core build
pnpm --filter @cosmora/api typecheck
pnpm --filter @cosmora/api test -- research-workflow
pnpm --filter @cosmora/web typecheck
pnpm --filter @cosmora/web build
```

The authoring sandbox lacked pnpm/Next.js dependencies, so the complete monorepo gates and
format check **remain UNVERIFIED**. The above are mandatory integration gates, not passed claims.
The app/web agent rules request reading installed Next docs; this was impossible without
`node_modules` and must be done on integrator's checkout.

## Persistence & bounded artifact contract

`ResearchStore` creates a dedicated `research_v1_runs` table/index using additive idempotent DDL.
No shared migrations or `schema.ts` were changed. For migration-gated deployments, execute
`apps/api/src/research/migration.sql` once after the existing DB migrations.

Research run state contains `owner_id`, `actor_id`, `project_id`, search candidates, checked
sources, `next_index`, `attempts`, and timestamps. On process startup, interrupted
`queued/searching/reading` rows become `paused` without reopening web connections.
Resume requires owner identity and a fresh Policy Engine evaluation. Project A0 defaults to
`WEB_READ_DENIED`; both `ALLOW` and project-scoped `ALLOW_WITH_LIMITS` are honored.
The server emergency stop is checked before starting and between each fetched source.

Report descriptors at `GET /api/v1/research/:id/artifacts` have
`kind: "research_report"`, `source_run_id`, `version`, `media_type`, `download_url`, and source
provenance. The bytes are produced by `GET /api/v1/research/:id/export/md|html` from durable
research state; this feature doesn't attach them to Work/Studio or claim registration in the
separate Manager artifact store. Integration with a future shared artifact registry can ingest
these stable descriptors without modifying documents retrieval.

| Method | Route | Effect |
| --- | --- | --- |
| GET | `/api/v1/research/status` | Capability and limits |
| GET | `/api/v1/research` | Current owner's last 25 saved runs |
| POST | `/api/v1/research` | Project ID + question, policy check, launch |
| GET | `/api/v1/research/:id` | Saved progress and cited sources |
| POST | `/api/v1/research/:id/pause` | Abort current network request, retain checkpoint |
| POST | `/api/v1/research/:id/resume` | Reauthorize and continue from checkpoint |
| POST | `/api/v1/research/:id/cancel` | Terminal stop; late results ignored |
| DELETE | `/api/v1/research/:id` | Remove paused or terminal report |
| GET | `/api/v1/research/:id/artifacts` | Report version/source descriptors |
| GET | `/api/v1/research/:id/export/md|html` | Real UTF-8 downloadable bytes |

A request invokes **one** SearxNG query and considers up to five deduplicated candidate URLs.
At most four sources are read successfully, two runs can execute simultaneously, each run attempt
has a 45-second budget and each HTTP request a nine-second timeout, page bytes <=160 KB and
robots.txt <=32 KB. No multi-hop redirects, redirects on robots, login, CAPTCHA, external
network proxies, hidden model invocations, or paid calls. Each researched owner is limited to
25 saved runs and three run attempts; old paused/finished runs can be deleted.

All network reads resolve names, reject DNS sets containing any private/reserved address, and
pin the verified IP for TCP; direct IP hostnames, nonstandard ports, and local/internal domain
suffixes are rejected. The page reader checks wildcard/specific robots groups, pins the same
IP for robots/page, rejects other content types and compressed/oversized responses, and treats
HTML as untrusted text. The system **does not feed scraped instructions to a model**.

## UX / honest limitations

Open `/research-workspace` from the mode menu or the ordinary chat search panel; choose an
existing project with web-read authorization (A1+) and submit a question. The page displays
status, inspected counts, extracted fragments, links, session history, pause/resume/cancel,
source registry, and Markdown/HTML downloads. Design uses black/white/neutral gray.

The report is **extractive**: a short cited evidence summary and source-by-source excerpts,
not a generative or independently corroborated analytical essay. Some pages cannot be parsed
usefully (SPAs, PDFs, inaccessible pages, anti-bot measures). Robots directives are honored
conservatively; pages returning unexpected response headers or redirects are skipped.
Live hosted SearxNG and real public websites were not queried in the authoring sandbox.
No renderer/UI production deployment, Playwright, typecheck, monorepo build or installer
verification is claimed here. Existing authorization and deployment proxy remain unchanged.
