"use strict";
// Only the existing packaged-GUI acceptance mode calls this on disposable CI.
// Real Electron transport/DOM/downloads; the planner and source data are fixtures.
async function runNativeBrowserAcceptance({ app, origin }) {
  require("../gui-acceptance.cjs").assertGuiAcceptanceEnvironment({ isPackaged: app.isPackaged });
  if (!/^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(origin))
    throw Error("Browser acceptance requires loopback fixture");
  const fs = require("node:fs"),
    path = require("node:path"),
    assert = require("node:assert/strict"),
    { randomUUID } = require("node:crypto");
  const { BrowserWindow, WebContentsView, session } = require("electron");
  const { createBrowserEngine } = require("./engine.cjs");
  const { ComputerSession } = require("../computer-session.cjs");
  const root = fs.realpathSync(process.env.RUNNER_TEMP);
  const folder = fs.mkdtempSync(path.join(root, "koswork-native-browser-"));
  const upload = path.join(folder, "fixture.txt"),
    download = path.join(folder, "result.txt");
  fs.writeFileSync(upload, "Generated browser fixture attachment");
  const context = { owner: "browser-ci-fixture", origin };
  const browserSession = session.fromPartition("koswork-native-ci-" + randomUUID(), {
    cache: false
  });
  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    show: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
  });
  let engine,
    stage = "setup";
  try {
    await window.loadFile(path.join(__dirname, "browser.html"));
    engine = createBrowserEngine({
      BrowserWindow,
      WebContentsView,
      window,
      browserSession,
      context,
      searchProvider: async (query) => ({
        query,
        items: [
          {
            title: "Native browser fixture",
            url: origin + "/browser/page",
            snippet: "Generated CI fixture, not a live search."
          }
        ]
      }),
      workspace: {
        snapshot: () => ({ id: "a".repeat(24), name: "Disposable CI folder" }),
        uploadFile: (_context, id, relative) => {
          assert.equal(id, "a".repeat(24));
          assert.equal(relative, "fixture.txt");
          return upload;
        },
        reserveDownload: (_context, id) => {
          assert.equal(id, "a".repeat(24));
          assert.equal(fs.existsSync(download), false);
          return { path: download, name: "result.txt" };
        },
        verifyDownload: (_context, id, actual, bytes) => {
          assert.equal(id, "a".repeat(24));
          assert.equal(actual, download);
          assert.equal(fs.statSync(actual).size, bytes);
        },
        cancel() {}
      }
    });
    await engine.open();
    stage = "search";
    const runner = new ComputerSession({
      executionMode: "browser",
      driver: engine,
      identity: async () => context,
      confirm: async () => true,
      notify() {},
      planner: {
        begin: async () => ({ id: "native-fixture" }),
        authorize: async () => ({ authorized: true, valid_for_ms: 10000 }),
        end: async () => {},
        next: async ({ observation, previousResult }) => {
          assert.equal(observation.image_jpeg_base64, undefined);
          const doc = JSON.parse(observation.description),
            previous = previousResult ? JSON.parse(previousResult) : {};
          let action;
          if (stage === "search") {
            stage = "link";
            action = { kind: "browser_search", query: "Native browser fixture" };
          } else if (stage === "link") {
            const link = doc.nodes.find(
              (n) => n.role === "a" && n.href === origin + "/browser/page"
            );
            if (link) {
              stage = "fill";
              action = { kind: "browser_click", ref: link.ref };
            }
          } else {
            if (previous.input_verified) stage = "upload";
            if (previous.attached) stage = "submit";
            if (doc.text.includes("NATIVE FORM RECEIVED")) stage = "download";
            if (stage === "download" && doc.downloads.some((d) => d.status === "completed"))
              action = { kind: "done", summary: "Native fixture completed" };
            else if (stage === "download" && doc.downloads.length)
              action = { kind: "wait", milliseconds: 100 };
            else {
              const node = doc.nodes.find((n) =>
                stage === "fill"
                  ? n.name === "Query"
                  : stage === "upload"
                    ? n.upload
                    : stage === "submit"
                      ? n.name === "Submit fixture"
                      : n.name === "Download fixture"
              );
              if (node)
                action =
                  stage === "fill"
                    ? { kind: "browser_fill", ref: node.ref, text: "Koswork Привет 🌙" }
                    : stage === "upload"
                      ? { kind: "browser_upload", ref: node.ref, path: "fixture.txt" }
                      : stage === "download"
                        ? { kind: "browser_download", ref: node.ref }
                        : { kind: "browser_click", ref: node.ref };
            }
          }
          return {
            action: action || { kind: "wait", milliseconds: 100 },
            message: "CI fixture only",
            requires_confirmation: false
          };
        }
      }
    });
    const outcome = await runner.run({
      project: "fixture",
      goal: "Complete generated form and download generated result",
      maxSteps: 30
    });
    assert.equal(outcome.status, "completed");
    assert.equal(fs.readFileSync(download, "utf8"), "NATIVE-DOWNLOAD-OK");
    const receipt = await (await fetch(origin + "/browser/receipt")).json();
    assert.equal(receipt.submissions, 1);
    assert.ok(receipt.unicode);
    assert.ok(receipt.attachment);
    await engine.close(engine.state().active, true);
    assert.equal(engine.state().liveTabs, 0);
    return {
      transport: "packaged Electron WebContentsView + debugger",
      search: true,
      form: true,
      upload: true,
      download: true,
      exactlyOneSubmit: true,
      noPageScreenshots: true,
      noPaidModel: true,
      fixturePlanner: true
    };
  } catch (error) {
    throw new Error("Native browser fixture failed at " + stage + ": " + error.message, {
      cause: error
    });
  } finally {
    engine?.dispose();
    if (!window.isDestroyed()) window.destroy();
    await browserSession.clearStorageData();
    await browserSession.clearCache();
  }
}
module.exports = { runNativeBrowserAcceptance };
