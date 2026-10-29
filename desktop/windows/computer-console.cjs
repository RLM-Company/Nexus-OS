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
  history,
  workspace = null,
  createRunner = (options) => new ComputerSession(options)
}) {
  if (!history) throw Error("COMPUTER_HISTORY_UNAVAILABLE");
  let window = null;
  let prefill = null;
  let pending = false;
  let epoch = 0;
  let selectionController = null;
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
    history,
    workspace,
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
          : value.recoveryReview
            ? "Проверить результат прошлой попытки и выполнить действие?"
            : "Подтвердить действие?",
        detail: isSession
          ? `${value.goal}\n\n${value.workspace ? "Рабочая папка: " + value.workspace.name + ". Выбранные текстовые файлы могут передаваться модели. Запись в папку требует отдельного подтверждения.\n\n" : ""}Агент сможет открывать сайты, приложения и документы, нажимать кнопки и вводить текст. Изображения основного экрана и доступные элементы интерфейса передаются модели через ${value.origin}. Сеанс действует до 30 минут. Мышь и клавиатура могут быть заняты. Остановка: Ctrl+Alt+Shift+K или кнопка «Остановить».`
          : `${value.recoveryReview ? "Прошлая попытка могла уже изменить данные. Сверьте текущий результат: разрешение относится только к указанному действию.\n\n" : ""}${value.message}\n\n${JSON.stringify(value.action).slice(0, 4000)}`
      });
      return answer.response === 0;
    }
  });
  // This check uses the existing privacy lifecycle without sending any saved goal.
  // The server independently fences every model dispatch/action authorization.
  async function checkedContext(event) {
    const initialEpoch = epoch;
    const current = await identity();
    if (!current) throw Error("COMPUTER_OWNER_UNVERIFIED");
    const privacy = await planner.request("/api/v1/personal-settings/privacy", {
      expected: current
    });
    if (!trusted(event) || initialEpoch !== epoch) throw Error("COMPUTER_IDENTITY_CHANGED");
    const after = await identity();
    if (
      !trusted(event) ||
      initialEpoch !== epoch ||
      !after ||
      after.owner !== current.owner ||
      after.origin !== current.origin
    )
      throw Error("COMPUTER_IDENTITY_CHANGED");
    if (privacy.lifecycle === "deleted") {
      history.clear(current);
      void workspace?.invalidate();
    }
    if (privacy.lifecycle !== "active") throw Error("COMPUTER_PRIVACY_BLOCKED");
    return current;
  }
  const failure = (error) => ({
    error: /^COMPUTER_[A-Z_]+$/.test(error?.message) ? error.message : "COMPUTER_INTERRUPTED"
  });
  ipcMain.handle("koswork:computer-workspace-status", async (event) => {
    if (!trusted(event)) return { error: "Недоверенный источник." };
    try {
      return { folder: workspace?.snapshot(await checkedContext(event)) ?? null };
    } catch (error) {
      return failure(error);
    }
  });
  ipcMain.handle("koswork:computer-workspace-select", async (event) => {
    if (!trusted(event) || !workspace) return { error: "COMPUTER_WORKSPACE_UNAVAILABLE" };
    if (pending || runner.active) return { error: "COMPUTER_BUSY" };
    pending = true;
    selectionController = new AbortController();
    try {
      const context = await checkedContext(event);
      const folder = await workspace.connect(context, selectionController.signal);
      const after = await checkedContext(event);
      if (
        selectionController.signal.aborted ||
        after.owner !== context.owner ||
        after.origin !== context.origin
      )
        throw Error("COMPUTER_IDENTITY_CHANGED");
      return { folder };
    } catch (error) {
      await workspace.invalidate();
      return failure(error);
    } finally {
      selectionController = null;
      pending = false;
    }
  });
  ipcMain.handle("koswork:computer-workspace-revoke", async (event) => {
    if (!trusted(event)) return { error: "Недоверенный источник." };
    // Revocation needs no network and cannot grant access to any file.
    stop();
    await workspace?.invalidate();
    return { folder: null };
  });
  async function startTask(event, resolve) {
    if (!trusted(event)) return { error: "Недоверенный источник." };
    if (pending || runner.active) return { error: "COMPUTER_BUSY" };
    pending = true;
    try {
      const context = await checkedContext(event);
      const input = resolve(context);
      if (!globalShortcut.register("CommandOrControl+Alt+Shift+K", () => runner.stop()))
        throw Error("COMPUTER_STOP_SHORTCUT_UNAVAILABLE");
      return await runner.run({ ...input, maxSteps: 30, expectedContext: context });
    } catch (error) {
      return failure(error);
    } finally {
      pending = false;
      globalShortcut.unregister("CommandOrControl+Alt+Shift+K");
    }
  }
  ipcMain.handle("koswork:computer-history", async (event) => {
    if (!trusted(event)) return { error: "Недоверенный источник." };
    try {
      return { items: history.list(await checkedContext(event)) };
    } catch (error) {
      return failure(error);
    }
  });
  ipcMain.handle("koswork:computer-recover", (event, id) => {
    if (typeof id !== "string" || !/^[a-f0-9-]{36}$/i.test(id))
      return { error: "COMPUTER_RECOVERY_UNAVAILABLE" };
    return startTask(event, (context) => {
      const recovery = history.recovery(context, id);
      return { project: recovery.project, goal: recovery.goal, recovery };
    });
  });
  ipcMain.handle("koswork:computer-accept", async (event, id) => {
    if (!trusted(event) || typeof id !== "string" || id.length !== 36)
      return { error: "COMPUTER_HISTORY_NOT_FOUND" };
    if (pending || runner.active) return { error: "COMPUTER_BUSY" };
    try {
      return history.accept(await checkedContext(event), id);
    } catch (error) {
      return failure(error);
    }
  });
  ipcMain.handle("koswork:computer-clear-history", async (event) => {
    if (!trusted(event)) return { error: "Недоверенный источник." };
    if (pending || runner.active) return { error: "COMPUTER_BUSY" };
    pending = true;
    try {
      const context = await checkedContext(event);
      const answer = await dialog.showMessageBox(window, {
        type: "question",
        title: "Koswork — история задач",
        defaultId: 1,
        cancelId: 1,
        buttons: ["Удалить локальную историю", "Отмена"],
        message: "Удалить локальную историю задач этого аккаунта на этом сервере?",
        detail:
          "Файлы, приложения и результаты действий останутся на устройстве. Восстановление этих задач станет недоступно."
      });
      if (answer.response !== 0) return { cleared: false };
      const after = await checkedContext(event);
      if (after.owner !== context.owner || after.origin !== context.origin)
        throw Error("COMPUTER_IDENTITY_CHANGED");
      history.clear(context);
      return { cleared: true };
    } catch (error) {
      return failure(error);
    } finally {
      pending = false;
    }
  });
  ipcMain.handle("koswork:computer-projects", async (event) => {
    if (!trusted(event)) return { error: "Недоверенный источник." };
    try {
      const current = await checkedContext(event);
      const result = await planner.request("/api/v1/projects", { expected: current });
      if (!trusted(event)) throw Error("COMPUTER_IDENTITY_CHANGED");
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
    return startTask(event, () => ({ project: input.project, goal: input.goal.trim() }));
  });
  ipcMain.handle("koswork:computer-stop", (event) => {
    if (!trusted(event)) return { stopped: false };
    stop();
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
    window.webContents.on("render-process-gone", () => {
      stop();
      if (window && !window.isDestroyed()) window.destroy();
    });
    window.on("unresponsive", stop);
    window.on("closed", () => {
      stop();
      void workspace?.invalidate();
      window = null;
      prefill = null;
    });
    await window.loadFile(path.join(__dirname, "computer.html"));
  }
  const stop = () => {
    epoch++;
    selectionController?.abort();
    runner.stop();
    globalShortcut.unregister("CommandOrControl+Alt+Shift+K");
  };
  const invalidate = () => {
    stop();
    void workspace?.invalidate();
    if (window && !window.isDestroyed()) window.destroy();
  };
  return { show, stop, invalidate };
}
module.exports = { createComputerConsole };
