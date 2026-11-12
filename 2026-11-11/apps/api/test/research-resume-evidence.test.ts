import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  DEFAULT_DETERMINISTIC_FIXTURE_PAGES,
  DeterministicResearchBrowserAdapter,
  ProjectResearchOwnerBudget,
  ResearchCoordinator,
  ResearchStore,
  canonicalizeSourceUrl,
  registerResearchRoutes
} from "../src/research/index.js";
import {
  buildResearchWorkspaceViewModel,
  exportResearchReportFromViewModel
} from "../../web/src/app/research-workspace/view-model.js";

function createTestDatabase(filePath = ":memory:"): DatabaseSync {
  const db = new DatabaseSync(filePath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS kosmora_owner_data_lifecycle (
      owner_id TEXT PRIMARY KEY NOT NULL,
      state TEXT NOT NULL DEFAULT 'active',
      epoch INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT '2026-11-10T00:00:00.000Z'
    );
    INSERT OR IGNORE INTO kosmora_owner_data_lifecycle (owner_id, state, epoch)
      VALUES ('owner-1', 'active', 1), ('owner-2', 'active', 1);

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT '2026-11-10T00:00:00.000Z',
      updated_at TEXT NOT NULL DEFAULT '2026-11-10T00:00:00.000Z'
    );
    INSERT OR IGNORE INTO projects (id, owner_id, name)
      VALUES ('proj-owner-1', 'owner-1', 'Project Alpha'),
             ('proj-owner-2', 'owner-2', 'Project Beta');
  `);
  return db;
}

interface MockRouteHandler {
  (request: any, reply: any): Promise<any>;
}

function createMockFastifyApp() {
  const routes = new Map<string, MockRouteHandler>();
  const hooks: Array<() => unknown> = [];

  const app = {
    get(path: string, handler: MockRouteHandler) {
      routes.set(`GET ${path}`, handler);
    },
    post(path: string, handler: MockRouteHandler) {
      routes.set(`POST ${path}`, handler);
    },
    addHook(_name: string, fn: () => unknown) {
      hooks.push(fn);
    },
    async inject(req: {
      method: "GET" | "POST";
      url: string;
      ownerId?: string;
      body?: Record<string, unknown>;
      query?: Record<string, string>;
    }): Promise<{ statusCode: number; body: any; headers: Record<string, string> }> {
      let matchedHandler: MockRouteHandler | undefined;
      let params: Record<string, string> = {};

      const cleanPath = req.url.split("?")[0];
      const directKey = `${req.method} ${cleanPath}`;
      if (routes.has(directKey)) {
        matchedHandler = routes.get(directKey);
      } else {
        for (const [key, handler] of routes.entries()) {
          const [m, pattern] = key.split(" ");
          if (m !== req.method) continue;
          const regexStr =
            "^" +
            pattern.replace(/:([a-zA-Z0-9_]+)/g, (_full, paramName) => `(?<${paramName}>[^/]+)`) +
            "$";
          const match = cleanPath.match(new RegExp(regexStr));
          if (match) {
            matchedHandler = handler;
            params = (match.groups ?? {}) as Record<string, string>;
            break;
          }
        }
      }

      if (!matchedHandler) {
        return { statusCode: 404, body: { error: { code: "ROUTE_NOT_FOUND" } }, headers: {} };
      }

      const headers: Record<string, string> = {};
      let statusCode = 200;
      let sentPayload: any;

      const reply = {
        header(k: string, v: string) {
          headers[k.toLowerCase()] = v;
          return reply;
        },
        status(code: number) {
          statusCode = code;
          return reply;
        },
        send(payload: any) {
          sentPayload = payload;
          return payload;
        }
      };

      const request = {
        params,
        body: req.body ?? {},
        query: req.query ?? {},
        ownerId: req.ownerId ?? "owner-1"
      };

      const ret = await matchedHandler(request, reply);
      return {
        statusCode,
        body: sentPayload !== undefined ? sentPayload : ret,
        headers
      };
    }
  };

  return app;
}

test("1 & 2 & 6 & 8: Normal completion, restart persistence, idempotent request retry, source conflict separation, and UI report parity with stored result", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "kosmora-research-persist-"));
  const dbPath = join(tempDir, "research.sqlite");

  try {
    // Phase A: Initial run before application restart
    const db1 = createTestDatabase(dbPath);
    const store1 = new ResearchStore(db1);
    const adapter1 = new DeterministicResearchBrowserAdapter();
    const app1 = createMockFastifyApp();

    const coordinator1 = registerResearchRoutes({
      app: app1 as any,
      store: store1,
      browserAdapter: adapter1,
      ownerBudget: new ProjectResearchOwnerBudget(db1),
      identityFor: (req: any) =>
        ({
          owner_id: req.ownerId,
          session_id: `sess-${req.ownerId}`,
          actor: { id: req.ownerId, kind: "owner" }
        }) as any
    });

    const startRes = await app1.inject({
      method: "POST",
      url: "/api/v1/research/runs",
      ownerId: "owner-1",
      body: {
        project_id: "proj-owner-1",
        query: "OrionDB 2026: тарифы, SLA, задержка p95 и сертификация",
        client_request_id: "req-orion-001",
        budgets: { maxDepth: 2, maxSources: 5, maxRuntimeMs: 10000 }
      }
    });

    assert.equal(startRes.statusCode, 200);
    const run1 = startRes.body;
    assert.equal(run1.status, "completed");
    assert.equal(run1.progress.percent, 100);
    assert.equal(run1.sources.length, 3);
    assert.equal(
      run1.sources[0].originalUrl,
      "https://docs.kosmora.local/oriondb/2026-pricing?ref=official"
    );
    assert.equal(
      run1.sources[0].canonicalUrl,
      "https://docs.kosmora.local/oriondb/2026-pricing"
    );

    // Criterion #6: Separated confirmed, conflicting, and unconfirmed statements
    assert.equal(run1.confirmedClaims.length, 2, "Expected SLA and p95 latency to be confirmed");
    assert.equal(run1.conflictingClaims.length, 1, "Expected 2026 ($29/мес) vs 2025 ($49/мес) conflict");
    assert.equal(run1.conflictingClaims[0].criterion, "Базовая стоимость");
    assert.equal(run1.conflictingClaims[0].citations.length, 2);
    assert.equal(run1.unconfirmedClaims.length, 1, "Expected ФСТЭК К1 to be unconfirmed");
    assert.equal(run1.unconfirmedClaims[0].resolvedValue, "не удалось установить");

    // Criterion #2: Repeated request with same client_request_id or same normalized query does NOT duplicate results or re-read sources
    const readsBeforeRetry = adapter1.searchCallCount;
    const retryByClientId = await app1.inject({
      method: "POST",
      url: "/api/v1/research/runs",
      ownerId: "owner-1",
      body: {
        project_id: "proj-owner-1",
        query: "OrionDB 2026: тарифы, SLA, задержка p95 и сертификация",
        client_request_id: "req-orion-001"
      }
    });
    assert.equal(retryByClientId.statusCode, 200);
    assert.equal(retryByClientId.body.id, run1.id);
    assert.equal(adapter1.searchCallCount, readsBeforeRetry, "Retry must not re-run search");

    const retryByNormalizedQuery = await app1.inject({
      method: "POST",
      url: "/api/v1/research/runs",
      ownerId: "owner-1",
      body: {
        project_id: "proj-owner-1",
        query: "  oriondb 2026:   тарифы, sla, задержка p95 и сертификация  "
      }
    });
    assert.equal(retryByNormalizedQuery.statusCode, 200);
    assert.equal(retryByNormalizedQuery.body.id, run1.id);

    const listRes = await app1.inject({
      method: "GET",
      url: "/api/v1/research/runs",
      ownerId: "owner-1",
      query: { project_id: "proj-owner-1" }
    });
    assert.equal(listRes.body.items.length, 1, "Retries must not create duplicate runs in store");

    await coordinator1.stop();
    db1.close();

    // Phase B: Simulate full application restart by opening a fresh DatabaseSync, ResearchStore, and ResearchCoordinator on the same SQLite file
    const db2 = createTestDatabase(dbPath);
    const store2 = new ResearchStore(db2);
    const app2 = createMockFastifyApp();
    const coordinator2 = registerResearchRoutes({
      app: app2 as any,
      store: store2,
      browserAdapter: new DeterministicResearchBrowserAdapter(),
      ownerBudget: new ProjectResearchOwnerBudget(db2),
      identityFor: (req: any) =>
        ({
          owner_id: req.ownerId,
          session_id: `sess-${req.ownerId}`,
          actor: { id: req.ownerId, kind: "owner" }
        }) as any
    });

    const afterRestartRes = await app2.inject({
      method: "GET",
      url: `/api/v1/research/runs/${run1.id}`,
      ownerId: "owner-1"
    });
    assert.equal(afterRestartRes.statusCode, 200);
    const persistedRun = afterRestartRes.body;
    assert.equal(persistedRun.id, run1.id);
    assert.equal(persistedRun.status, "completed");
    assert.equal(persistedRun.reportMarkdown, run1.reportMarkdown);
    assert.deepEqual(persistedRun.confirmedClaims, run1.confirmedClaims);
    assert.deepEqual(persistedRun.conflictingClaims, run1.conflictingClaims);
    assert.deepEqual(persistedRun.unconfirmedClaims, run1.unconfirmedClaims);

    // Criterion #8: Report exported from UI contains the exact same links and quotes as the stored/backend exported result
    const backendExportRes = await app2.inject({
      method: "GET",
      url: `/api/v1/research/runs/${run1.id}/export`,
      ownerId: "owner-1"
    });
    assert.equal(backendExportRes.statusCode, 200);

    const vm = buildResearchWorkspaceViewModel(persistedRun);
    const uiExport = exportResearchReportFromViewModel(vm);

    assert.equal(uiExport.reportMarkdown, backendExportRes.body.reportMarkdown);
    assert.equal(uiExport.reportMarkdown, persistedRun.reportMarkdown);

    for (const src of backendExportRes.body.sources) {
      assert.ok(
        uiExport.links.includes(src.originalUrl),
        `UI export must contain originalUrl ${src.originalUrl}`
      );
      assert.ok(
        uiExport.reportMarkdown.includes(src.originalUrl) &&
          uiExport.reportMarkdown.includes(src.pageVersion) &&
          uiExport.reportMarkdown.includes(src.fetchedAt),
        `UI markdown must include URL, version, and fetchedAt for ${src.originalUrl}`
      );
    }

    const storedQuotes = [
      ...backendExportRes.body.confirmedClaims.flatMap((c: any) =>
        c.citations.map((cit: any) => cit.verbatimQuote)
      ),
      ...backendExportRes.body.conflictingClaims.flatMap((c: any) =>
        c.citations.map((cit: any) => cit.verbatimQuote)
      )
    ];
    assert.deepEqual(uiExport.quotes, storedQuotes);

    await coordinator2.stop();
    db2.close();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("3 & 4: Stop during reading AND transient failure recovery re-execute ONLY unfinished source reads without duplicating completed steps", async () => {
  const db = createTestDatabase(":memory:");
  const store = new ResearchStore(db);
  const adapter = new DeterministicResearchBrowserAdapter();
  const coordinator = new ResearchCoordinator({ store, browserAdapter: adapter });

  const firstSourceCanonical = canonicalizeSourceUrl(
    DEFAULT_DETERMINISTIC_FIXTURE_PAGES[0].url
  );
  const secondSourceCanonical = canonicalizeSourceUrl(
    DEFAULT_DETERMINISTIC_FIXTURE_PAGES[1].url
  );
  const thirdSourceCanonical = canonicalizeSourceUrl(
    DEFAULT_DETERMINISTIC_FIXTURE_PAGES[2].url
  );

  // Criterion #3: Stop/cancel the run while reading the 2nd source (after the 1st source has already been read and checkpointed)
  let activeRunId = "";
  adapter.onBeforeReadUrl = (canonicalUrl) => {
    if (canonicalUrl === secondSourceCanonical && activeRunId) {
      coordinator.cancelRun(activeRunId, "owner-1");
    }
  };

  const startedBg = await coordinator.startRun({
    ownerId: "owner-1",
    projectId: "proj-owner-1",
    query: "Остановка во время чтения источников OrionDB",
    runInBackground: true
  });
  activeRunId = startedBg.id;
  await coordinator.waitForActiveRun(activeRunId);

  const cancelledRun = coordinator.getRun(activeRunId, "owner-1");
  assert.equal(cancelledRun.status, "cancelled");
  assert.equal(
    adapter.readCallCountByCanonical.get(firstSourceCanonical),
    1,
    "First source was read once before cancellation"
  );
  assert.equal(
    adapter.readCallCountByCanonical.get(secondSourceCanonical) ?? 0,
    0,
    "Second source was cancelled before completion"
  );

  // Criterion #4: Inject a transient failure on the 3rd source when resuming, to verify failure & recovery from the last step
  adapter.onBeforeReadUrl = undefined;
  adapter.injectReadFailureOnce(thirdSourceCanonical);

  const failedOnThird = await coordinator.resumeRun(activeRunId, "owner-1");
  assert.equal(failedOnThird.status, "failed");
  assert.match(String(failedOnThird.errorCode), /SOURCE_READ_TRANSIENT_ERROR/);
  assert.equal(
    adapter.readCallCountByCanonical.get(firstSourceCanonical),
    1,
    "Completed 1st source must NOT be re-executed on resume"
  );
  assert.equal(adapter.readCallCountByCanonical.get(secondSourceCanonical), 1);

  // Now resume again after the transient failure on the 3rd source: ONLY the 3rd source and synthesis should execute!
  const completedAfterRecovery = await coordinator.resumeRun(activeRunId, "owner-1");
  assert.equal(completedAfterRecovery.status, "completed");
  assert.equal(
    adapter.readCallCountByCanonical.get(firstSourceCanonical),
    1,
    "1st source read count must remain 1 across cancel + fail + resume"
  );
  assert.equal(
    adapter.readCallCountByCanonical.get(secondSourceCanonical),
    1,
    "2nd source read count must remain 1 across fail + resume"
  );
  assert.equal(
    adapter.readCallCountByCanonical.get(thirdSourceCanonical),
    1,
    "3rd source succeeded on recovery retry"
  );
  assert.equal(completedAfterRecovery.sources.length, 3);
  assert.ok(completedAfterRecovery.reportMarkdown);

  await coordinator.stop();
  db.close();
});

test("5 & 7: Changed page detection (version update & quote re-verification), runtime budget guard, AND strict prohibition of reading/cancelling/resuming another user's task", async () => {
  const db = createTestDatabase(":memory:");
  const store = new ResearchStore(db);
  const adapter = new DeterministicResearchBrowserAdapter();
  const app = createMockFastifyApp();

  const coordinator = registerResearchRoutes({
    app: app as any,
    store,
    browserAdapter: adapter,
    ownerBudget: new ProjectResearchOwnerBudget(db),
    identityFor: (req: any) =>
      ({
        owner_id: req.ownerId,
        session_id: `sess-${req.ownerId}`,
        actor: { id: req.ownerId, kind: "owner" }
      }) as any
  });

  // Criterion #5: Mutate page content & version after search discovery / before re-verification
  const targetUrl = DEFAULT_DETERMINISTIC_FIXTURE_PAGES[0].url;
  const targetCanonical = canonicalizeSourceUrl(targetUrl);

  adapter.onBeforeReadUrl = (canonicalUrl) => {
    if (canonicalUrl === targetCanonical) {
      adapter.updateFixturePage(targetUrl, {
        pageVersion: "pv-orion-2026-v2",
        fetchedAt: "2026-11-10T19:30:00.000Z",
        contentText:
          "Обновлённая спецификация OrionDB (редакция v2). Для корпоративного тарифа OrionDB базовая стоимость составляет $25/мес при годовой подписке. Гарантированный уровень доступности OrionDB составляет SLA 99.99%.",
        claims: [
          {
            subject: "OrionDB",
            criterion: "Базовая стоимость",
            claimedValue: "$25/мес",
            verbatimQuote:
              "Для корпоративного тарифа OrionDB базовая стоимость составляет $25/мес при годовой подписке."
          },
          {
            subject: "OrionDB",
            criterion: "SLA доступности",
            claimedValue: "99.99%",
            verbatimQuote: "Гарантированный уровень доступности OrionDB составляет SLA 99.99%."
          }
        ]
      });
      adapter.onBeforeReadUrl = undefined;
    }
  };

  const runRes = await app.inject({
    method: "POST",
    url: "/api/v1/research/runs",
    ownerId: "owner-1",
    body: {
      project_id: "proj-owner-1",
      query: "Проверка изменившейся страницы OrionDB",
      budgets: { maxDepth: 1, maxSources: 2, maxRuntimeMs: 10000 }
    }
  });
  assert.equal(runRes.statusCode, 200);
  const run = runRes.body;

  // Verify depth & maxSources budgets were enforced (depth=2 benchmark page was excluded because maxDepth=1, maxSources=2)
  assert.equal(run.sources.length, 2);
  assert.equal(run.budgets.depthReached, 1);

  // Verify changed page was detected, previousPageVersion recorded, and updated quote ($25/мес) verified
  const changedSource = run.sources.find((s: any) => s.canonicalUrl === targetCanonical);
  assert.ok(changedSource);
  assert.equal(changedSource.pageChanged, true);
  assert.equal(changedSource.previousPageVersion, "pv-orion-2026-v1");
  assert.equal(changedSource.pageVersion, "pv-orion-2026-v2");
  assert.equal(run.conflictingClaims[0].resolvedValue, "$25/мес");

  // Criterion #7: Reading, cancelling, resuming, or exporting another owner's task is strictly forbidden (403)
  const readByOther = await app.inject({
    method: "GET",
    url: `/api/v1/research/runs/${run.id}`,
    ownerId: "owner-2"
  });
  assert.equal(readByOther.statusCode, 403);
  assert.equal(readByOther.body.error.code, "RESEARCH_RUN_FORBIDDEN");

  const cancelByOther = await app.inject({
    method: "POST",
    url: `/api/v1/research/runs/${run.id}/cancel`,
    ownerId: "owner-2"
  });
  assert.equal(cancelByOther.statusCode, 403);
  assert.equal(cancelByOther.body.error.code, "RESEARCH_RUN_FORBIDDEN");

  const resumeByOther = await app.inject({
    method: "POST",
    url: `/api/v1/research/runs/${run.id}/resume`,
    ownerId: "owner-2"
  });
  assert.equal(resumeByOther.statusCode, 403);
  assert.equal(resumeByOther.body.error.code, "RESEARCH_RUN_FORBIDDEN");

  const exportByOther = await app.inject({
    method: "GET",
    url: `/api/v1/research/runs/${run.id}/export`,
    ownerId: "owner-2"
  });
  assert.equal(exportByOther.statusCode, 403);
  assert.equal(exportByOther.body.error.code, "RESEARCH_RUN_FORBIDDEN");

  const startInOtherProject = await app.inject({
    method: "POST",
    url: "/api/v1/research/runs",
    ownerId: "owner-2",
    body: {
      project_id: "proj-owner-1",
      query: "Попытка запуска в чужом проекте"
    }
  });
  assert.equal(startInOtherProject.statusCode, 403);
  assert.equal(startInOtherProject.body.error.code, "RESEARCH_PROJECT_FORBIDDEN");

  // Also verify runtime clock budget enforcement (`RESEARCH_RUNTIME_BUDGET_EXCEEDED`)
  let simulatedClockMs = 1_000;
  const timedCoordinator = new ResearchCoordinator({
    store,
    browserAdapter: new DeterministicResearchBrowserAdapter(),
    clock: () => {
      simulatedClockMs += 600;
      return simulatedClockMs;
    }
  });
  const timedOutRun = await timedCoordinator.startRun({
    ownerId: "owner-1",
    projectId: "proj-owner-1",
    query: "Проверка превышения бюджета времени",
    budgets: { maxRuntimeMs: 800 }
  });
  assert.equal(timedOutRun.status, "failed");
  assert.equal(timedOutRun.errorCode, "RESEARCH_RUNTIME_BUDGET_EXCEEDED");

  await timedCoordinator.stop();
  await coordinator.stop();
  db.close();
});
