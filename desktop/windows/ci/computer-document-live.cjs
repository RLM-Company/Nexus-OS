"use strict";

// Uses only a newly generated temporary .txt document. No user document is edited.
const { app, BrowserWindow, desktopCapturer, screen, shell, globalShortcut } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { randomUUID } = require("node:crypto");
const { createComputerDriver } = require("../computer-driver.cjs");
const { ComputerSession } = require("../computer-session.cjs");

const output = process.env.KOSWORK_COMPUTER_LIVE_OUTPUT;
if (
  process.env.KOSWORK_COMPUTER_LIVE_TEST !== "1" ||
  process.platform !== "win32" ||
  !output ||
  !path.resolve(output).startsWith(path.resolve(os.tmpdir()) + path.sep) ||
  !path.basename(path.dirname(output)).startsWith("koswork-computer-")
)
  throw Error("Explicit temporary Windows document fixture required");
const folder = path.dirname(output);
fs.mkdirSync(path.join(folder, "electron-profile"), { recursive: true });
app.setPath("userData", path.join(folder, "electron-profile"));
const basename = "Koswork-" + randomUUID() + ".txt";
const document = path.join(folder, basename);
const initial = "\uFEFFKoswork temporary document\r\n"; // Explicit UTF-8 BOM for the default editor.
const addition = "Koswork: Привет 🌙";
fs.writeFileSync(document, initial, "utf8");
let runner, driver, window;
const actions = [];
const inputMethods = [];
const finish = (result) => {
  fs.writeFileSync(
    output,
    JSON.stringify(
      { ...result, actions, input_methods: inputMethods, at: new Date().toISOString() },
      null,
      2
    )
  );
  runner?.stop();
  driver?.stop();
  globalShortcut.unregisterAll();
  app.exit(result.passed ? 0 : 1);
};
const deadline = setTimeout(
  () => finish({ passed: false, error: "DOCUMENT_FIXTURE_TIMEOUT" }),
  45000
);

app.whenReady().then(async () => {
  try {
    window = new BrowserWindow({
      width: 680,
      height: 300,
      title: "Koswork temporary document test",
      webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true }
    });
    await window.loadURL(
      "data:text/html;charset=utf-8," +
        encodeURIComponent(
          "<h1>Koswork</h1><p>Editing only a generated temporary document. Ctrl+Alt+Shift+K stops the test.</p>"
        )
    );
    driver = createComputerDriver({ desktopCapturer, screen, shell });
    let stage = 0,
      pending = false;
    runner = new ComputerSession({
      driver,
      identity: async () => ({ origin: "http://127.0.0.1", owner: "synthetic-document-owner" }),
      confirm: async () => true,
      notify: (event) => actions.push(event.action),
      planner: {
        begin: async () => ({ id: "synthetic-document-session" }),
        authorize: async () => ({ authorized: true, valid_for_ms: 10000 }),
        end: async () => {},
        next: async ({ observation, previousResult }) => {
          let prior = {};
          try {
            prior = JSON.parse(previousResult);
          } catch {}
          if (prior.input_method) inputMethods.push(prior.input_method);
          if (pending) {
            if (prior.requested === true) stage++;
            pending = false;
          }
          const state = JSON.parse(observation.description);
          const current = state.windows.find((item) => item.id === observation.active_window);
          let action;
          if (stage === 0) {
            action = { kind: "open_file", path: document };
            pending = true;
          } else if (!current?.title.includes(basename)) {
            const owned = state.windows.find((item) => item.title.includes(basename));
            action = owned
              ? { kind: "focus", window_id: owned.id }
              : { kind: "wait", milliseconds: 500 };
          } else if (stage === 1) {
            action = { kind: "press", keys: ["CTRL", "END"] };
            pending = true;
          } else if (stage === 2) {
            action = { kind: "type_text", text: addition };
            pending = true;
          } else if (stage === 3) {
            action = { kind: "press", keys: ["CTRL", "S"] };
            pending = true;
          } else if (fs.readFileSync(document, "utf8") === initial + addition)
            action = {
              kind: "done",
              summary: "The generated temporary document contains the exact saved text."
            };
          else action = { kind: "wait", milliseconds: 500 };
          return {
            action,
            message: "Synthetic temporary document test",
            requires_confirmation: false
          };
        }
      }
    });
    globalShortcut.register("CommandOrControl+Alt+Shift+K", () => runner.stop());
    const result = await runner.run({
      project: "synthetic-document-project",
      goal: "Open the generated temporary text document, append text and save it",
      maxSteps: 16
    });
    const content = fs.readFileSync(document, "utf8");
    if (content !== initial + addition || result.status !== "completed")
      throw Error("DOCUMENT_FIXTURE_NOT_SAVED");
    clearTimeout(deadline);
    finish({
      passed: true,
      actual_text: content,
      status: result.status,
      steps: result.steps,
      model: "synthetic deterministic planner; no paid model"
    });
  } catch (error) {
    clearTimeout(deadline);
    finish({
      passed: false,
      error: error?.message || "DOCUMENT_FIXTURE_FAILED",
      diagnostic: error?.nativeDiagnostic
    });
  }
});
