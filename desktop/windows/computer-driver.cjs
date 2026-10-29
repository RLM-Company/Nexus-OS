"use strict";

const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const { setTimeout: delay } = require("node:timers/promises");
const { validateComputerAction } = require("./computer-policy.cjs");
const virtualKeys = {
  CTRL: 17,
  ALT: 18,
  SHIFT: 16,
  ENTER: 13,
  TAB: 9,
  ESCAPE: 27,
  BACKSPACE: 8,
  DELETE: 46,
  HOME: 36,
  END: 35,
  PAGEUP: 33,
  PAGEDOWN: 34,
  UP: 38,
  DOWN: 40,
  LEFT: 37,
  RIGHT: 39,
  SPACE: 32,
  ...Object.fromEntries(
    [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"].map((key) => [key, key.charCodeAt(0)])
  ),
  ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`F${i + 1}`, 112 + i]))
};

function createNativeTransport({ spawnProcess = spawn, platform = process.platform } = {}) {
  let child = null,
    pending = null,
    buffer = "";
  const stop = () => {
    const old = child;
    child = null;
    buffer = "";
    pending?.reject(Error("COMPUTER_NATIVE_INTERRUPTED"));
    pending = null;
    old?.kill();
  };
  function start() {
    if (platform !== "win32") throw Error("COMPUTER_WINDOWS_REQUIRED");
    if (child) return;
    const helper = path.join(
      __dirname.replace(/app\.asar(?=$|[\\/])/, "app.asar.unpacked"),
      "computer-helper.ps1"
    );
    const executable = path.join(
      process.env.SystemRoot || "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe"
    );
    const current = spawnProcess(
      executable,
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", helper],
      {
        windowsHide: true,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"]
      }
    );
    child = current;
    current.stdout.setEncoding("utf8");
    current.stdout.on("data", (chunk) => {
      if (child !== current) return;
      buffer += chunk;
      if (buffer.length > 100000) return stop();
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        try {
          const value = JSON.parse(line);
          if (!pending || value.id !== pending.id) return stop();
          const task = pending;
          pending = null;
          if (value.ok === true) task.resolve(value.result);
          else {
            const error = Error(
              /^COMPUTER_[A-Z_]+$/.test(value.error) ? value.error : "COMPUTER_NATIVE_ERROR"
            );
            if (value.diagnostic && Number.isSafeInteger(value.diagnostic.line))
              error.nativeDiagnostic = {
                stage: String(value.diagnostic.stage || "").slice(0, 24),
                line: value.diagnostic.line,
                type: String(value.diagnostic.exception_type || "").slice(0, 100)
              };
            task.reject(error);
          }
        } catch {
          stop();
        }
      }
    });
    current.stderr.on("data", () => {}); // Never log screen text or command payloads.
    current.on("error", () => {
      if (child === current) stop();
    });
    current.on("exit", () => {
      if (child === current) stop();
    });
  }
  async function request(input, signal) {
    if (signal.aborted) throw Error("COMPUTER_SESSION_STOPPED");
    if (pending) throw Error("COMPUTER_NATIVE_BUSY");
    start();
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const timeout = setTimeout(stop, 12000);
      const abort = () => stop();
      const finish = (fn) => (value) => {
        clearTimeout(timeout);
        signal.removeEventListener("abort", abort);
        fn(value);
      };
      pending = { id, resolve: finish(resolve), reject: finish(reject) };
      signal.addEventListener("abort", abort, { once: true });
      child.stdin.write(JSON.stringify({ ...input, id }) + "\n", (error) => {
        if (error) stop();
      });
    });
  }
  return { request, stop };
}

function createComputerDriver({
  desktopCapturer,
  screen,
  shell,
  transport = createNativeTransport(),
  now = Date.now
}) {
  let observed = null;
  async function observe(signal) {
    const state = await transport.request({ kind: "state" }, signal);
    const display = screen.getPrimaryDisplay();
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: 1280, height: 800 }
    });
    if (signal.aborted) throw Error("COMPUTER_SESSION_STOPPED");
    const source = sources.find((item) => item.display_id === String(display.id));
    if (!source || source.thumbnail.isEmpty()) throw Error("COMPUTER_SCREEN_UNAVAILABLE");
    let image = source.thumbnail;
    let jpeg = image.toJPEG(75);
    while (jpeg.length > 950000 && image.getSize().width > 480) {
      image = image.resize({ width: Math.floor(image.getSize().width * 0.75) });
      jpeg = image.toJPEG(65);
    }
    if (jpeg.length > 1000000) throw Error("COMPUTER_SCREEN_TOO_LARGE");
    // A capture is valid only if the foreground did not change during capture.
    const current = await transport.request({ kind: "foreground" }, signal);
    if (state.active_window !== current.active_window) throw Error("COMPUTER_WINDOW_CHANGED");
    if (!Number.isSafeInteger(state.input_tick) || current.input_tick !== state.input_tick)
      throw Error("COMPUTER_USER_INPUT_ACTIVE");
    observed = {
      id: randomUUID(),
      window: state.active_window,
      inputTick: state.input_tick,
      bounds: { ...display.bounds },
      at: now()
    };
    const allWindows = Array.isArray(state.windows) ? state.windows : [];
    const allElements = Array.isArray(state.elements) ? state.elements : [];
    const visible = {
      active_window: state.active_window,
      known_folders:
        typeof state.known_folders?.desktop === "string" && state.known_folders.desktop
          ? { desktop: state.known_folders.desktop.slice(0, 1000) }
          : {},
      windows: [
        ...allWindows.filter((w) => w.id === state.active_window),
        ...allWindows.filter((w) => w.id !== state.active_window)
      ]
        .slice(0, 12)
        .map((w) => ({ ...w, title: String(w.title || "").slice(0, 160) })),
      elements: allElements
        .slice(0, 60)
        .map((e) => ({ ...e, name: String(e.name || "").slice(0, 120) })),
      omitted_windows: Math.max(0, allWindows.length - 12),
      omitted_elements: Math.max(0, allElements.length - 60)
    };
    while (JSON.stringify(visible).length > 16000 && visible.elements.length) {
      visible.elements.pop();
      visible.omitted_elements++;
    }
    return {
      observation_id: observed.id,
      active_window: state.active_window,
      description: JSON.stringify(visible),
      width: image.getSize().width,
      height: image.getSize().height,
      image_jpeg_base64: jpeg.toString("base64")
    };
  }
  async function execute(proposal, observation, signal) {
    const action = validateComputerAction(proposal);
    if (
      signal.aborted ||
      !observed ||
      observation.observation_id !== observed.id ||
      now() - observed.at > 120000
    )
      throw Error("COMPUTER_OBSERVATION_STALE");
    const target = observed;
    observed = null; // A screenshot cannot authorize a second action.
    const expected = { expected_window: target.window, expected_input_tick: target.inputTick };
    const pointFor = (x, y) =>
      screen.dipToScreenPoint({
        x: Math.round(target.bounds.x + x * Math.max(0, target.bounds.width - 1)),
        y: Math.round(target.bounds.y + y * Math.max(0, target.bounds.height - 1))
      });
    if (action.kind === "observe") return { requested: true };
    if (action.kind === "list_apps")
      return transport.request({ kind: "apps", ...expected }, signal);
    if (action.kind === "find_apps")
      return transport.request({ kind: "apps", query: action.query, ...expected }, signal);
    if (action.kind === "open_app")
      return transport.request({ kind: "launch", app_id: action.app_id, ...expected }, signal);
    if (action.kind === "focus")
      return transport.request({ kind: "focus", window_id: action.window_id, ...expected }, signal);
    if (action.kind === "open_url" || action.kind === "open_file") {
      await transport.request({ kind: "foreground", ...expected }, signal);
      if (signal.aborted) throw Error("COMPUTER_SESSION_STOPPED");
      if (action.kind === "open_url") await shell.openExternal(action.url, { activate: true });
      else {
        if (!fs.statSync(action.path).isFile()) throw Error("COMPUTER_FILE_NOT_FOUND");
        const error = await shell.openPath(action.path);
        if (error) throw Error("COMPUTER_FILE_OPEN_FAILED");
      }
      await delay(350, undefined, { signal });
      return {
        requested: true,
        verification: "Inspect the next observation; opening is not proof of task completion."
      };
    }
    if (action.kind === "wait") {
      await delay(action.milliseconds, undefined, { signal });
      return { requested: true };
    }
    if (action.kind === "click") {
      const point = pointFor(action.x, action.y);
      return transport.request(
        {
          kind: "click",
          x: point.x,
          y: point.y,
          right: action.button === "right",
          count: action.count,
          ...expected
        },
        signal
      );
    }
    if (action.kind === "hover")
      return transport.request(
        { kind: "hover", ...pointFor(action.x, action.y), ...expected },
        signal
      );
    if (action.kind === "drag") {
      const from = pointFor(action.from_x, action.from_y),
        to = pointFor(action.to_x, action.to_y);
      return transport.request(
        { kind: "drag", from_x: from.x, from_y: from.y, to_x: to.x, to_y: to.y, ...expected },
        signal
      );
    }
    if (action.kind === "type_text")
      return transport.request({ kind: "text", text: action.text, ...expected }, signal);
    if (action.kind === "press")
      return transport.request(
        { kind: "keys", codes: action.keys.map((key) => virtualKeys[key]), ...expected },
        signal
      );
    if (action.kind === "scroll")
      return transport.request(
        {
          kind: "wheel",
          amount: action.amount * 120 * (["up", "right"].includes(action.direction) ? 1 : -1),
          horizontal: ["left", "right"].includes(action.direction),
          ...expected
        },
        signal
      );
    throw Error("COMPUTER_ACTION_INVALID");
  }
  return {
    observe,
    execute,
    stop: () => {
      observed = null;
      transport.stop();
    }
  };
}
module.exports = { createNativeTransport, createComputerDriver, virtualKeys };
