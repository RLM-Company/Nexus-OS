"use strict";
// Development/CI only: fresh headless Chromium, loopback fixture, temporary files.
// This adapter exercises our actual CDP engine without opening the owner's desktop.
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  http = require("node:http"),
  { EventEmitter } = require("node:events"),
  { pathToFileURL } = require("node:url");
const { chromium } = require(
  path.resolve(__dirname, "../../../apps/web/node_modules/@playwright/test")
);
const { createBrowserEngine } = require("../browser/engine.cjs"),
  { ComputerSession } = require("../computer-session.cjs");
async function run() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "koswork-browser-dom-"));
  const browser = await chromium.launch({ headless: true });
  let engine,
    received = "";
  const server = http.createServer((request, response) => {
    response.setHeader("content-type", "text/html; charset=utf-8");
    if (request.url === "/send") {
      let body = "";
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        received = new URLSearchParams(body).get("query") || "";
        response.end("<h1>RESULT RECEIVED</h1><p>Local fixture completed.</p>");
      });
      return;
    }
    response.end(
      '<!doctype html><html><head><title>Koswork local fixture</title></head><body style="font:18px system-ui;padding:60px"><h1>Local browser task</h1><form method="post" action="/send"><label>Query <input name="query" id="query"></label><label>Password <input type="password" value="do-not-observe-this-password"></label><label>Attachment <input type="file" id="attachment"></label><button>Submit fixture</button></form></body></html>'
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = "http://127.0.0.1:" + server.address().port + "/";
  try {
    const context = await browser.newContext({ viewport: { width: 960, height: 740 } }),
      views = [];
    class View {
      constructor() {
        views.push(this);
        const web = (this.webContents = new EventEmitter());
        web.loading = false;
        web.destroyed = false;
        web.ready = (async () => {
          web.page = await context.newPage();
          web.cdp = await context.newCDPSession(web.page);
          web.page.on("framenavigated", (frame) => {
            if (frame === web.page.mainFrame()) web.emit("did-navigate", {}, frame.url());
          });
          web.page.on("load", () => web.emit("did-finish-load"));
        })();
        web.isDestroyed = () => web.destroyed;
        web.getURL = () => web.page?.url() || "about:blank";
        web.isLoading = () => web.loading;
        web.isCurrentlyAudible = () => false;
        web.setWindowOpenHandler = () => {};
        web.close = () => {
          web.destroyed = true;
          void web.page?.close();
        };
        web.loadURL = async (target) => {
          web.loading = true;
          try {
            await web.ready;
            await web.page.goto(target, { waitUntil: "domcontentloaded" });
          } finally {
            web.loading = false;
          }
        };
        web.debugger = {
          isAttached: () => true,
          attach() {},
          sendCommand: async (method, args) => {
            await web.ready;
            return web.cdp.send(method, args);
          }
        };
      }
      setBounds() {}
      setVisible() {}
    }
    const session = new EventEmitter();
    session.setPermissionRequestHandler = () => {};
    session.setPermissionCheckHandler = () => {};
    const window = {
      isDestroyed: () => false,
      getContentSize: () => [1280, 840],
      contentView: { addChildView() {}, removeChildView() {} }
    };
    const file = path.join(temporary, "fixture.txt");
    fs.writeFileSync(file, "Only a generated fixture file.");
    const workspace = {
      snapshot: () => ({ id: "a".repeat(24), name: "Fixture" }),
      uploadFile: () => file,
      cancel() {}
    };
    engine = createBrowserEngine({
      WebContentsView: View,
      window,
      browserSession: session,
      workspace,
      context: { owner: "fixture", origin: "https://example.test" },
      searchProvider: async (query) => ({
        query,
        items: [
          { title: "Koswork local fixture", url, snippet: "Generated local source — fixture only." }
        ]
      })
    });
    await engine.open();
    const trace = [];
    let stage = "open",
      sourceScreenshots = 0,
      providerCalls = 0;
    const runner = new ComputerSession({
      executionMode: "browser",
      driver: engine,
      identity: async () => ({ owner: "fixture", origin: "https://example.test" }),
      confirm: async () => true,
      notify() {},
      planner: {
        begin: async () => ({ id: "fixture-session" }),
        authorize: async () => ({ authorized: true, valid_for_ms: 10000 }),
        end: async () => {},
        next: async ({ observation, previousResult }) => {
          providerCalls++;
          if (observation.image_jpeg_base64) sourceScreenshots++;
          assert.ok(!observation.description.includes("do-not-observe-this-password"));
          const doc = JSON.parse(observation.description),
            previous = previousResult ? JSON.parse(previousResult) : {};
          let action;
          if (doc.text.includes("RESULT RECEIVED"))
            action = { kind: "done", summary: "Local browser form verified" };
          else if (stage === "open") {
            action = { kind: "browser_open", url };
            stage = "fill";
          } else {
            if (previous.input_verified) stage = "upload";
            if (previous.attached) stage = "submit";
            const node = doc.nodes.find((n) =>
              stage === "upload"
                ? n.upload
                : stage === "fill"
                  ? n.name === "Query"
                  : n.name === "Submit fixture"
            );
            action = !node
              ? { kind: "wait", milliseconds: 100 }
              : stage === "fill"
                ? { kind: "browser_fill", ref: node.ref, text: "Koswork Привет 🌙" }
                : stage === "upload"
                  ? { kind: "browser_upload", ref: node.ref, path: "fixture.txt" }
                  : { kind: "browser_click", ref: node.ref };
          }
          trace.push({
            stage,
            action: action.kind,
            previous,
            labels: doc.nodes.map((n) => ({ ref: n.ref, name: n.name, upload: n.upload })),
            url: doc.url
          });
          return { action, message: "Fixture only", requires_confirmation: false };
        }
      }
    });
    const result = await runner.run({
      project: "project",
      goal: "Complete the generated loopback form with its generated fixture attachment",
      maxSteps: 20
    });
    if (result.status !== "completed") process.stderr.write(JSON.stringify(trace) + "\n");
    assert.equal(result.status, "completed");
    assert.equal(received, "Koswork Привет 🌙");
    assert.equal(sourceScreenshots, 0);
    await engine.search("Koswork browser test");
    const searchObservation = await engine.observe(new AbortController().signal);
    const searchDocument = JSON.parse(searchObservation.description);
    assert.equal(searchDocument.search.query, "Koswork browser test");
    assert.equal(searchDocument.url, "about:blank");
    assert.equal(searchObservation.description.includes("file:///"), false);
    const searchLink = searchDocument.nodes.find((n) => n.role === "a" && n.href === url);
    assert.ok(searchLink, "first-party search exposes the actual source link to agents");
    const searchView = views.findLast((v) => !v.webContents.isDestroyed());
    assert.equal(
      await searchView.webContents.page.locator("#query").innerText(),
      "Koswork browser test"
    );
    if (process.env.KOSWORK_SEARCH_SCREENSHOT) {
      const target = path.resolve(process.env.KOSWORK_SEARCH_SCREENSHOT);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      await searchView.webContents.page.screenshot({ path: target });
    }
    await engine.execute(
      { kind: "browser_click", ref: searchLink.ref },
      searchObservation,
      new AbortController().signal
    );
    await searchView.webContents.page.waitForURL(url);
    assert.ok(
      (await searchView.webContents.page.locator("h1").innerText()).includes("Local browser task")
    );
    await engine.search("Earlier search");
    await engine.search("Later search");
    await searchView.webContents.page.goBack({ waitUntil: "load" });
    await searchView.webContents.page
      .locator("#query")
      .filter({ hasText: "Earlier search" })
      .waitFor();
    await searchView.webContents.page.goForward({ waitUntil: "load" });
    await searchView.webContents.page
      .locator("#query")
      .filter({ hasText: "Later search" })
      .waitFor();
    const preview = await browser.newPage({ viewport: { width: 1280, height: 840 } });
    await preview.addInitScript(() => {
      const state = {
        tabs: [
          {
            id: "a".repeat(12),
            title: "Новая вкладка",
            url: "about:blank",
            loaded: false,
            canGoBack: true
          }
        ],
        active: "a".repeat(12),
        liveTabs: 0,
        projects: [{ id: "project", title: "Личное пространство" }],
        downloads: [],
        folder: null,
        running: false
      };
      let send;
      window.kosworkBrowser = {
        onState: (fn) => {
          send = fn;
        },
        onEvent() {},
        command: async (action, input) => {
          (window.__commands ??= []).push({ action, input });
          if (action === "new") {
            state.tabs.push({
              id: String(state.tabs.length + 1)
                .repeat(12)
                .slice(0, 12),
              title: "Новая вкладка",
              url: "about:blank"
            });
            state.active = state.tabs.at(-1).id;
            send(state);
          }
          return action === "history" ? { items: [] } : state;
        }
      };
    });
    await preview.goto(pathToFileURL(path.join(__dirname, "../browser/browser.html")).href);
    await preview.locator("#project").selectOption("project");
    assert.equal(
      await preview.evaluate(() => {
        const ids = Array.from(document.querySelectorAll("[id]")).map((e) => e.id);
        return new Set(ids).size === ids.length;
      }),
      true
    );
    await preview.locator("#back").click();
    await preview.locator("#search").fill("Local preview only");
    await preview.locator("#search").press("Enter");
    await preview.locator("#folder").click();
    const commands = await preview.evaluate(() => window.__commands || []);
    assert.ok(commands.some((c) => c.action === "back"));
    assert.ok(commands.some((c) => c.action === "navigate" && c.input === "Local preview only"));
    assert.ok(commands.some((c) => c.action === "folder"));

    assert.equal(await preview.locator("body").evaluate((e) => e.scrollWidth > innerWidth), false);
    await preview.locator("[data-goal]").first().click();
    assert.ok((await preview.locator("#goal").inputValue()).includes("страницу"));
    await preview.locator("#search").fill("");
    if (process.env.KOSWORK_BROWSER_SCREENSHOT) {
      const target = path.resolve(process.env.KOSWORK_BROWSER_SCREENSHOT);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      await preview.screenshot({ path: target });
    }
    await preview.setViewportSize({ width: 1000, height: 640 });
    assert.equal(await preview.locator("body").evaluate((e) => e.scrollWidth > innerWidth), false);
    process.stdout.write(
      JSON.stringify({
        status: "passed",
        engine: "real headless Chromium CDP via fixture adapter",
        model: "fixture only, no paid calls",
        verified_form: received,
        first_party_search:
          "actual Chromium DOM rendered a generated source and opened its link; fixture search provider only",
        search_history: "actual Chromium back/forward restored two distinct cached queries",
        steps: result.steps,
        model_steps: providerCalls,
        page_screenshots: sourceScreenshots,
        ui_viewport: "1280x840",
        owner_desktop_input: false
      }) + "\n"
    );
  } finally {
    engine?.dispose();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    assert.ok(path.resolve(temporary).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
if (require.main === module)
  run().catch((error) => {
    process.stderr.write(error.stack + "\n");
    process.exitCode = 1;
  });
module.exports = { run };
