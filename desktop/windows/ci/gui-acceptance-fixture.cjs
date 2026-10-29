"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { assertGuiAcceptanceEnvironment } = require("../gui-acceptance.cjs");

const OWNER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKSPACE_ROUTE = "/?project=dddddddd-dddd-4ddd-8ddd-dddddddddddd&view=chat&surface=code";
const DRAFT_SCOPE = "chat:cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const DRAFT_TEXT = "Черновик владельца A после установки";

function hasValidSessionCookie(req) {
  const cookie = String(req.headers.cookie || "");
  return cookie.split(";").some((part) => part.trim() === "kosmora_session=valid-owner-session");
}

function renderWorkspaceHtml(title) {
  return `<!doctype html>
<html lang="ru">
  <head><meta charset="utf-8" /><title>${title}</title></head>
  <body>
    <main id="workspace-root" data-title="${title}">
      <h1>${title}</h1>
    </main>
  </body>
</html>`;
}

function startGuiAcceptanceFixture({ onSpawnSecondInstance = null } = {}) {
  let offline = false;
  let activeOwner = OWNER_A;
  let secondInstanceTriggered = false;
  let identityRedirect = false;
  let foreignRequests = 0;
  const browserReceipt = { submissions: 0, unicode: false, attachment: false };
  const foreignServer = http.createServer((_req, res) => {
    foreignRequests += 1;
    res.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-disposition": 'attachment; filename="evil.txt"'
    });
    res.end("MUST-NOT-BE-SAVED");
  });

  const server = http.createServer(async (req, res) => {
    const parsed = new URL(req.url || "/", "http://127.0.0.1");
    if (parsed.pathname === "/browser/page") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        '<!doctype html><html><meta charset="utf-8"><body style="font:18px system-ui;padding:30px"><h1>Native browser fixture</h1><form method="post" enctype="multipart/form-data" action="/browser/result"><label>Query <input name="query"></label><label>Attachment <input type="file" name="attachment"></label><button>Submit fixture</button></form></body></html>'
      );
      return;
    }
    if (parsed.pathname === "/browser/result" && req.method === "POST") {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 50000) {
          res.writeHead(413);
          res.end();
          return;
        }
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks).toString("utf8");
      browserReceipt.submissions++;
      browserReceipt.unicode = body.includes("Koswork Привет 🌙");
      browserReceipt.attachment = body.includes("Generated browser fixture attachment");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end('<h1>NATIVE FORM RECEIVED</h1><a href="/browser/download">Download fixture</a>');
      return;
    }
    if (parsed.pathname === "/browser/download") {
      const body = "NATIVE-DOWNLOAD-OK";
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-disposition": 'attachment; filename="result.txt"',
        "content-length": String(Buffer.byteLength(body))
      });
      res.end(body);
      return;
    }
    if (parsed.pathname === "/browser/receipt") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(browserReceipt));
      return;
    }

    if (parsed.pathname === "/test-control/state") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ foreignRequests }));
      return;
    }
    if (parsed.pathname === "/test-control/identity-redirect") {
      identityRedirect = parsed.searchParams.get("enabled") === "true";
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ identityRedirect }));
      return;
    }

    if (parsed.pathname === "/test-control/mode") {
      offline = parsed.searchParams.get("state") === "offline";
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, offline }));
      return;
    }

    if (parsed.pathname === "/test-control/owner") {
      activeOwner = parsed.searchParams.get("id") || OWNER_A;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, activeOwner }));
      return;
    }

    if (parsed.pathname === "/test-control/spawn-second-instance") {
      secondInstanceTriggered = true;
      if (typeof onSpawnSecondInstance === "function") {
        void Promise.resolve(onSpawnSecondInstance()).catch(() => {});
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (offline) {
      req.socket.destroy();
      return;
    }

    if (parsed.pathname === "/api/v1/health") {
      if (!hasValidSessionCookie(req)) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, status: "healthy" }));
      return;
    }

    if (parsed.pathname === "/api/v1/identity/sessions") {
      if (identityRedirect) {
        res.writeHead(302, { Location: "/login" });
        res.end();
        return;
      }
      if (!hasValidSessionCookie(req)) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ items: [] }));
        return;
      }
      const body = JSON.stringify({
        items: [
          {
            owner_id: activeOwner,
            current: true,
            status: "active",
            actor_kind: "owner",
            expires_at: "2035-01-01T00:00:00.000Z"
          }
        ]
      });
      res.writeHead(200, {
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(body))
      });
      res.end(body);
      return;
    }

    if (parsed.pathname === "/login" && req.method === "GET") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html>
<html lang="ru">
  <head><meta charset="utf-8" /><title>Вход в Kosmora</title></head>
  <body>
    <form id="login-form" method="POST" action="/login">
      <input type="password" name="password" value="fixture-owner" />
      <input type="checkbox" name="remember" checked />
      <button id="login-submit" type="submit">Войти</button>
    </form>
  </body>
</html>`);
      return;
    }

    if (parsed.pathname === "/login" && req.method === "POST") {
      res.writeHead(302, {
        "Set-Cookie":
          "kosmora_session=valid-owner-session; Path=/; HttpOnly; Max-Age=2592000; SameSite=Lax",
        Location: WORKSPACE_ROUTE
      });
      res.end();
      return;
    }

    if (parsed.pathname === "/logout") {
      res.writeHead(302, {
        "Set-Cookie": "kosmora_session=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax",
        Location: "/login"
      });
      res.end();
      return;
    }

    if (parsed.pathname === "/files/result") {
      if (!hasValidSessionCookie(req)) {
        res.writeHead(401);
        res.end("Unauthorized");
        return;
      }
      const rawName = parsed.searchParams.get("name") || "result.md";
      const seq = parsed.searchParams.get("seq") || "1";
      const payload = `RESULT-${seq}`;
      res.writeHead(200, {
        "content-type": "text/markdown; charset=utf-8",
        "content-length": String(Buffer.byteLength(payload)),
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(rawName)}`
      });
      res.end(payload);
      return;
    }

    if (parsed.pathname === "/files/foreign-redirect") {
      res.writeHead(302, {
        Location: `http://127.0.0.1:${foreignServer.address().port}/evil.txt`
      });
      res.end();
      return;
    }

    if (
      parsed.pathname === "/" ||
      parsed.pathname === "/github" ||
      parsed.pathname === "/github/preview" ||
      parsed.pathname === "/code-agent" ||
      parsed.pathname === "/control-center" ||
      parsed.pathname === "/agent-studio" ||
      parsed.pathname === "/model-status" ||
      parsed.pathname === "/skills"
    ) {
      if (!hasValidSessionCookie(req)) {
        res.writeHead(302, { Location: "/login" });
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(renderWorkspaceHtml(`Kosmora Workspace ${parsed.pathname}`));
      return;
    }

    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    foreignServer.once("error", reject);
    foreignServer.listen(0, "127.0.0.1", () =>
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        const origin = `http://127.0.0.1:${address.port}`;
        resolve({
          origin,
          port: address.port,
          getState: () => ({ offline, activeOwner, secondInstanceTriggered }),
          setOffline: (value) => {
            offline = Boolean(value);
          },
          setActiveOwner: (value) => {
            activeOwner = value;
          },
          close: () =>
            new Promise((done) => {
              server.close(() => foreignServer.close(() => done()));
            })
        });
      })
    );
  });
}

function runProcess(exePath, args, env, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    const child = spawn(exePath, args, {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(
        new Error(
          `Timed out waiting for ${path.basename(exePath)} (${args.join(" ")}): ${stderr.slice(-4000)} ${stdout.slice(-1000)}`
        )
      );
    }, timeoutMs);
    child.stdout?.on("data", (chunk) => {
      stdout = (stdout + chunk.toString("utf8")).slice(-64000);
    });
    child.stderr?.on("data", (chunk) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-64000);
    });
    child.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

async function runPackagedGuiAcceptanceSuite({ appExePath, workRoot }) {
  // Never launch an installed client or clear directories on the owner's laptop.
  assertGuiAcceptanceEnvironment({ isPackaged: true });
  const runnerRoot = fs.realpathSync(process.env.RUNNER_TEMP);
  const root = fs.realpathSync(workRoot);
  const rootRelative = path.relative(runnerRoot, root);
  if (!rootRelative || rootRelative.startsWith("..") || path.isAbsolute(rootRelative))
    throw new Error("GUI work root must be within RUNNER_TEMP.");
  const resolvedApp = path.resolve(appExePath);
  if (!fs.existsSync(resolvedApp)) {
    throw new Error(`Installed Kosmora executable was not found: ${resolvedApp}`);
  }
  const appRelative = path.relative(root, fs.realpathSync(resolvedApp));
  if (
    !appRelative ||
    appRelative.startsWith("..") ||
    path.isAbsolute(appRelative) ||
    path.basename(resolvedApp) !== "Kosmora.exe"
  )
    throw new Error("GUI executable must be the installed Kosmora inside the work root.");
  const downloadDirectory = path.join(root, "gui-downloads");
  // The work root is disposable, but never follow a pre-existing junction when deleting.
  if (fs.existsSync(downloadDirectory)) throw new Error("GUI download directory must be new.");
  fs.mkdirSync(downloadDirectory, { recursive: true });

  const tempDir = os.tmpdir();
  const runId = `${Date.now()}-${process.pid}`;
  const configPath = path.join(tempDir, `cosmora-gui-acceptance-config-${runId}.json`);
  const output1Path = path.join(tempDir, `cosmora-gui-acceptance-phase1-${runId}.json`);
  const output2Path = path.join(tempDir, `cosmora-gui-acceptance-phase2-${runId}.json`);

  const fixture = await startGuiAcceptanceFixture({
    onSpawnSecondInstance: async () => {
      // First send a hostile deep link that must be ignored, then a valid /github deep link
      await runProcess(resolvedApp, ["kosmora://open?path=https%3A%2F%2Fevil.example"], {}, 15000);
      await runProcess(resolvedApp, ["kosmora://open?path=%2Fgithub"], {}, 15000);
    }
  });

  try {
    // Phase 1: First launch -> connect -> login -> DPAPI draft save -> downloads & Download Center -> close
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        phase: "first-launch",
        origin: fixture.origin,
        workspaceRoute: WORKSPACE_ROUTE,
        draftScope: DRAFT_SCOPE,
        draftText: DRAFT_TEXT,
        downloadDirectory
      }),
      "utf8"
    );

    const phase1Proc = await runProcess(resolvedApp, ["--cosmora-gui-acceptance"], {
      COSMORA_GUI_ACCEPTANCE_CONFIG: configPath,
      COSMORA_GUI_ACCEPTANCE_OUTPUT: output1Path
    });
    if (phase1Proc.code !== 0) {
      throw new Error(
        `Packaged GUI acceptance phase 1 exited with code ${phase1Proc.code}: ${phase1Proc.stderr}`
      );
    }
    const phase1Report = JSON.parse(fs.readFileSync(output1Path, "utf8"));
    assert.equal(phase1Report.ok, true);
    assert.equal(phase1Report.savedOrigin, fixture.origin);
    assert.equal(phase1Report.lastPath, WORKSPACE_ROUTE);
    assert.equal(phase1Report.downloadsCount, 2);
    assert.equal(phase1Report.nativeIdentityRedirectDenied, true);
    assert.equal(phase1Report.foreignRedirectBlocked, true);
    assert.equal(phase1Report.nativeBrowser?.download, true);
    assert.equal(phase1Report.nativeBrowser?.exactlyOneSubmit, true);
    assert.deepEqual(phase1Report.downloadedFiles.sort(), [
      "report_final____ (1).md",
      "report_final____.md"
    ]);

    // Phase 2: Relaunch -> auto session/route restore -> DPAPI draft load -> second-instance deep link -> offline/retry -> Owner B isolation -> logout
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        phase: "relaunch-and-recovery",
        origin: fixture.origin,
        workspaceRoute: WORKSPACE_ROUTE,
        draftScope: DRAFT_SCOPE,
        draftText: DRAFT_TEXT,
        downloadDirectory
      }),
      "utf8"
    );

    const phase2Proc = await runProcess(resolvedApp, ["--cosmora-gui-acceptance"], {
      COSMORA_GUI_ACCEPTANCE_CONFIG: configPath,
      COSMORA_GUI_ACCEPTANCE_OUTPUT: output2Path
    });
    if (phase2Proc.code !== 0) {
      throw new Error(
        `Packaged GUI acceptance phase 2 exited with code ${phase2Proc.code}: ${phase2Proc.stderr}`
      );
    }
    const phase2Report = JSON.parse(fs.readFileSync(output2Path, "utf8"));
    assert.equal(phase2Report.ok, true);
    assert.equal(phase2Report.restoredRouteOnRelaunch, WORKSPACE_ROUTE);
    assert.equal(phase2Report.restoredDraftAcrossRestart, true);
    assert.equal(phase2Report.secondInstanceDeepLinkRoute, "/github");
    assert.equal(phase2Report.offlineRecoveryPreservedOrigin, fixture.origin);
    assert.equal(phase2Report.offlineRecoveryRestoredRoute, "/github");
    assert.equal(phase2Report.ownerBIsolationVerified, true);
    assert.equal(phase2Report.logoutClearedDraftsAndRoute, true);

    fs.writeFileSync(
      path.join(runnerRoot, "cosmora-gui-acceptance-report.json"),
      JSON.stringify({ phase1Report, phase2Report }, null, 2)
    );
    return { phase1Report, phase2Report };
  } catch (error) {
    const checkpoints = [output1Path, output2Path].map((filename) => {
      try {
        return JSON.parse(fs.readFileSync(filename, "utf8"));
      } catch {
        return null;
      }
    });
    const message = error instanceof Error ? error.message : String(error);
    fs.writeFileSync(
      path.join(runnerRoot, "cosmora-gui-acceptance-report.json"),
      JSON.stringify({ ok: false, message, checkpoints }, null, 2)
    );
    throw new Error(`${message}; GUI checkpoints: ${JSON.stringify(checkpoints)}`, {
      cause: error
    });
  } finally {
    await fixture.close();
    fs.rmSync(configPath, { force: true });
    fs.rmSync(output1Path, { force: true });
    fs.rmSync(output2Path, { force: true });
    const finalDownloadPath = fs.realpathSync(downloadDirectory);
    if (finalDownloadPath !== downloadDirectory || path.dirname(finalDownloadPath) !== root)
      throw new Error("Refusing to clean a redirected GUI download directory.");
    fs.rmSync(finalDownloadPath, { recursive: true, force: true });
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const appIndex = args.indexOf("--app");
  const workRootIndex = args.indexOf("--work-root");
  const appExePath = appIndex >= 0 ? args[appIndex + 1] : null;
  const workRoot = workRootIndex >= 0 ? args[workRootIndex + 1] : null;
  if (!appExePath || !workRoot) {
    console.error(
      "Usage: node ci/gui-acceptance-fixture.cjs --app <Kosmora.exe> --work-root <dir>"
    );
    process.exitCode = 2;
  } else {
    runPackagedGuiAcceptanceSuite({ appExePath, workRoot })
      .then((summary) => {
        process.stdout.write(
          `Packaged GUI acceptance OK: ${JSON.stringify(summary.phase2Report)}\n`
        );
      })
      .catch((error) => {
        console.error(error instanceof Error ? error.stack || error.message : error);
        process.exitCode = 1;
      });
  }
}

module.exports = {
  OWNER_A,
  WORKSPACE_ROUTE,
  DRAFT_SCOPE,
  DRAFT_TEXT,
  startGuiAcceptanceFixture,
  runPackagedGuiAcceptanceSuite
};
