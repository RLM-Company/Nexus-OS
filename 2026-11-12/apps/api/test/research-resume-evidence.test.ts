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
  ResearchIntegratedPrivacyAdapter,
  ResearchStore,
  canonicalizeSourceUrl,
  registerResearchRoutes,
  sha256Hex
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

test("Target Acceptance Scenario: 2 sources succeed, 3rd temporarily unavailable -> saves progress (next_index=2, canResume=true) -> app restart -> click 'Продолжить' (double-click & foreign-owner guarded, paid model call not repeated, first 2 sources not re-read, 3rd fetched again, final report has all quotes without duplicates)", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "kosmora-deep-research-resume-"));
  const dbPath = join(tempDir, "research-resume.sqlite");

  const source1Canonical = canonicalizeSourceUrl(DEFAULT_DETERMINISTIC_FIXTURE_PAGES[0].url);
  const source2Canonical = canonicalizeSourceUrl(DEFAULT_DETERMINISTIC_FIXTURE_PAGES[1].url);
  const source3Canonical = canonicalizeSourceUrl(DEFAULT_DETERMINISTIC_FIXTURE_PAGES[2].url);

  let paidModelCallsCount = 0;
  const mockPaidModelGateway = {
    async planResearchQueries(input: { query: string }) {
      paidModelCallsCount += 1;
      return {
        queries: [`${input.query} official spec`, `${input.query} benchmark`]
      };
    }
  };

  try {
    const dbBefore = createTestDatabase(dbPath);
    const storeBefore = new ResearchStore(dbBefore);
    const adapterBefore = new DeterministicResearchBrowserAdapter();
    adapterBefore.injectReadFailureOnce(source3Canonical);

    const appBefore = createMockFastifyApp();
    const coordinatorBefore = registerResearchRoutes({
      app: appBefore as any,
      store: storeBefore,
      browserAdapter: adapterBefore,
      gateway: mockPaidModelGateway,
      ownerBudget: new ProjectResearchOwnerBudget(dbBefore),
      identityFor: (req: any) =>
        ({
          owner_id: req.ownerId,
          session_id: `sess-${req.ownerId}`,
          actor: { id: req.ownerId, kind: "owner" }
        }) as any
    });

    const startRes = await appBefore.inject({
      method: "POST",
      url: "/api/v1/research/runs",
      ownerId: "owner-1",
      body: {
        project_id: "proj-owner-1",
        query: "OrionDB 2026: проверка восстановления с 3-го источника"
      }
    });

    assert.equal(startRes.statusCode, 200);
    const interruptedRun = startRes.body;
    assert.equal(interruptedRun.status, "failed");
    assert.equal(interruptedRun.canResume, true);
    assert.equal(interruptedRun.nextIndex, 2);
    assert.equal(interruptedRun.sources.length, 2);
    assert.equal(paidModelCallsCount, 1);

    await coordinatorBefore.stop();
    dbBefore.close();

    // Simulate full application restart
    const dbAfter = createTestDatabase(dbPath);
    const storeAfter = new ResearchStore(dbAfter);
    const adapterAfter = new DeterministicResearchBrowserAdapter();
    const appAfter = createMockFastifyApp();

    const coordinatorAfter = registerResearchRoutes({
      app: appAfter as any,
      store: storeAfter,
      browserAdapter: adapterAfter,
      gateway: mockPaidModelGateway,
      ownerBudget: new ProjectResearchOwnerBudget(dbAfter),
      identityFor: (req: any) =>
        ({
          owner_id: req.ownerId,
          session_id: `sess-${req.ownerId}`,
          actor: { id: req.ownerId, kind: "owner" }
        }) as any
    });

    const foreignResume = await appAfter.inject({
      method: "POST",
      url: `/api/v1/research/runs/${interruptedRun.id}/resume`,
      ownerId: "owner-2"
    });
    assert.equal(foreignResume.statusCode, 403);
    assert.equal(foreignResume.body.error.code, "RESEARCH_RUN_FORBIDDEN");

    const [resumeRes1, resumeRes2] = await Promise.all([
      appAfter.inject({
        method: "POST",
        url: `/api/v1/research/runs/${interruptedRun.id}/resume`,
        ownerId: "owner-1"
      }),
      appAfter.inject({
        method: "POST",
        url: `/api/v1/research/runs/${interruptedRun.id}/resume`,
        ownerId: "owner-1"
      })
    ]);

    assert.equal(resumeRes1.statusCode, 200);
    assert.equal(resumeRes2.statusCode, 200);
    assert.equal(resumeRes1.body.status, "completed");
    assert.equal(paidModelCallsCount, 1);
    assert.equal(adapterAfter.readCallCountByCanonical.get(source1Canonical) ?? 0, 0);
    assert.equal(adapterAfter.readCallCountByCanonical.get(source2Canonical) ?? 0, 0);
    assert.equal(adapterAfter.readCallCountByCanonical.get(source3Canonical), 1);

    await coordinatorAfter.stop();
    dbAfter.close();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("1 & 2 & 6 & 8: Normal completion, restart persistence, idempotent request retry, source conflict separation, and UI report parity with stored result", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "kosmora-research-persist-"));
  const dbPath = join(tempDir, "research.sqlite");

  try {
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

    await coordinator1.stop();
    db1.close();

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

    const backendExportRes = await app2.inject({
      method: "GET",
      url: `/api/v1/research/runs/${run1.id}/export`,
      ownerId: "owner-1"
    });
    assert.equal(backendExportRes.statusCode, 200);

    const vm = buildResearchWorkspaceViewModel(afterRestartRes.body);
    const uiExport = exportResearchReportFromViewModel(vm);
    assert.equal(uiExport.reportMarkdown, backendExportRes.body.reportMarkdown);

    await coordinator2.stop();
    db2.close();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
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

  const changedSource = run.sources.find((s: any) => s.canonicalUrl === targetCanonical);
  assert.ok(changedSource);
  assert.equal(changedSource.pageChanged, true);
  assert.equal(changedSource.previousPageVersion, "pv-orion-2026-v1");
  assert.equal(changedSource.pageVersion, "pv-orion-2026-v2");

  await coordinator.stop();
  db.close();
});

test("Hybrid Project Document Library, Follow-Up, Canvas, Project Handoff, Grounded Q&A, Context Memory promotion, Temporal Diff, Verifiable Bundle Export/Import, and ResearchIntegratedPrivacyAdapter", async () => {
  const db = createTestDatabase(":memory:");
  const store = new ResearchStore(db);
  const adapter = new DeterministicResearchBrowserAdapter();
  const app = createMockFastifyApp();

  let coordinatorRef: ResearchCoordinator | null = null;
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
  coordinatorRef = coordinator;

  // 1. Run baseline research
  const baseRunRes = await app.inject({
    method: "POST",
    url: "/api/v1/research/runs",
    ownerId: "owner-1",
    body: {
      project_id: "proj-owner-1",
      query: "OrionDB: базовый срез до сертификации"
    }
  });
  assert.equal(baseRunRes.statusCode, 200);
  const baseRun = baseRunRes.body;

  // Promote baseline claims to `context_memory_entries`
  const promote1 = await app.inject({
    method: "POST",
    url: `/api/v1/research/runs/${baseRun.id}/promote-to-memory`,
    ownerId: "owner-1"
  });
  assert.equal(promote1.statusCode, 200);
  assert.equal(promote1.body.promoted.length, 3);
  assert.equal(promote1.body.skippedUnconfirmedCount, 1);

  // 2. Export Verifiable Bundle (`GET /api/v1/research/runs/:runId/bundle`)
  const bundleRes = await app.inject({
    method: "GET",
    url: `/api/v1/research/runs/${baseRun.id}/bundle`,
    ownerId: "owner-1"
  });
  assert.equal(bundleRes.statusCode, 200);
  const validBundle = bundleRes.body;
  assert.equal(validBundle.schemaVersion, "kosmora.research.bundle.v1");

  // Tampering with bundle payload without updating bundleSha256 is rejected (400 RESEARCH_BUNDLE_HASH_MISMATCH)
  const tamperedHashBundle = JSON.parse(JSON.stringify(validBundle));
  tamperedHashBundle.payload.query = "Подменённый запрос";
  const badHashImport = await app.inject({
    method: "POST",
    url: "/api/v1/research/runs/import-bundle",
    ownerId: "owner-2",
    body: {
      project_id: "proj-owner-2",
      bundle: tamperedHashBundle
    }
  });
  assert.equal(badHashImport.statusCode, 400);
  assert.equal(badHashImport.body.error.code, "RESEARCH_BUNDLE_HASH_MISMATCH");

  // Tampering with a quote so it no longer exists in source snapshot text (even if bundleSha256 is recomputed) is rejected (400 RESEARCH_BUNDLE_EVIDENCE_CORRUPT)
  const forgedQuoteBundle = JSON.parse(JSON.stringify(validBundle));
  forgedQuoteBundle.payload.sources[0].extractedClaims[0].verbatimQuote =
    "Выдуманная цитата, которой нет в снимке источника.";
  forgedQuoteBundle.bundleSha256 = sha256Hex(JSON.stringify(forgedQuoteBundle.payload));
  const badQuoteImport = await app.inject({
    method: "POST",
    url: "/api/v1/research/runs/import-bundle",
    ownerId: "owner-2",
    body: {
      project_id: "proj-owner-2",
      bundle: forgedQuoteBundle
    }
  });
  assert.equal(badQuoteImport.statusCode, 400);
  assert.equal(badQuoteImport.body.error.code, "RESEARCH_BUNDLE_EVIDENCE_CORRUPT");

  // Importing the valid bundle into `owner-2`'s project succeeds with fresh run ID and identical verified claims
  const validImportRes = await app.inject({
    method: "POST",
    url: "/api/v1/research/runs/import-bundle",
    ownerId: "owner-2",
    body: {
      project_id: "proj-owner-2",
      bundle: validBundle
    }
  });
  assert.equal(validImportRes.statusCode, 200);
  assert.notEqual(validImportRes.body.id, baseRun.id);
  assert.equal(validImportRes.body.ownerId, "owner-2");
  assert.equal(validImportRes.body.confirmedClaims.length, baseRun.confirmedClaims.length);
  assert.equal(validImportRes.body.conflictingClaims.length, baseRun.conflictingClaims.length);


  // 3. Interactive Conflict Resolution (`POST /api/v1/research/runs/:runId/claims/:claimId/resolve`) & UI VerificationChecklist
  const vmBeforeResolve = buildResearchWorkspaceViewModel(baseRun);
  assert.equal(vmBeforeResolve.verificationChecklist.length, 1);
  const conflictItem = vmBeforeResolve.verificationChecklist[0];
  assert.equal(conflictItem.criterion, "Базовая стоимость");
  assert.equal(conflictItem.options.length, 2);

  // Foreign user cannot resolve conflict (`403 RESEARCH_RUN_FORBIDDEN`)
  const foreignResolveRes = await app.inject({
    method: "POST",
    url: `/api/v1/research/runs/${baseRun.id}/claims/${conflictItem.claimId}/resolve`,
    ownerId: "owner-2",
    body: {
      winning_source_id: conflictItem.options[0].sourceId,
      resolution_note: "Попытка чужого пользователя"
    }
  });
  assert.equal(foreignResolveRes.statusCode, 403);
  assert.equal(foreignResolveRes.body.error.code, "RESEARCH_RUN_FORBIDDEN");

  // Unrelated source ID is rejected (`400 RESEARCH_INVALID_WINNING_SOURCE`)
  const invalidSourceResolveRes = await app.inject({
    method: "POST",
    url: `/api/v1/research/runs/${baseRun.id}/claims/${conflictItem.claimId}/resolve`,
    ownerId: "owner-1",
    body: {
      winning_source_id: "src_non_existent",
      resolution_note: "Неверный источник"
    }
  });
  assert.equal(invalidSourceResolveRes.statusCode, 400);
  assert.equal(invalidSourceResolveRes.body.error.code, "RESEARCH_INVALID_WINNING_SOURCE");

  // Valid resolution by owner transitions claim from `conflicting` -> `confirmed` with immutable `resolutionAudit` and updates reportMarkdown
  const chosenOption = conflictItem.options[0];
  assert.ok(chosenOption);
  const validResolveRes = await app.inject({
    method: "POST",
    url: `/api/v1/research/runs/${baseRun.id}/claims/${conflictItem.claimId}/resolve`,
    ownerId: "owner-1",
    body: {
      winning_source_id: chosenOption.sourceId,
      resolution_note: "Принята официальная спецификация OrionDB 2026 ($20/мес)."
    }
  });
  assert.equal(validResolveRes.statusCode, 200);
  const resolvedRun = validResolveRes.body;
  assert.equal(resolvedRun.conflictingClaims.length, 0);
  assert.equal(resolvedRun.confirmedClaims.length, 3);
  const resolvedClaim = resolvedRun.confirmedClaims.find(
    (c: any) => c.claimId === conflictItem.claimId
  );
  assert.ok(resolvedClaim);
  assert.equal(resolvedClaim.resolvedValue, chosenOption.claimedValue);
  assert.equal(resolvedClaim.resolutionAudit.resolvedBy, "owner-1");
  assert.equal(resolvedClaim.resolutionAudit.previousCategory, "conflicting");
  assert.equal(resolvedClaim.resolutionAudit.winningPageVersion, chosenOption.pageVersion);
  assert.ok(
    resolvedRun.reportMarkdown.includes(
      "Принята официальная спецификация OrionDB 2026 ($20/мес)."
    )
  );

  const vmAfterResolve = buildResearchWorkspaceViewModel(resolvedRun);
  assert.equal(vmAfterResolve.verificationChecklist.length, 0);
  const exportedUiAfterResolve = exportResearchReportFromViewModel(vmAfterResolve);
  assert.equal(exportedUiAfterResolve.reportMarkdown, resolvedRun.reportMarkdown);


  // 4. Selective Source Freshness Re-verification (`POST /api/v1/research/runs/:runId/reverify-sources`)
  // 4a. When sources have not changed, manual resolutionAudit stays intact and changedUrls is empty
  const reverifyUnchangedRes = await app.inject({
    method: "POST",
    url: `/api/v1/research/runs/${baseRun.id}/reverify-sources`,
    ownerId: "owner-1",
    body: {}
  });
  assert.equal(reverifyUnchangedRes.statusCode, 200);
  assert.equal(reverifyUnchangedRes.body.changedUrls.length, 0);
  assert.equal(reverifyUnchangedRes.body.invalidatedClaimIds.length, 0);
  assert.equal(reverifyUnchangedRes.body.run.conflictingClaims.length, 0);

  // 4b. When the winning source page updates its price from $20/мес to $29/мес, reverify-sources detects the change and invalidates the stale manual resolution
  adapter.updateFixturePage(chosenOption.originalUrl, {
    pageVersion: "pv-orion-2026-v3-reverified",
    fetchedAt: "2026-11-11T12:00:00.000Z",
    contentText:
      "Обновлённый прайс OrionDB 2026 (v3): базовая стоимость корпоративного плана OrionDB составляет $29/мес при годовой подписке. SLA доступности OrionDB равен 99.99%.",
    claims: [
      {
        subject: "OrionDB",
        criterion: "Базовая стоимость",
        claimedValue: "$29/мес",
        verbatimQuote:
          "Обновлённый прайс OrionDB 2026 (v3): базовая стоимость корпоративного плана OrionDB составляет $29/мес при годовой подписке."
      },
      {
        subject: "OrionDB",
        criterion: "SLA доступности",
        claimedValue: "99.99%",
        verbatimQuote: "SLA доступности OrionDB равен 99.99%."
      }
    ]
  });

  const reverifyChangedRes = await app.inject({
    method: "POST",
    url: `/api/v1/research/runs/${baseRun.id}/reverify-sources`,
    ownerId: "owner-1",
    body: { target_urls: [chosenOption.originalUrl] }
  });
  assert.equal(reverifyChangedRes.statusCode, 200);
  assert.equal(reverifyChangedRes.body.checkedCount, 1);
  assert.equal(reverifyChangedRes.body.changedUrls.length, 1);
  assert.equal(reverifyChangedRes.body.invalidatedClaimIds.length, 1);
  assert.equal(reverifyChangedRes.body.run.conflictingClaims.length, 1);
  assert.equal(reverifyChangedRes.body.run.conflictingClaims[0].resolutionAudit, null);


  // 5. Reusable Workflow DAG Research Step Execution & Self-Healing Resume (`POST /api/v1/research/workflow-step`)
  const thirdUrl = DEFAULT_DETERMINISTIC_FIXTURE_PAGES[2].url;
  adapter.injectReadFailureOnce(thirdUrl);

  // Attempt 1: source #3 fails transiently -> step checkpoint enters `self_healing` at `nextIndex = 2`
  const wfStepAttempt1 = await app.inject({
    method: "POST",
    url: "/api/v1/research/workflow-step",
    ownerId: "owner-1",
    body: {
      project_id: "proj-owner-1",
      workflow_run_id: "wfrun-orion-101",
      step_id: "node-deep-research",
      query: "Workflow исследование OrionDB с самовосстановлением шага",
      promote_confirmed_to_memory: true
    }
  });
  assert.equal(wfStepAttempt1.statusCode, 200);
  assert.equal(wfStepAttempt1.body.resumedFromCheckpoint, false);
  assert.equal(wfStepAttempt1.body.workflowCheckpoint.attempt, 1);
  assert.equal(wfStepAttempt1.body.workflowCheckpoint.status, "self_healing");
  assert.equal(wfStepAttempt1.body.run.status, "failed");
  assert.equal(wfStepAttempt1.body.run.nextIndex, 2);

  // Attempt 2: workflow runtime retries the step -> automatically resumes from `nextIndex = 2` without re-reading first 2 sources
  const wfStepAttempt2 = await app.inject({
    method: "POST",
    url: "/api/v1/research/workflow-step",
    ownerId: "owner-1",
    body: {
      project_id: "proj-owner-1",
      workflow_run_id: "wfrun-orion-101",
      step_id: "node-deep-research",
      query: "Workflow исследование OrionDB с самовосстановлением шага",
      promote_confirmed_to_memory: true
    }
  });
  assert.equal(wfStepAttempt2.statusCode, 200);
  assert.equal(wfStepAttempt2.body.resumedFromCheckpoint, true);
  assert.equal(wfStepAttempt2.body.run.id, wfStepAttempt1.body.run.id);
  assert.equal(wfStepAttempt2.body.workflowCheckpoint.attempt, 2);
  assert.equal(wfStepAttempt2.body.workflowCheckpoint.status, "completed");
  assert.ok(wfStepAttempt2.body.workflowCheckpoint.outputContent.includes("OrionDB"));

  // Attempt 3 on an already-completed workflow step is a pure idempotent no-op
  const wfStepAttempt3 = await app.inject({
    method: "POST",
    url: "/api/v1/research/workflow-step",
    ownerId: "owner-1",
    body: {
      project_id: "proj-owner-1",
      workflow_run_id: "wfrun-orion-101",
      step_id: "node-deep-research",
      query: "Workflow исследование OrionDB с самовосстановлением шага"
    }
  });
  assert.equal(wfStepAttempt3.statusCode, 200);
  assert.equal(wfStepAttempt3.body.deduplicatedCompleted, true);
  assert.equal(wfStepAttempt3.body.workflowCheckpoint.attempt, 2);


  // 6. Positional Roaring Inverted Index Evidence Search (`GET /api/v1/research/evidence/search` & `kosmora_roaring_inverted_snapshots`)
  const phraseSearchRes = await app.inject({
    method: "GET",
    url: "/api/v1/research/evidence/search",
    ownerId: "owner-1",
    query: {
      phrase: "SLA доступности OrionDB",
      max_slop: 2,
      project_id: "proj-owner-1",
      category: "confirmed"
    }
  });
  assert.equal(phraseSearchRes.statusCode, 200);
  assert.equal(phraseSearchRes.body.snapshotId, "roaring_owner-1_research_evidence");
  assert.ok(phraseSearchRes.body.hits.length >= 1);
  assert.ok(
    phraseSearchRes.body.hits.some((h: any) =>
      h.matchedQuotes.some((q: string) => q.includes("99.99%"))
    )
  );

  // Foreign user cannot search `owner-1`'s project evidence (`403 RESEARCH_PROJECT_FORBIDDEN`)
  const foreignSearchRes = await app.inject({
    method: "GET",
    url: "/api/v1/research/evidence/search",
    ownerId: "owner-2",
    query: {
      phrase: "SLA доступности OrionDB",
      project_id: "proj-owner-1"
    }
  });
  assert.equal(foreignSearchRes.statusCode, 403);
  assert.equal(foreignSearchRes.body.error.code, "RESEARCH_PROJECT_FORBIDDEN");


  // 7. Probabilistic Cuckoo Filter Evidence Deduplication (`POST /api/v1/research/evidence/check-seen` & `kosmora_probabilistic_filter_snapshots`)
  const knownUrl = DEFAULT_DETERMINISTIC_FIXTURE_PAGES[1].url;
  const knownQuote = DEFAULT_DETERMINISTIC_FIXTURE_PAGES[1].claims[0].verbatimQuote;
  const checkSeenRes = await app.inject({
    method: "POST",
    url: "/api/v1/research/evidence/check-seen",
    ownerId: "owner-1",
    body: {
      urls: [
        `${knownUrl}?utm_source=tracker`,
        "https://unknown-domain.example/never-read"
      ],
      page_versions: [
        { url: knownUrl, page_version: DEFAULT_DETERMINISTIC_FIXTURE_PAGES[1].pageVersion },
        { url: knownUrl, page_version: "pv-non-existent-999" }
      ],
      quotes: [
        knownQuote,
        "Цитата, которой никогда не было ни в одном исследовании."
      ]
    }
  });
  assert.equal(checkSeenRes.statusCode, 200);
  assert.equal(checkSeenRes.body.snapshotId, "cuckoo_owner-1_research_evidence");
  assert.ok(checkSeenRes.body.itemCount >= 6);
  assert.equal(checkSeenRes.body.urls[0].seen, true);
  assert.equal(checkSeenRes.body.urls[1].seen, false);
  assert.equal(checkSeenRes.body.pageVersions[0].seen, true);
  assert.equal(checkSeenRes.body.pageVersions[1].seen, false);
  assert.equal(checkSeenRes.body.quotes[0].seen, true);
  assert.equal(checkSeenRes.body.quotes[1].seen, false);


  // 8. Cross-Citation Knowledge Graph & Source Authority Ranking (`GET /api/v1/research/runs/:runId/citation-graph`)
  const graphRes = await app.inject({
    method: "GET",
    url: `/api/v1/research/runs/${baseRun.id}/citation-graph`,
    ownerId: "owner-1"
  });
  assert.equal(graphRes.statusCode, 200);
  assert.equal(graphRes.body.runId, baseRun.id);
  assert.equal(graphRes.body.sourceNodes.length, 3);
  assert.ok(graphRes.body.sourceNodes[0].authorityScore >= graphRes.body.sourceNodes[1].authorityScore);
  assert.ok(graphRes.body.citationEdges.length >= 4);
  assert.equal(graphRes.body.contradictionPairs.length, 1);
  assert.equal(graphRes.body.isolatedUnconfirmedClaims.length, 1);

  // 9. Cryptographic Hash-Chained Audit Trail & Compliance Certificate (`GET /api/v1/research/runs/:runId/audit-trail`)
  const auditRes = await app.inject({
    method: "GET",
    url: `/api/v1/research/runs/${baseRun.id}/audit-trail`,
    ownerId: "owner-1"
  });
  assert.equal(auditRes.statusCode, 200);
  assert.equal(auditRes.body.verification.isValid, true);
  assert.equal(auditRes.body.certificate.integrityVerified, true);
  assert.ok(auditRes.body.certificate.certificateId.startsWith("CERT-KOSMORA-"));
  assert.ok(auditRes.body.events.length >= 3);
  assert.equal(auditRes.body.events[0].eventType, "research.run.created");
  assert.ok(
    auditRes.body.events.some(
      (e: any) => e.eventType === "research.claim.conflict_resolved"
    )
  );

  // Privacy lifecycle & Cloud Backup/Restore checkpoint preservation verification
  const privacyAdapter = new ResearchIntegratedPrivacyAdapter(
    db,
    store,
    () => coordinatorRef
  );
  assert.equal(privacyAdapter.id, "research");
  const exportedSection = await privacyAdapter.export("owner-1");
  assert.equal(exportedSection.complete, true);
  assert.ok(exportedSection.records.runs.length >= 1);
  assert.ok(exportedSection.records.steps.length >= 4);
  assert.ok(exportedSection.records.sources.length >= 3);
  assert.ok(exportedSection.records.claims.length >= 4);

  const quiesced = await privacyAdapter.quiesce("owner-1", 2);
  assert.equal(quiesced.drained, true);
  const deletedPrivacy = await privacyAdapter.delete("owner-1", 3);
  assert.ok(deletedPrivacy.deleted_records >= 8);
  await privacyAdapter.resume("owner-1");

  // Restore the exported research section into fresh run IDs and verify all checkpoints, sources, and claims are intact
  const restoredRunMap = store.restoreFromPrivacySection("owner-1", exportedSection.records, {
    "proj-owner-1": "proj-owner-1"
  });
  const restoredRunId = restoredRunMap[baseRun.id];
  assert.ok(restoredRunId);
  assert.notEqual(restoredRunId, baseRun.id);
  const restoredView = store.getRunForOwner(restoredRunId, "owner-1");
  assert.equal(restoredView.sources.length, 3);
  assert.equal(restoredView.nextIndex, 3);
  assert.equal(restoredView.checkpoint.plan_model_completed, true);

  await coordinator.stop();
  db.close();
});
