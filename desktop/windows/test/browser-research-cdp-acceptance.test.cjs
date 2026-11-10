'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { startCorpusHttpServer } = require('../browser/corpus-http-server.cjs');
const { KosworkBrowserEngine } = require('../browser/engine.cjs');
const { verifyEvidenceAgainstSnapshotAndClaim } = require('../browser/evidence-verifier.cjs');
const {
  decomposeResearchGoalIntoQuestions,
  executeMultiSiteResearchWorkflow,
} = require('../browser/research-workflow.cjs');

let corpusServer = null;
let engine = null;
let workspaceDir = null;

test.before(async () => {
  workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'koswork-05-gemini-'));
  fs.mkdirSync(path.join(workspaceDir, 'allowed'), { recursive: true });
  fs.writeFileSync(
    path.join(workspaceDir, 'allowed', 'spec.txt'),
    'Spec attachment content for Option Alpha',
    'utf8'
  );
  fs.writeFileSync(path.join(workspaceDir, 'allowed', '.env'), 'SECRET=1', 'utf8');

  corpusServer = await startCorpusHttpServer();
  engine = new KosworkBrowserEngine({
    allowedWorkspaceRoot: path.join(workspaceDir, 'allowed'),
    allowedDownloadDir: path.join(workspaceDir, 'allowed', 'downloads'),
    maxLiveTabs: 3,
    allowedSessionIds: ['sess-approved-1'],
    searchAdapterOptions: {
      searchEndpoint: corpusServer.searchEndpoint,
    },
  });
});

test.after(async () => {
  if (engine) await engine.shutdown();
  if (corpusServer) await corpusServer.close();
});

test('1. Real Chromium CDP engine renders V8 JS & Shadow DOM, manages tab lifecycle/history/hibernation, and enforces stale observation/ref guards', async () => {
  const dynamicUrl = `${corpusServer.baseOrigin}/site-5-dynamic-and-form`;
  const nav1 = await engine.navigate({
    tabId: 'tab-dynamic',
    url: dynamicUrl,
  });

  assert.equal(nav1.status, 'ok');
  assert.equal(nav1.title, 'Динамический портал телеметрии и конфигуратор');
  // Verify real Chromium V8 executed the inline script and Shadow DOM attachment
  assert.ok(
    nav1.snapshot.fullTextUtf16.includes(
      'По данным живой телеметрии Chromium V8 для Option Alpha задержка p95 < 12 мс'
    ),
    `Expected V8 rendered text in snapshot, got: ${nav1.snapshot.fullTextUtf16}`
  );
  assert.ok(
    nav1.snapshot.fullTextUtf16.includes('Верифицированный модуль Shadow DOM: шифрование AES-256-GCM активно.'),
    'Expected open Shadow DOM text to be pierced in real Chromium'
  );

  // Locate #mutate-price-btn control and its stable elementRef
  const mutateBtn = nav1.snapshot.controls.find((c) => c.id === 'mutate-price-btn');
  assert.ok(mutateBtn && mutateBtn.elementRef, 'Expected #mutate-price-btn with stable elementRef');

  // Trigger in-page DOM mutation via real Chromium evaluation / click
  await engine.cdpDriver.executeDomInteraction('tab-dynamic', {
    elementRef: mutateBtn.elementRef,
    expectedDomEpoch: nav1.snapshot.domEpoch,
    action: 'click',
  });

  // Attempting to fill form using the OLD pre-mutation observedSnapshot must fail with stale observation error
  await assert.rejects(
    async () => {
      await engine.fillForm({
        tabId: 'tab-dynamic',
        observedSnapshot: nav1.snapshot,
        fields: { 'org-input': 'Koswork Labs' },
      });
    },
    (err) => {
      assert.ok(
        err.code === 'OBSERVATION_STALE_REOBSERVE_REQUIRED' ||
          err.code === 'OBSERVATION_TEXT_SUBSTITUTED_SINCE_READ',
        `Unexpected error code: ${err.code}`
      );
      return true;
    }
  );

  // Re-observing captures fresh DOM state with updated domEpoch and pageVersion
  const freshObs = await engine.observePage('tab-dynamic', { reuseSnapshot: false });
  assert.ok(freshObs.snapshot.pageVersion > nav1.snapshot.pageVersion);
  assert.ok(
    freshObs.snapshot.fullTextUtf16.includes('ПОДМЕНА ТЕКСТА ПОСЛЕ НАБЛЮДЕНИЯ'),
    'Fresh observation must reflect mutated DOM text'
  );

  // Using a non-existent / stale elementRef on the fresh observation must reject with STALE_ELEMENT_REFERENCE
  await assert.rejects(
    async () => {
      await engine.fillForm({
        tabId: 'tab-dynamic',
        observedSnapshot: freshObs.snapshot,
        fields: { 'ref-999999': 'Invalid Ref' },
      });
    },
    (err) => {
      assert.equal(err.code, 'STALE_ELEMENT_REFERENCE');
      return true;
    }
  );

  // Navigation history: navigate to a second page, then goBack and goForward
  const nav2 = await engine.navigate({
    tabId: 'tab-dynamic',
    url: `${corpusServer.baseOrigin}/site-1-alpha-2026`,
  });
  assert.ok(nav2.title.includes('Option Alpha (2026)'));

  const backNav = await engine.goBack('tab-dynamic');
  assert.equal(backNav.title, 'Динамический портал телеметрии и конфигуратор');

  const forwardNav = await engine.goForward('tab-dynamic');
  assert.ok(forwardNav.title.includes('Option Alpha (2026)'));
});

test('2. Real Chromium in-page text search (findInPage), long-page scrolled reading (>18,000 chars), and cross-origin frame isolation', async () => {
  const longUrl = `${corpusServer.baseOrigin}/site-4-long-article`;
  const navLong = await engine.navigate({
    tabId: 'tab-long',
    url: longUrl,
  });

  assert.ok(
    navLong.snapshot.totalLengthUtf16 > 18000,
    `Expected >18,000 UTF-16 chars, got ${navLong.snapshot.totalLengthUtf16}`
  );
  assert.ok(
    navLong.snapshot.readingLimitations.crossOriginFramesSkippedCount >= 1,
    'Expected cross-origin iframe to be isolated and counted in readingLimitations'
  );

  // In-page text search for deep section text (>18,000 chars deep)
  const matches = engine.findInPage('tab-long', 'гарантированный SLA 99.90%');
  assert.ok(matches.totalMatches >= 1, 'Expected findInPage to find deep text');
  assert.ok(matches.matches[0].startUtf16 > 15000, 'Match should be deep inside the >18k document');

  // Read long page across scrolled windows in real Chromium
  let cursor = 0;
  let windowsRead = 0;
  let foundDeepTextInWindow = false;
  while (cursor < navLong.snapshot.totalLengthUtf16) {
    const win = await engine.readLongPage({
      tabId: 'tab-long',
      cursorUtf16: cursor,
      windowChars: 5000,
      overlapChars: 200,
      scrollInChromium: true,
    });
    windowsRead += 1;
    if (win.chunkText.includes('подтверждённая цена составляет $65/мес')) {
      foundDeepTextInWindow = true;
    }
    if (!win.hasMore) break;
    cursor = win.nextCursorUtf16;
  }
  assert.ok(windowsRead >= 4, `Expected >=4 scrolled windows for >18k page, got ${windowsRead}`);
  assert.equal(foundDeepTextInWindow, true, 'Expected scrolled reading to reach deep section');
});

test('3. Real Chromium forms, safe file attachment vs blocked .env, cancellation (AbortSignal), and session/CAPTCHA/payment gates', async () => {
  const navForm = await engine.navigate({
    tabId: 'tab-form',
    url: `${corpusServer.baseOrigin}/site-5-dynamic-and-form`,
  });

  const fillRes = await engine.fillForm({
    tabId: 'tab-form',
    observedSnapshot: navForm.snapshot,
    fields: {
      'org-input': 'Koswork Enterprise',
      'tier-select': 'enterprise',
    },
  });
  assert.equal(fillRes.status, 'ok');

  // Safe file attachment inside allowedWorkspaceRoot succeeds
  const fileRes = engine.selectFiles({
    tabId: 'tab-form',
    controlId: 'spec-file',
    filePaths: [path.join(workspaceDir, 'allowed', 'spec.txt')],
    observedSnapshot: fillRes.snapshot,
  });
  assert.equal(fileRes.status, 'ok');
  assert.equal(fileRes.attachedFiles.length, 1);

  // Sensitive .env attachment is blocked by policy
  assert.throws(
    () =>
      engine.selectFiles({
        tabId: 'tab-form',
        controlId: 'spec-file',
        filePaths: [path.join(workspaceDir, 'allowed', '.env')],
        observedSnapshot: fillRes.snapshot,
      }),
    (err) => err.code === 'BROWSER_FORBIDDEN_ATTACHMENT'
  );

  // Submit form in real Chromium and verify DOM status update
  const submitRes = await engine.submitForm({
    tabId: 'tab-form',
    submitControlId: 'submit-btn',
    observedSnapshot: fillRes.snapshot,
  });
  assert.equal(submitRes.status, 'ok');
  assert.ok(
    submitRes.snapshot.fullTextUtf16.includes('Заявка принята: Koswork Enterprise (enterprise)'),
    `Expected submitted form status in Chromium DOM, got: ${submitRes.snapshot.fullTextUtf16}`
  );

  // Unauthorized site session is rejected; authorized session is permitted
  await assert.rejects(
    async () => {
      await engine.navigate({
        tabId: 'tab-unauth',
        url: `${corpusServer.baseOrigin}/site-1-alpha-2026`,
        requiresAuthenticatedSession: true,
        sessionId: 'sess-unapproved-999',
      });
    },
    (err) => err.code === 'BROWSER_UNAUTHORIZED_SITE_SESSION'
  );

  const authNav = await engine.navigate({
    tabId: 'tab-auth-ok',
    url: `${corpusServer.baseOrigin}/site-1-alpha-2026`,
    requiresAuthenticatedSession: true,
    sessionId: 'sess-approved-1',
  });
  assert.equal(authNav.status, 'ok');

  // CAPTCHA and payment gates return paused_for_user and are never bypassed
  const captchaNav = await engine.navigate({
    tabId: 'tab-captcha',
    url: `${corpusServer.baseOrigin}/site-6-captcha-gate`,
  });
  assert.equal(captchaNav.status, 'paused_for_user');

  const paymentNav = await engine.navigate({
    tabId: 'tab-payment',
    url: `${corpusServer.baseOrigin}/site-7-payment-gate`,
  });
  assert.equal(paymentNav.status, 'paused_for_user');

  // Navigation cancellation via AbortController stops slow target promptly
  const abortController = new AbortController();
  setTimeout(() => abortController.abort(), 120);
  await assert.rejects(
    async () => {
      await engine.navigate({
        tabId: 'tab-cancel',
        url: `${corpusServer.baseOrigin}/slow-cancel-target`,
        signal: abortController.signal,
      });
    },
    (err) => err.code === 'BROWSER_NAVIGATION_CANCELLED'
  );
});

test('4. Search pagination, URL/content deduplication, explicit 503 source unavailability, and NO silent fallback on provider error', async () => {
  // Provider HTTP 500 error must fail explicitly with SEARCH_PROVIDER_UNAVAILABLE (no fake results or silent redirect)
  await assert.rejects(
    async () => {
      await engine.searchService.search({
        query: 'trigger_provider_500 Option Alpha',
        page: 1,
      });
    },
    (err) => err.code === 'SEARCH_PROVIDER_UNAVAILABLE'
  );

  // Page 1 search deduplicates tracking-param duplicate URL (`?utm_source=ads`)
  const serp1 = await engine.searchService.search({
    query: 'Option Alpha Option Beta спецификация',
    page: 1,
    pageSize: 5,
  });
  assert.ok(serp1.duplicatesRemovedCount >= 1, 'Expected duplicate tracking URL to be removed on SERP 1');
  assert.equal(serp1.items.length, 3);

  // Open HTTP 503 result -> explicitly recorded as unavailable
  const unavVisit = await engine.searchService.openSearchResult({
    searchId: serp1.searchId,
    url: `${corpusServer.baseOrigin}/site-3-unavailable-503`,
  });
  assert.equal(unavVisit.available, false);
  assert.equal(unavVisit.httpStatus, 503);
  assert.ok(
    engine.searchService.unavailableSources.some((u) => u.httpStatus === 503),
    'Expected HTTP 503 source in unavailableSources'
  );

  // Content deduplication across mirror URLs
  const visitPrimary = await engine.searchService.openSearchResult({
    searchId: serp1.searchId,
    url: `${corpusServer.baseOrigin}/site-1-alpha-2026`,
  });
  assert.equal(visitPrimary.available, true);
  assert.equal(visitPrimary.duplicateContentOfUrl, null);

  const visitMirror = await engine.searchService.openSearchResult({
    searchId: serp1.searchId,
    url: `${corpusServer.baseOrigin}/site-1-mirror-dup`,
  });
  assert.equal(
    visitMirror.duplicateContentOfUrl,
    `${corpusServer.baseOrigin}/site-1-alpha-2026`,
    'Expected mirror URL with identical content fingerprint to be flagged as duplicateContentOfUrl'
  );
});

test('5. Evidence verifier rejects quote+hash when quote does not entail claimed value or contains negation/deprecation', async () => {
  const navAlpha = await engine.navigate({
    tabId: 'tab-ev-alpha',
    url: `${corpusServer.baseOrigin}/site-1-alpha-2026`,
  });
  const priceExcerpt = engine.extractExcerpt('tab-ev-alpha', {
    searchTerm: 'базовая цена составляет $49/мес',
  });

  // 1) Valid verbatim quote that entails the claimed value ($49/мес) succeeds
  const validCheck = verifyEvidenceAgainstSnapshotAndClaim({
    snapshot: navAlpha.snapshot,
    excerpt: priceExcerpt,
    optionName: 'Option Alpha',
    criterion: 'Цена',
    claimedValue: '$49/мес',
  });
  assert.equal(validCheck.verified, true);
  assert.equal(validCheck.code, 'EVIDENCE_CORRESPONDS_TO_SOURCE');

  // 2) Non-empty verbatim quote + valid SHA-256 hash that does NOT support $999/мес MUST fail
  const mismatchCheck = verifyEvidenceAgainstSnapshotAndClaim({
    snapshot: navAlpha.snapshot,
    excerpt: priceExcerpt,
    optionName: 'Option Alpha',
    criterion: 'Цена',
    claimedValue: '$999/мес',
  });
  assert.equal(mismatchCheck.verified, false);
  assert.equal(mismatchCheck.code, 'CLAIM_VALUE_NOT_SUPPORTED_BY_QUOTE');

  // 3) Quote containing negation ("не поддерживает автономный воздушный контур") MUST fail when used to prove positive support
  const nav2025 = await engine.navigate({
    tabId: 'tab-ev-2025',
    url: `${corpusServer.baseOrigin}/site-2-alpha-2025-contradiction`,
  });
  const negExcerpt = engine.extractExcerpt('tab-ev-2025', {
    searchTerm: 'не поддерживает автономный воздушный контур',
  });
  const negCheck = verifyEvidenceAgainstSnapshotAndClaim({
    snapshot: nav2025.snapshot,
    excerpt: negExcerpt,
    optionName: 'Option Alpha',
    criterion: 'Air-gapped режим',
    claimedValue: 'поддерживает автономный воздушный контур',
  });
  assert.equal(negCheck.verified, false);
  assert.equal(negCheck.code, 'CLAIM_NEGATED_OR_DEPRECATED_IN_SOURCE');
});

test('6. Full Deep Research cycle: sub-question decomposition, bounded queries, contradictions, honest "не удалось установить", checkpoint/resume, project handoff & real Office/Workspace artifacts', async () => {
  const question = 'Сравнение платформ Option Alpha и Option Beta (2026)';
  const options = ['Option Alpha', 'Option Beta'];
  const criteria = ['Цена', 'SLA', 'Задержка p95', 'Закрытый квантовый модуль'];

  const subQuestions = decomposeResearchGoalIntoQuestions({ question, options, criteria });
  assert.equal(subQuestions.length, 3);

  const extractionRules = [
    {
      optionName: 'Option Alpha',
      criterion: 'Цена',
      searchPhrase: 'базовая цена составляет $49/мес',
      value: '$49/мес',
    },
    {
      optionName: 'Option Alpha',
      criterion: 'Цена',
      searchPhrase: 'базовая цена составляет $79/мес',
      value: '$79/мес',
    },
    {
      optionName: 'Option Alpha',
      criterion: 'SLA',
      searchPhrase: 'SLA 99.95%',
      value: '99.95%',
    },
    {
      optionName: 'Option Alpha',
      criterion: 'Задержка p95',
      searchPhrase: 'задержка p95 < 12 мс',
      value: '12 мс',
    },
    {
      optionName: 'Option Beta',
      criterion: 'Цена',
      searchPhrase: 'подтверждённая цена составляет $65/мес',
      value: '$65/мес',
    },
    {
      optionName: 'Option Beta',
      criterion: 'SLA',
      searchPhrase: 'гарантированный SLA 99.90%',
      value: '99.90%',
    },
    {
      optionName: 'Option Beta',
      criterion: 'Задержка p95',
      searchPhrase: 'p95 < 18 мс',
      value: '18 мс',
    },
  ];

  const checkpointPath = path.join(workspaceDir, 'checkpoint-05-gemini.json');

  // Pre-seed a mid-run checkpoint (where a prior query was already executed) to verify continuation
  fs.writeFileSync(
    checkpointPath,
    JSON.stringify(
      {
        question,
        subQuestions,
        executedQueries: ['initial_seed_query::p1'],
        openedUrls: [],
        extractedFacts: [],
        unavailableSources: [],
        completedSerpPages: 0,
        status: 'cancelled',
      },
      null,
      2
    ),
    'utf8'
  );

  // Run full workflow with resumeFromCheckpoint + onProjectArtifactReady hook
  let projectHandoffCalled = false;
  const workflowEngine = new KosworkBrowserEngine({
    allowedWorkspaceRoot: path.join(workspaceDir, 'allowed'),
    allowedDownloadDir: path.join(workspaceDir, 'allowed', 'downloads'),
    maxLiveTabs: 3,
    searchAdapterOptions: {
      searchEndpoint: corpusServer.searchEndpoint,
    },
  });

  try {
    const t0 = Date.now();
    const result = await executeMultiSiteResearchWorkflow({
      engine: workflowEngine,
      workspaceRoot: workspaceDir,
      question,
      options,
      criteria,
      extractionRules,
      maxQueriesPerQuestion: 2,
      maxTotalQueries: 5,
      maxSerpPages: 2,
      reportSlug: '05-gemini-deep-research',
      checkpointFilePath: checkpointPath,
      resumeFromCheckpoint: true,
      onProjectArtifactReady: async (payload) => {
        projectHandoffCalled = true;
        return { handedOff: true, reportTitle: payload.question };
      },
    });
    const elapsedMs = Date.now() - t0;

    assert.equal(result.status, 'completed');
    assert.equal(projectHandoffCalled, true);
    assert.equal(result.projectHandoffReceipt.handedOff, true);

    // Verify query budget respected (compared to unbudgeted baseline of 2 options * 4 criteria = 8+ queries)
    const baselineQueries = options.length * criteria.length; // 8 queries
    assert.ok(
      result.report.queryBudgetStats.queriesUsed <= 5 &&
        result.report.queryBudgetStats.queriesUsed < baselineQueries,
      `Expected queriesUsed (${result.report.queryBudgetStats.queriesUsed}) < baseline (${baselineQueries})`
    );

    // Verify 2026 ($49/мес) vs 2025 ($79/мес) discrepancy is detected and 2026 wins
    const alphaRow = result.report.comparisonRows.find((r) => r.optionName === 'Option Alpha');
    assert.equal(alphaRow.cells['Цена'].displayValue, '$49/мес');
    assert.ok(
      result.report.outdatedSources.length >= 1 && result.report.contradictions.length >= 1,
      'Expected 2025 vs 2026 price discrepancy to be explicitly recorded in both contradictions and outdatedSources'
    );

    // Verify unconfirmed criterion ("Закрытый квантовый модуль") is honestly marked "не удалось установить"
    assert.equal(alphaRow.cells['Закрытый квантовый модуль'].displayValue, 'не удалось установить');
    assert.ok(result.report.unestablishedItems.length >= 2);

    // Verify real artifacts (.md, .html, .json, .docx, .xlsx) exist on disk
    assert.ok(fs.existsSync(path.join(workspaceDir, 'reports', '05-gemini-deep-research.md')));
    assert.ok(fs.existsSync(path.join(workspaceDir, 'reports', '05-gemini-deep-research.html')));
    assert.ok(fs.existsSync(path.join(workspaceDir, 'reports', '05-gemini-deep-research.json')));
    assert.ok(fs.existsSync(result.savedArtifacts.docxArtifact.absolutePath));
    assert.ok(fs.existsSync(result.savedArtifacts.xlsxArtifact.absolutePath));
    assert.ok(elapsedMs < 15000);
  } finally {
    await workflowEngine.shutdown();
  }
});
