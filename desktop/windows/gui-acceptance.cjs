"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { writeAtomicJson } = require("./desktop-state.cjs");
const { safeWorkspaceRoute } = require("./desktop-recovery.cjs");

const GUI_ACCEPTANCE_FLAG = "--cosmora-gui-acceptance";
const LOOPBACK_ORIGIN = /^http:\/\/127\.0\.0\.1:\d{2,5}$/;
const FILE_PATTERN = /^cosmora-gui-acceptance-[a-z0-9._-]+\.json$/i;

function isGuiAcceptanceMode(argv = process.argv) {
  return Array.isArray(argv) && argv.includes(GUI_ACCEPTANCE_FLAG);
}

function assertGuiAcceptanceEnvironment({
  isPackaged,
  platform = process.platform,
  environment = process.env
}) {
  if (!isPackaged) throw new Error("GUI acceptance mode requires a packaged Kosmora build.");
  if (
    platform !== "win32" ||
    environment.GITHUB_ACTIONS !== "true" ||
    environment.RUNNER_ENVIRONMENT !== "github-hosted" ||
    !environment.RUNNER_TEMP
  )
    throw new Error("GUI acceptance requires a disposable GitHub-hosted Windows runner.");
}

function resolveTempJsonPath(filePath, tempDir, label) {
  if (typeof filePath !== "string" || !filePath.trim()) {
    throw new Error(`${label} path is required.`);
  }
  if (typeof tempDir !== "string" || !tempDir.trim()) {
    throw new Error("A temporary directory is required for GUI acceptance.");
  }
  const resolvedRoot = path.resolve(tempDir);
  const resolvedTarget = path.resolve(filePath);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (
    !relative ||
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    path.dirname(relative) !== "."
  ) {
    throw new Error(`${label} must be a direct child of the OS temporary directory.`);
  }
  if (!FILE_PATTERN.test(path.basename(resolvedTarget))) {
    throw new Error(`${label} filename does not match the allowed pattern.`);
  }
  return resolvedTarget;
}

function readGuiAcceptanceConfig({
  isPackaged,
  configPath = process.env.COSMORA_GUI_ACCEPTANCE_CONFIG,
  outputPath = process.env.COSMORA_GUI_ACCEPTANCE_OUTPUT,
  tempDir,
  platform = process.platform,
  environment = process.env
}) {
  assertGuiAcceptanceEnvironment({ isPackaged, platform, environment });
  const resolvedConfig = resolveTempJsonPath(configPath, tempDir, "GUI acceptance config");
  const resolvedOutput = resolveTempJsonPath(outputPath, tempDir, "GUI acceptance output");
  if (resolvedConfig === resolvedOutput || fs.statSync(resolvedConfig).size > 64000)
    throw new Error("Invalid GUI acceptance config/output files.");
  const raw = JSON.parse(fs.readFileSync(resolvedConfig, "utf8"));
  if (!raw || typeof raw !== "object" || !LOOPBACK_ORIGIN.test(String(raw.origin || ""))) {
    throw new Error("GUI acceptance requires a loopback http://127.0.0.1:<port> fixture origin.");
  }
  if (raw.phase !== "first-launch" && raw.phase !== "relaunch-and-recovery") {
    throw new Error("Invalid GUI acceptance phase.");
  }
  if (
    typeof raw.workspaceRoute !== "string" ||
    safeWorkspaceRoute(raw.workspaceRoute) !== raw.workspaceRoute
  ) {
    throw new Error("Invalid GUI acceptance workspaceRoute.");
  }
  if (typeof raw.draftScope !== "string" || !raw.draftScope.trim()) {
    throw new Error("Invalid GUI acceptance draftScope.");
  }
  if (typeof raw.draftText !== "string" || !raw.draftText.trim()) {
    throw new Error("Invalid GUI acceptance draftText.");
  }
  const runnerRoot = path.resolve(environment.RUNNER_TEMP);
  const downloadDirectory =
    typeof raw.downloadDirectory === "string" ? path.resolve(raw.downloadDirectory) : "";
  const downloadRelative = path.relative(runnerRoot, downloadDirectory);
  if (
    !downloadDirectory ||
    !downloadRelative ||
    downloadRelative.startsWith("..") ||
    path.isAbsolute(downloadRelative)
  )
    throw new Error("GUI acceptance downloads must stay within RUNNER_TEMP.");
  return {
    phase: raw.phase,
    origin: raw.origin,
    workspaceRoute: raw.workspaceRoute,
    draftScope: raw.draftScope,
    draftText: raw.draftText,
    downloadDirectory,
    outputPath: resolvedOutput
  };
}

function writeGuiAcceptanceReport({ outputPath, tempDir, payload }) {
  const resolvedOutput = resolveTempJsonPath(outputPath, tempDir, "GUI acceptance output");
  writeAtomicJson(resolvedOutput, payload);
}

async function waitFor(
  predicate,
  { timeoutMs = 20000, intervalMs = 100, label = "condition" } = {}
) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(
    `Timed out waiting for ${label}${lastError instanceof Error ? `: ${lastError.message}` : ""}`
  );
}

async function runPackagedGuiAcceptance({
  app,
  getMainWindow,
  getDownloadWindow,
  preferences,
  downloadCenter,
  readSavedOrigin
}) {
  const tempDir = app.getPath("temp");
  const config = readGuiAcceptanceConfig({
    isPackaged: app.isPackaged,
    tempDir
  });
  const checkpoint = (stage) =>
    writeGuiAcceptanceReport({
      outputPath: config.outputPath,
      tempDir,
      payload: { schemaVersion: 1, phase: config.phase, ok: false, stage }
    });
  checkpoint("configuration-validated");

  if (config.downloadDirectory) {
    fs.mkdirSync(config.downloadDirectory, { recursive: true });
    preferences.update({
      downloadDirectory: config.downloadDirectory,
      askWhereToSave: false,
      restorePage: true
    });
  }

  if (config.phase === "first-launch") {
    const win = await waitFor(
      () => {
        const w = getMainWindow();
        return w &&
          !w.isDestroyed() &&
          !w.webContents.isLoading() &&
          w.webContents.getURL().endsWith("/connection.html")
          ? w
          : null;
      },
      { label: "initial connection.html load" }
    );

    const setupState = await win.webContents.executeJavaScript(
      `window.cosmoraDesktop.getConnectionState()`
    );
    if (setupState.mode !== "setup") {
      throw new Error(`Expected setup mode on first launch, got ${setupState.mode}`);
    }

    checkpoint("connection-page-ready");
    await win.webContents.executeJavaScript(
      `(() => {
        const input = document.querySelector("#origin");
        if (input) input.value = ${JSON.stringify(config.origin)};
        void window.cosmoraDesktop.connect({ origin: ${JSON.stringify(config.origin)} });
        return true;
      })()`
    );

    await waitFor(
      () =>
        !win.webContents.isLoading() &&
        win.webContents.getURL().startsWith(`${config.origin}/login`),
      { label: "redirect to /login page" }
    );
    checkpoint("connected-to-login");
    await waitFor(() => readSavedOrigin().origin === config.origin, {
      label: "persisted origin after connection"
    });

    const bridgeCheck = await win.webContents.executeJavaScript(
      `({
        hasConnectionBridge: typeof window.cosmoraDesktop !== "undefined",
        hasDraftBridge: typeof window.kosmoraDesktopDraft === "object"
      })`
    );
    if (bridgeCheck.hasConnectionBridge || !bridgeCheck.hasDraftBridge) {
      throw new Error(
        `Unexpected remote bridge exposure on /login: ${JSON.stringify(bridgeCheck)}`
      );
    }

    await win.webContents.executeJavaScript(
      `(() => {
        const form = document.querySelector("#login-form");
        if (!form) throw new Error("Missing #login-form");
        form.submit();
        return true;
      })()`
    );

    await waitFor(
      () =>
        !win.webContents.isLoading() &&
        win.webContents.getURL() === `${config.origin}${config.workspaceRoute}`,
      { label: "authenticated workspace route after login" }
    );

    await waitFor(() => preferences.get().lastPath === config.workspaceRoute, {
      label: "persisted workspace lastPath"
    });
    checkpoint("authenticated-workspace");

    const draftResult = await win.webContents.executeJavaScript(
      `(async () => {
        const initial = await window.kosmoraDesktopDraft.load(${JSON.stringify(config.draftScope)});
        if (!initial.ok || initial.text !== "") {
          throw new Error("Expected empty initial draft: " + JSON.stringify(initial));
        }
        const saved = await window.kosmoraDesktopDraft.save(
          ${JSON.stringify(config.draftScope)},
          ${JSON.stringify(config.draftText)}
        );
        if (!saved.ok) {
          throw new Error("Failed to save DPAPI draft: " + JSON.stringify(saved));
        }
        const loaded = await window.kosmoraDesktopDraft.load(${JSON.stringify(config.draftScope)});
        return loaded;
      })()`
    );
    if (!draftResult?.ok || draftResult.text !== config.draftText) {
      throw new Error(`Draft roundtrip in renderer failed: ${JSON.stringify(draftResult)}`);
    }
    checkpoint("encrypted-draft-roundtrip");

    await fetch(`${config.origin}/test-control/identity-redirect?enabled=true`, { method: "POST" });
    const redirectedSave = await win.webContents.executeJavaScript(
      `window.kosmoraDesktopDraft.save(${JSON.stringify(config.draftScope)}, "MUST NOT OVERWRITE")`
    );
    if (redirectedSave?.ok)
      throw new Error("Identity redirect enabled a cached-owner draft write.");
    await fetch(`${config.origin}/test-control/identity-redirect?enabled=false`, {
      method: "POST"
    });
    const afterRedirect = await win.webContents.executeJavaScript(
      `window.kosmoraDesktopDraft.load(${JSON.stringify(config.draftScope)})`
    );
    if (!afterRedirect?.ok || afterRedirect.text !== config.draftText)
      throw new Error(
        "Identity redirect changed the protected draft or prevented fresh login verification."
      );
    checkpoint("native-identity-redirect-denied");

    const downloadDir = config.downloadDirectory || app.getPath("downloads");
    const firstFile = path.join(downloadDir, "report_final____.md");
    const secondFile = path.join(downloadDir, "report_final____ (1).md");

    win.webContents.downloadURL(
      `${config.origin}/files/result?name=${encodeURIComponent('report<final>:"?.md')}&seq=1`
    );
    await waitFor(
      () => fs.existsSync(firstFile) && fs.readFileSync(firstFile, "utf8") === "RESULT-1",
      {
        label: "first sanitized download"
      }
    );

    win.webContents.downloadURL(
      `${config.origin}/files/result?name=${encodeURIComponent('report<final>:"?.md')}&seq=2`
    );
    await waitFor(
      () => fs.existsSync(secondFile) && fs.readFileSync(secondFile, "utf8") === "RESULT-2",
      { label: "second non-overwriting duplicate download" }
    );
    if (fs.readFileSync(firstFile, "utf8") !== "RESULT-1") {
      throw new Error("Duplicate download overwrote the first file.");
    }
    checkpoint("two-downloads-completed");

    win.webContents.downloadURL(`${config.origin}/files/foreign-redirect`);
    await waitFor(
      async () => {
        const state = await (await fetch(`${config.origin}/test-control/state`)).json();
        return state.foreignRequests > 0;
      },
      { label: "controlled foreign-origin download response" }
    );

    if (!(await downloadCenter.show())) throw new Error("Download Center could not open.");
    const panel = await waitFor(
      () => {
        const candidate = getDownloadWindow();
        return candidate && !candidate.isDestroyed() && !candidate.webContents.isLoading()
          ? candidate
          : null;
      },
      { label: "Download Center window load" }
    );

    const panelList = await waitFor(
      async () => {
        const res = await panel.webContents.executeJavaScript(`window.kosmoraDownloads.list()`);
        return res?.ok &&
          Array.isArray(res.entries) &&
          res.entries.length === 2 &&
          res.entries.every((item) => item.status === "completed")
          ? res
          : null;
      },
      { label: "completed items in Download Center" }
    );

    for (const item of panelList.entries) {
      if ("savePath" in item || "scope" in item) {
        throw new Error("Download Center leaked savePath or scope to renderer.");
      }
    }
    if (fs.existsSync(path.join(downloadDir, "evil.txt")))
      throw new Error("Foreign-origin attachment was saved.");
    panel.close();

    writeGuiAcceptanceReport({
      outputPath: config.outputPath,
      tempDir,
      payload: {
        schemaVersion: 1,
        phase: "first-launch",
        ok: true,
        savedOrigin: readSavedOrigin().origin,
        lastPath: preferences.get().lastPath,
        draftSaved: true,
        nativeIdentityRedirectDenied: true,
        downloadsCount: panelList.entries.length,
        foreignRedirectBlocked: true,
        downloadedFiles: [path.basename(firstFile), path.basename(secondFile)]
      }
    });
    app.quit();
    return;
  }

  // Phase: "relaunch-and-recovery"
  const win = await waitFor(
    () => {
      const w = getMainWindow();
      return w &&
        !w.isDestroyed() &&
        !w.webContents.isLoading() &&
        w.webContents.getURL() === `${config.origin}${config.workspaceRoute}`
        ? w
        : null;
    },
    { label: "automatic session & route restore on relaunch" }
  );

  const restoredDraft = await win.webContents.executeJavaScript(
    `window.kosmoraDesktopDraft.load(${JSON.stringify(config.draftScope)})`
  );
  checkpoint("relaunch-workspace-ready");
  if (!restoredDraft?.ok || restoredDraft.text !== config.draftText) {
    throw new Error(`Expected Owner A draft across restart, got: ${JSON.stringify(restoredDraft)}`);
  }

  // Trigger second-instance deep link from fixture control endpoint
  await fetch(`${config.origin}/test-control/spawn-second-instance`, { method: "POST" });
  await waitFor(
    () => !win.webContents.isLoading() && win.webContents.getURL() === `${config.origin}/github`,
    { label: "second-instance deep link navigation to /github" }
  );
  await waitFor(() => preferences.get().lastPath === "/github", {
    label: "persisted /github route from deep link"
  });
  checkpoint("second-instance-deep-link");

  // Switch fixture server to offline mode and verify recovery screen preserves origin & route
  await fetch(`${config.origin}/test-control/mode?state=offline`, { method: "POST" });
  await win.loadURL(`${config.origin}/github`).catch(() => {});

  await waitFor(
    () => !win.webContents.isLoading() && win.webContents.getURL().endsWith("/connection.html"),
    { label: "offline recovery screen after server drop" }
  );

  const offlineCheck = await win.webContents.executeJavaScript(
    `(async () => {
      const state = await window.cosmoraDesktop.getConnectionState();
      const badConnect = await window.cosmoraDesktop.connect({ origin: "http://127.0.0.1:1" });
      const afterBad = await window.cosmoraDesktop.getConnectionState();
      return { state, badConnect, afterBad };
    })()`
  );
  if (
    offlineCheck.state.mode !== "offline" ||
    offlineCheck.badConnect.ok !== false ||
    offlineCheck.afterBad.origin !== config.origin ||
    readSavedOrigin().origin !== config.origin
  ) {
    throw new Error(
      `Offline recovery failed to preserve working origin: ${JSON.stringify(offlineCheck)}`
    );
  }

  // Restore server online and retry from connection screen
  await fetch(`${config.origin}/test-control/mode?state=online`, { method: "POST" });
  checkpoint("offline-origin-preserved");
  await win.webContents.executeJavaScript(`void window.cosmoraDesktop.retry(); true`);

  await waitFor(
    () => !win.webContents.isLoading() && win.webContents.getURL() === `${config.origin}/github`,
    { label: "restored /github route after offline retry" }
  );
  checkpoint("offline-recovery-completed");

  // Switch active owner on server to Owner B and verify Owner A's draft is isolated
  await fetch(`${config.origin}/test-control/owner?id=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`, {
    method: "POST"
  });
  await win.loadURL(`${config.origin}/github`);
  await waitFor(() => !win.webContents.isLoading(), { label: "Owner B reload" });

  let ownerBDraft = await win.webContents.executeJavaScript(
    `window.kosmoraDesktopDraft.load(${JSON.stringify(config.draftScope)})`
  );
  // A newly observed owner invalidates the previous document binding. A refused
  // first load is correct; a second explicit load binds the newly verified owner.
  if (!ownerBDraft?.ok)
    ownerBDraft = await win.webContents.executeJavaScript(
      `window.kosmoraDesktopDraft.load(${JSON.stringify(config.draftScope)})`
    );
  if (!ownerBDraft?.ok || ownerBDraft.text !== "") {
    throw new Error(`Owner B must not read Owner A draft: ${JSON.stringify(ownerBDraft)}`);
  }

  // Switch back to Owner A and perform explicit hosted /logout
  await fetch(`${config.origin}/test-control/owner?id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`, {
    method: "POST"
  });
  await win.loadURL(`${config.origin}/logout`);
  await waitFor(
    () =>
      !win.webContents.isLoading() && win.webContents.getURL().startsWith(`${config.origin}/login`),
    { label: "redirect to /login after explicit /logout" }
  );

  if (preferences.get().lastPath !== "/") {
    throw new Error(
      `Expected lastPath reset to "/" after logout, got ${preferences.get().lastPath}`
    );
  }
  const draftsDir = path.join(app.getPath("userData"), "desktop-text-drafts-v1");
  const remainingDraftFiles = fs.existsSync(draftsDir)
    ? fs.readdirSync(draftsDir).filter((name) => name.endsWith(".json"))
    : [];
  if (remainingDraftFiles.length !== 0) {
    throw new Error(
      `Expected all draft files cleared on logout, found ${remainingDraftFiles.length}`
    );
  }

  writeGuiAcceptanceReport({
    outputPath: config.outputPath,
    tempDir,
    payload: {
      schemaVersion: 1,
      phase: "relaunch-and-recovery",
      ok: true,
      restoredRouteOnRelaunch: config.workspaceRoute,
      restoredDraftAcrossRestart: true,
      secondInstanceDeepLinkRoute: "/github",
      offlineRecoveryPreservedOrigin: config.origin,
      offlineRecoveryRestoredRoute: "/github",
      ownerBIsolationVerified: true,
      logoutClearedDraftsAndRoute: true
    }
  });
  app.quit();
}

module.exports = {
  GUI_ACCEPTANCE_FLAG,
  isGuiAcceptanceMode,
  assertGuiAcceptanceEnvironment,
  readGuiAcceptanceConfig,
  writeGuiAcceptanceReport,
  runPackagedGuiAcceptance
};
