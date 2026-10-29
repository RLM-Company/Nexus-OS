"use strict";

const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createComputerApiClient } = require("./computer-api-client.cjs");
const { ComputerSession } = require("./computer-session.cjs");
const { createComputerDriver } = require("./computer-driver.cjs");

function createComputerConsole({
  BrowserWindow,
  ipcMain,
  dialog,
  desktopCapturer,
  screen,
  shell,
  globalShortcut,
  identity,
  getSession,
  createRunner = (options) => new ComputerSession(options)
}) {
  let window = null;
  let prefill = null;
  const page = pathToFileURL(path.join(__dirname, "computer.html")).toString();
  const trusted = (event) =>
    !!window &&
    !window.isDestroyed() &&
    event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame &&
    event.senderFrame.url === page;
  const tell = (value) => {
    if (window && !window.isDestroyed()) window.webContents.send("koswork:computer-status", value);
  };
  const driver = createComputerDriver({ desktopCapturer, screen, shell });
  const planner = createComputerApiClient({ identity, getSession });
  const runner = createRunner({
    driver,
    planner,
    identity,
    notify: tell,
    allowHumanResume: true,
    async confirm(value) {
      const isSession = value.kind === "session";
      const answer = await dialog.showMessageBox(window, {
        type: "question",
        title: "Koswork — управление компьютером",
        defaultId: 1,
        cancelId: 1,
        signal: value.signal,
        buttons: [isSession ? "Начать управление" : "Выполнить действие", "Отмена"],
        message: isSession
          ? "Разрешить Koswork управлять этим компьютером для задачи?"
          : "Подтвердить действие?",
        detail: isSession
          ? `${value.goal}\n\nАгент сможет открывать сайты, приложения и документы, нажимать кнопки и вводить текст. Изображения основного экрана и доступные элементы интерфейса передаются модели через ${value.origin}. Сеанс действует до 30 минут. Мышь и клавиатура могут быть заняты. Остановка: Ctrl+Alt+Shift+K или кнопка «Остановить».`
          : `${value.message}\n\n${JSON.stringify(value.action).slice(0, 4000)}`
      });
      return answer.response === 0;
    }
  });
  ipcMain.handle("koswork:computer-projects", async (event) => {
    if (!trusted(event)) return { error: "Недоверенный источник." };
    try {
      const current = await identity();
      const result = await planner.request("/api/v1/projects");
      return {
        owner: current?.owner,
        origin: current?.origin,
        prefill,
        projects: (result.items || [])
          .filter((p) => ["DRAFT", "ACTIVE"].includes(p.status))
          .map((p) => ({ id: p.id, title: p.title }))
      };
    } catch {
      return { error: "Не удалось подтвердить аккаунт или загрузить проекты." };
    }
  });
  ipcMain.handle("koswork:computer-start", async (event, input) => {
    if (
      !trusted(event) ||
      !input ||
      typeof input.goal !== "string" ||
      !input.goal.trim() ||
      input.goal.length > 8000 ||
      typeof input.project !== "string" ||
      !/^[a-zA-Z0-9_-]{1,160}$/.test(input.project) ||
      Object.keys(input).some((key) => !["goal", "project"].includes(key))
    )
      return { error: "Некорректная задача." };
    if (runner.active) return { error: "COMPUTER_BUSY" };
    try {
      if (!globalShortcut.register("CommandOrControl+Alt+Shift+K", () => runner.stop()))
        throw Error("COMPUTER_STOP_SHORTCUT_UNAVAILABLE");
      return await runner.run({ project: input.project, goal: input.goal.trim(), maxSteps: 30 });
    } catch (error) {
      const code = /^COMPUTER_[A-Z_]+$/.test(error?.message)
        ? error.message
        : "COMPUTER_INTERRUPTED";
      return { error: code };
    } finally {
      globalShortcut.unregister("CommandOrControl+Alt+Shift+K");
      driver.stop();
    }
  });
  ipcMain.handle("koswork:computer-stop", (event) => {
    if (!trusted(event)) return { stopped: false };
    runner.stop();
    return { stopped: true };
  });
  ipcMain.handle("koswork:computer-resume", (event) => {
    if (!trusted(event)) return { resumed: false };
    return { resumed: runner.resume() };
  });
  async function show(initial) {
    if (initial && !runner.active) prefill = { project: initial.project, goal: initial.goal };
    if (window && !window.isDestroyed()) {
      if (initial && !runner.active) window.webContents.send("koswork:computer-prefill", prefill);
      window.show();
      window.focus();
      return;
    }
    window = new BrowserWindow({
      width: 760,
      height: 620,
      minWidth: 620,
      minHeight: 480,
      title: "Koswork — управление компьютером",
      backgroundColor: "#111111",
      webPreferences: {
        preload: path.join(__dirname, "computer-preload.cjs"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true
      }
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.on("closed", () => {
      runner.stop();
      window = null;
      prefill = null;
    });
    await window.loadFile(path.join(__dirname, "computer.html"));
  }
  const stop = () => {
    runner.stop();
    globalShortcut.unregister("CommandOrControl+Alt+Shift+K");
  };
  const invalidate = () => {
    stop();
    if (window && !window.isDestroyed()) window.destroy();
  };
  return { show, stop, invalidate };
}
module.exports = { createComputerConsole };
