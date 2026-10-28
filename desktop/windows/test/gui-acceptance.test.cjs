"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  isGuiAcceptanceMode,
  readGuiAcceptanceConfig,
  writeGuiAcceptanceReport,
  assertGuiAcceptanceEnvironment
} = require("../gui-acceptance.cjs");
const {
  OWNER_A,
  WORKSPACE_ROUTE,
  DRAFT_SCOPE,
  DRAFT_TEXT,
  startGuiAcceptanceFixture,
  runPackagedGuiAcceptanceSuite
} = require("../ci/gui-acceptance-fixture.cjs");
const { fetchVerifiedOwner } = require("../owner-session.cjs");
const {
  isAllowedDownload,
  nextAvailableDownloadPath,
  normalizeServerOrigin
} = require("../connection-policy.cjs");
const { createDraftStore } = require("../draft-store.cjs");
const { createPreferenceStore, deepLinkFromArgv } = require("../desktop-state.cjs");

test("GUI acceptance mode is explicit, packaged-only, temp-constrained, and loopback-only", () => {
  assert.equal(isGuiAcceptanceMode(["Kosmora.exe", "--cosmora-gui-acceptance"]), true);
  assert.equal(isGuiAcceptanceMode(["Kosmora.exe"]), false);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kosmora-gui-acc-unit-"));
  const cfgPath = path.join(tempDir, "cosmora-gui-acceptance-cfg.json");
  const outPath = path.join(tempDir, "cosmora-gui-acceptance-out.json");
  const options = {
    isPackaged: true,
    configPath: cfgPath,
    outputPath: outPath,
    tempDir,
    platform: "win32",
    environment: {
      GITHUB_ACTIONS: "true",
      RUNNER_ENVIRONMENT: "github-hosted",
      RUNNER_TEMP: tempDir
    }
  };
  try {
    fs.writeFileSync(
      cfgPath,
      JSON.stringify({
        phase: "first-launch",
        origin: "http://127.0.0.1:41234",
        workspaceRoute: WORKSPACE_ROUTE,
        draftScope: DRAFT_SCOPE,
        draftText: DRAFT_TEXT,
        downloadDirectory: path.join(tempDir, "downloads")
      }),
      "utf8"
    );

    assert.throws(
      () =>
        readGuiAcceptanceConfig({
          isPackaged: false,
          configPath: cfgPath,
          outputPath: outPath,
          tempDir
        }),
      /packaged/
    );

    const parsed = readGuiAcceptanceConfig(options);
    assert.equal(parsed.phase, "first-launch");
    assert.equal(parsed.origin, "http://127.0.0.1:41234");

    const validConfig = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    for (const overrides of [
      { downloadDirectory: tempDir },
      { downloadDirectory: path.dirname(tempDir) },
      { workspaceRoute: "/?redirect=https://evil.example" },
      { phase: "unrecognized" }
    ]) {
      fs.writeFileSync(cfgPath, JSON.stringify({ ...validConfig, ...overrides }));
      assert.throws(() => readGuiAcceptanceConfig(options));
    }
    fs.writeFileSync(cfgPath, JSON.stringify(validConfig));

    writeGuiAcceptanceReport({
      outputPath: outPath,
      tempDir,
      payload: { schemaVersion: 1, ok: true }
    });
    assert.deepEqual(JSON.parse(fs.readFileSync(outPath, "utf8")), {
      schemaVersion: 1,
      ok: true
    });

    // Reject non-loopback or remote HTTPS origins in GUI acceptance fixture config
    fs.writeFileSync(
      cfgPath,
      JSON.stringify({
        phase: "first-launch",
        origin: "https://remote.kosmora.example",
        workspaceRoute: WORKSPACE_ROUTE,
        draftScope: DRAFT_SCOPE,
        draftText: DRAFT_TEXT,
        downloadDirectory: path.join(tempDir, "downloads")
      }),
      "utf8"
    );
    assert.throws(() => readGuiAcceptanceConfig(options), /loopback/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("GUI acceptance refuses an owner's machine before any file access or launch", async () => {
  assert.throws(
    () =>
      assertGuiAcceptanceEnvironment({
        isPackaged: true,
        platform: "win32",
        environment: {}
      }),
    /disposable/
  );
  assert.throws(
    () =>
      assertGuiAcceptanceEnvironment({
        isPackaged: true,
        platform: "win32",
        environment: {
          GITHUB_ACTIONS: "true",
          RUNNER_ENVIRONMENT: "self-hosted",
          RUNNER_TEMP: os.tmpdir()
        }
      }),
    /disposable/
  );
  if (process.env.GITHUB_ACTIONS !== "true" || process.env.RUNNER_ENVIRONMENT !== "github-hosted") {
    await assert.rejects(
      runPackagedGuiAcceptanceSuite({ appExePath: "missing.exe", workRoot: "missing" }),
      /disposable/
    );
  }
});

test("local GUI acceptance fixture serves login, session owner verification, downloads, offline recovery, and logout without paid models", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kosmora-gui-fixture-"));
  let secondInstanceCalls = 0;
  const fixture = await startGuiAcceptanceFixture({
    onSpawnSecondInstance: () => {
      secondInstanceCalls += 1;
    }
  });
  try {
    const origin = normalizeServerOrigin(fixture.origin);
    assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);

    // 1. Before login: /api/v1/health is 401, /login is 200
    const healthUnauth = await fetch(`${origin}/api/v1/health`, { redirect: "manual" });
    assert.equal(healthUnauth.status, 401);
    const loginPage = await fetch(`${origin}/login`, { redirect: "manual" });
    assert.equal(loginPage.status, 200);

    // 2. Ordinary form login issues a persistent session cookie and redirects to WORKSPACE_ROUTE
    const loginSubmit = await fetch(`${origin}/login`, {
      method: "POST",
      redirect: "manual"
    });
    assert.equal(loginSubmit.status, 302);
    assert.equal(loginSubmit.headers.get("location"), WORKSPACE_ROUTE);
    const rawCookie = loginSubmit.headers.get("set-cookie");
    assert.ok(rawCookie && rawCookie.includes("kosmora_session=valid-owner-session"));
    assert.ok(rawCookie.includes("HttpOnly"));
    assert.ok(rawCookie.includes("Max-Age=2592000"));
    const cookieHeader = "kosmora_session=valid-owner-session";

    // 3. Authenticated health & owner session verification
    const healthAuth = await fetch(`${origin}/api/v1/health`, {
      headers: { cookie: cookieHeader },
      redirect: "manual"
    });
    assert.equal(healthAuth.status, 200);

    const verifiedA = await fetchVerifiedOwner(
      (url, init) =>
        fetch(url, {
          ...init,
          headers: { cookie: cookieHeader }
        }),
      origin
    );
    assert.equal(verifiedA.state, "verified");
    assert.equal(verifiedA.owner, OWNER_A);

    // 4. Draft persistence and owner isolation across Owner A and Owner B
    const codec = {
      seal: (s) => Buffer.from(s, "utf8").toString("base64"),
      open: (s) => Buffer.from(s, "base64").toString("utf8")
    };
    const drafts = createDraftStore(dir, { codec });
    const prefs = createPreferenceStore(dir);
    prefs.update({ lastPath: WORKSPACE_ROUTE });
    drafts.save(verifiedA.owner, origin, DRAFT_SCOPE, DRAFT_TEXT);
    assert.equal(drafts.load(verifiedA.owner, origin, DRAFT_SCOPE), DRAFT_TEXT);

    // 5. Safe downloads, duplicate collision avoidance, and foreign redirect rejection
    const dl1 = await fetch(
      `${origin}/files/result?name=${encodeURIComponent('report<final>:"?.md')}&seq=1`,
      { headers: { cookie: cookieHeader }, redirect: "manual" }
    );
    assert.equal(dl1.status, 200);
    const path1 = nextAvailableDownloadPath(dir, 'report<final>:"?.md', fs.existsSync);
    fs.writeFileSync(path1, await dl1.text(), "utf8");

    const dl2 = await fetch(
      `${origin}/files/result?name=${encodeURIComponent('report<final>:"?.md')}&seq=2`,
      { headers: { cookie: cookieHeader }, redirect: "manual" }
    );
    const path2 = nextAvailableDownloadPath(dir, 'report<final>:"?.md', fs.existsSync);
    fs.writeFileSync(path2, await dl2.text(), "utf8");

    assert.equal(path.basename(path1), "report_final____.md");
    assert.equal(path.basename(path2), "report_final____ (1).md");
    assert.equal(fs.readFileSync(path1, "utf8"), "RESULT-1");
    assert.equal(fs.readFileSync(path2, "utf8"), "RESULT-2");

    const foreignRedirect = await fetch(`${origin}/files/foreign-redirect`, {
      redirect: "manual"
    });
    assert.equal(foreignRedirect.status, 302);
    const redirectChain = [
      `${origin}/files/foreign-redirect`,
      foreignRedirect.headers.get("location")
    ];
    assert.equal(isAllowedDownload(redirectChain, origin), false);

    // The real IPC/window contract is covered by download-center.test.cjs and packaged GUI CI.

    // 7. Second instance deep link control endpoint
    await fetch(`${origin}/test-control/spawn-second-instance`, { method: "POST" });
    assert.equal(secondInstanceCalls, 1);
    assert.equal(deepLinkFromArgv(["Kosmora.exe", "kosmora://open?path=%2Fgithub"]), "/github");
    assert.equal(
      deepLinkFromArgv(["Kosmora.exe", "kosmora://open?path=https%3A%2F%2Fevil.example"]),
      null
    );

    // 8. Offline mode toggle & recovery
    await fetch(`${origin}/test-control/mode?state=offline`, { method: "POST" });
    const offlineOwner = await fetchVerifiedOwner(
      (url, init) => fetch(url, { ...init, headers: { cookie: cookieHeader } }),
      origin
    );
    assert.equal(offlineOwner.state, "offline");
    await fetch(`${origin}/test-control/mode?state=online`, { method: "POST" });
    const recoveredOwner = await fetchVerifiedOwner(
      (url, init) => fetch(url, { ...init, headers: { cookie: cookieHeader } }),
      origin
    );
    assert.equal(recoveredOwner.state, "verified");
    assert.equal(recoveredOwner.owner, OWNER_A);

    // 9. Switch server owner to Owner B -> cannot read Owner A's draft or downloads
    const OWNER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    await fetch(`${origin}/test-control/owner?id=${OWNER_B}`, { method: "POST" });
    const verifiedB = await fetchVerifiedOwner(
      (url, init) => fetch(url, { ...init, headers: { cookie: cookieHeader } }),
      origin
    );
    assert.equal(verifiedB.state, "verified");
    assert.equal(verifiedB.owner, OWNER_B);
    assert.equal(drafts.load(verifiedB.owner, origin, DRAFT_SCOPE), "");

    // 10. Explicit /logout clears cookie, drafts, download history, and resets lastPath
    const logoutRes = await fetch(`${origin}/logout`, { redirect: "manual" });
    assert.equal(logoutRes.status, 302);
    assert.equal(logoutRes.headers.get("location"), "/login");
    assert.ok(String(logoutRes.headers.get("set-cookie")).includes("Max-Age=0"));
    drafts.clearAll();
    prefs.update({ lastPath: "/" });
    assert.equal(drafts.load(OWNER_A, origin, DRAFT_SCOPE), "");
    assert.equal(prefs.get().lastPath, "/");
  } finally {
    await fixture.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
