"use strict";

// Opens one generated localhost form in the default browser; no paid model or user file.
const {
  app,
  BrowserWindow,
  desktopCapturer,
  nativeImage,
  screen,
  shell,
  globalShortcut
} = require("electron");
const { createServer } = require("node:http");
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
  throw Error("Explicit temporary Windows browser fixture required");
const folder = path.dirname(output);
fs.mkdirSync(path.join(folder, "electron-profile"), { recursive: true });
app.setPath("userData", path.join(folder, "electron-profile"));
const nonce = randomUUID();
const title = "Koswork browser fixture " + nonce;
const value = "KosworkBrowser_" + nonce;
let runner,
  driver,
  window,
  received = null;
const actions = [];
const observations = [];
const server = createServer(async (request, response) => {
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'"
  );
  if (request.url !== "/" + nonce) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  if (request.method === "POST") {
    let body = "";
    for await (const chunk of request) {
      body += chunk;
      if (body.length > 1024) {
        response.writeHead(413);
        response.end();
        return;
      }
    }
    received = new URLSearchParams(body).get("value");
    response.end(
      `<title>${title}</title><h1>Koswork browser input received</h1><p>Local test completed.</p>`
    );
    return;
  }
  response.end(
    `<html><head><title>${title}</title></head><body style="font:24px system-ui;background:#151515;color:white;padding:50px"><h1>Koswork browser test</h1><p>This is a generated local test form.</p><form method="POST"><label>Test input<input name="value" autocomplete="off" style="display:block;width:70vw;height:80px;background:#11ee77;color:black;font:24px system-ui;border:0;margin:30px 0"></label><button type="submit" style="font:24px system-ui">Verify locally</button></form></body></html>`
  );
});
const finish = (result) => {
  fs.writeFileSync(
    output,
    JSON.stringify({ ...result, actions, observations, at: new Date().toISOString() }, null, 2)
  );
  runner?.stop();
  driver?.stop();
  globalShortcut.unregisterAll();
  server.close();
  app.exit(result.passed ? 0 : 1);
};
const deadline = setTimeout(
  () => finish({ passed: false, error: "BROWSER_FIXTURE_TIMEOUT" }),
  45000
);

// Read only the marker in this generated page. No existing page DOM or private input is inspected.
function marker(observation) {
  const image = nativeImage.createFromBuffer(Buffer.from(observation.image_jpeg_base64, "base64"));
  const { width, height } = image.getSize();
  const bytes = image.getBitmap();
  for (let y = Math.floor(height * 0.15); y < height - 8; y++) {
    let start = -1;
    for (let x = 0; x <= width; x++) {
      const offset = (y * width + x) * 4;
      const green =
        x < width &&
        bytes[offset + 2] < 55 &&
        bytes[offset + 1] > 180 &&
        bytes[offset] > 60 &&
        bytes[offset] < 170;
      if (green && start < 0) start = x;
      if (!green && start >= 0) {
        if (x - start > width * 0.2) return { x: (start + x) / 2 / width, y: (y + 4) / height };
        start = -1;
      }
    }
  }
  throw Error("BROWSER_FIXTURE_MARKER_NOT_VISIBLE");
}

app.whenReady().then(async () => {
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${server.address().port}/${nonce}`;
    window = new BrowserWindow({
      width: 680,
      height: 320,
      title: "Koswork local browser acceptance",
      webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true }
    });
    await window.loadURL(
      "data:text/html;charset=utf-8," +
        encodeURIComponent(
          "<h1>Koswork</h1><p>Checking one local form in the default browser. Ctrl+Alt+Shift+K stops the test.</p>"
        )
    );
    driver = createComputerDriver({ desktopCapturer, screen, shell });
    let stage = 0;
    runner = new ComputerSession({
      driver,
      identity: async () => ({ origin: "http://127.0.0.1", owner: "synthetic-browser-owner" }),
      confirm: async () => true,
      notify: (event) => actions.push(event.action),
      planner: {
        begin: async () => ({ id: "synthetic-browser-session" }),
        authorize: async () => ({ authorized: true, valid_for_ms: 10000 }),
        end: async () => {},
        next: async ({ observation, previousResult }) => {
          let action;
          const observedState = JSON.parse(observation.description);
          observations.push({
            owned_active: !!observedState.windows
              .find((w) => w.id === observation.active_window)
              ?.title.includes(title),
            owned_window_seen: observedState.windows.some((w) => w.title.includes(title)),
            prior_rejection: (() => {
              try {
                return JSON.parse(previousResult).reason;
              } catch {
                return undefined;
              }
            })()
          });
          if (stage === 0) {
            stage++;
            action = { kind: "open_url", url };
          } else {
            const state = JSON.parse(observation.description);
            const current = state.windows.find((item) => item.id === observation.active_window);
            if (!current?.title.includes(title)) {
              const owned = state.windows.find((item) => item.title.includes(title));
              action = owned
                ? { kind: "focus", window_id: owned.id }
                : { kind: "wait", milliseconds: 500 };
            } else if (stage === 1) {
              action = { kind: "click", ...marker(observation), button: "left", count: 1 };
              stage++;
            } else if (stage === 2) {
              action = { kind: "type_text", text: value };
              stage++;
            } else if (stage === 3) {
              action = { kind: "press", keys: ["ENTER"] };
              stage++;
            } else if (received === value)
              action = {
                kind: "done",
                summary: "The localhost form received the exact synthetic text."
              };
            else throw Error("BROWSER_FIXTURE_VALUE_MISMATCH");
          }
          return { action, message: "Synthetic local browser test", requires_confirmation: false };
        }
      }
    });
    globalShortcut.register("CommandOrControl+Alt+Shift+K", () => runner.stop());
    const result = await runner.run({
      project: "synthetic-browser-project",
      goal: "Open and fill the generated localhost form",
      maxSteps: 12
    });
    if (received !== value || result.status !== "completed")
      throw Error("BROWSER_FIXTURE_NOT_COMPLETED");
    clearTimeout(deadline);
    finish({
      passed: true,
      actual_value: received,
      status: result.status,
      steps: result.steps,
      model: "synthetic deterministic planner; no paid model"
    });
  } catch (error) {
    clearTimeout(deadline);
    finish({
      passed: false,
      error: error?.message || "BROWSER_FIXTURE_FAILED",
      diagnostic: error?.nativeDiagnostic
    });
  }
});
