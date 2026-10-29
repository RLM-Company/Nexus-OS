"use strict";

// Explicit development acceptance: controls only this disposable fixture window.
// No installer, production server, user documents or AI provider is involved.
const { app, BrowserWindow, desktopCapturer, screen, shell, globalShortcut } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { randomUUID } = require("node:crypto");
const { createComputerDriver } = require("../computer-driver.cjs");
const { ComputerSession } = require("../computer-session.cjs");

if (process.env.KOSWORK_COMPUTER_LIVE_TEST !== "1" || process.platform !== "win32")
  throw Error("Explicit Windows computer test required");
const output = process.env.KOSWORK_COMPUTER_LIVE_OUTPUT;
if (
  !output ||
  !path.isAbsolute(output) ||
  !path.resolve(output).startsWith(path.resolve(os.tmpdir()) + path.sep) ||
  !path.basename(path.dirname(output)).startsWith("koswork-computer-")
)
  throw Error("A dedicated temporary output folder is required");
const folder = path.dirname(output);
fs.mkdirSync(folder, { recursive: true });
fs.mkdirSync(path.join(folder, "electron-profile"), { recursive: true });
app.setPath("userData", path.join(folder, "electron-profile"));
const title = "Koswork input fixture " + randomUUID();
let driver, window, runner;
const actionKinds = [];
const controller = new AbortController();
const finish = (result) => {
  fs.writeFileSync(output, JSON.stringify({ ...result, at: new Date().toISOString() }, null, 2));
  controller.abort();
  runner?.stop();
  driver?.stop();
  globalShortcut.unregisterAll();
  app.exit(result.passed ? 0 : 1);
};
const deadline = setTimeout(() => finish({ passed: false, error: "LIVE_FIXTURE_TIMEOUT" }), 45000);
app.on("window-all-closed", () => {
  clearTimeout(deadline);
  if (!controller.signal.aborted) finish({ passed: false, error: "LIVE_FIXTURE_CLOSED" });
});

app.whenReady().then(async () => {
  try {
    window = new BrowserWindow({
      width: 900,
      height: 650,
      x: 20,
      y: 20,
      title,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
    });
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body style="background:#141414;color:white;font:20px system-ui;padding:50px"><h1>Тест управления Koswork</h1><p>Проверяем настоящий ввод в отдельном тестовом окне.</p><label>Тестовое поле <input id="input" style="display:block;font:24px system-ui;width:600px;margin:20px 0"></label><button id="button" style="font:20px system-ui">Проверить</button><p id="result"></p><script>document.getElementById('button').onclick=()=>{document.getElementById('result').textContent=document.getElementById('input').value}</script></body></html>`;
    await window.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
    window.show();
    window.focus();
    window.webContents.focus();
    driver = createComputerDriver({ desktopCapturer, screen, shell });
    const display = screen.getPrimaryDisplay();
    const content = window.getContentBounds();
    const box = await window.webContents.executeJavaScript(
      "JSON.stringify((()=>{const r=document.getElementById('input').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})())"
    );
    const point = JSON.parse(box);
    const actions = [
      {
        kind: "click",
        x: (content.x + point.x - display.bounds.x) / display.bounds.width,
        y: (content.y + point.y - display.bounds.y) / display.bounds.height,
        button: "left",
        count: 1
      },
      { kind: "type_text", text: "Koswork: Привет 🌙" },
      { kind: "press", keys: ["TAB"] },
      { kind: "press", keys: ["ENTER"] },
      { kind: "done", summary: "Fixture checked" }
    ];
    let index = 0;
    const identity = { origin: "http://127.0.0.1", owner: "synthetic-fixture-owner" };
    runner = new ComputerSession({
      driver,
      identity: async () => identity,
      confirm: async () => true,
      notify: (value) => actionKinds.push(value.action),
      planner: {
        begin: async () => ({ id: "synthetic-fixture-session" }),
        next: async ({ observation }) => {
          const state = JSON.parse(observation.description);
          const current = state.windows.find((item) => item.id === observation.active_window);
          if (current?.title !== title) {
            const owned = state.windows.find((item) => item.title === title);
            if (!owned) throw Error("LIVE_FIXTURE_WINDOW_NOT_OBSERVED");
            return {
              action: { kind: "focus", window_id: owned.id },
              message: "Focus the owned fixture only",
              requires_confirmation: false
            };
          }
          return {
            action: actions[index++],
            message: "Synthetic fixture action",
            requires_confirmation: false
          };
        },
        authorize: async () => ({ authorized: true, valid_for_ms: 10000 }),
        end: async () => {}
      }
    });
    globalShortcut.register("CommandOrControl+Alt+Shift+K", () => runner.stop());
    const result = await runner.run({
      project: "synthetic-fixture-project",
      goal: "Fill and submit the local fixture",
      maxSteps: 7
    });
    const actual = await window.webContents.executeJavaScript(
      "document.getElementById('result').textContent"
    );
    if (actual !== "Koswork: Привет 🌙") throw Error("LIVE_FIXTURE_TEXT_MISMATCH");
    const image = await window.webContents.capturePage();
    fs.writeFileSync(path.join(folder, "owned-fixture-window.png"), image.toPNG());
    clearTimeout(deadline);
    finish({
      passed: true,
      status: result.status,
      steps: result.steps,
      actual_text: actual,
      model: "synthetic deterministic planner; no paid model"
    });
  } catch (error) {
    clearTimeout(deadline);
    if (window && !window.isDestroyed()) {
      try {
        fs.writeFileSync(
          path.join(folder, "owned-fixture-failure.png"),
          (await window.webContents.capturePage()).toPNG()
        );
      } catch {}
    }
    finish({
      passed: false,
      error: error?.message || "LIVE_FIXTURE_FAILED",
      actions: actionKinds,
      diagnostic: error?.nativeDiagnostic
    });
  }
});
