"use strict";
const path = require("node:path"),
  { pathToFileURL } = require("node:url");
const { createBrowserEngine } = require("./engine.cjs");
const { createComputerApiClient } = require("../computer-api-client.cjs");
const { ComputerSession } = require("../computer-session.cjs");
const { address, safeUrl } = require("./policy.cjs");
function createKosworkBrowser({
  BrowserWindow,
  WebContentsView,
  Menu,
  ipcMain,
  dialog,
  globalShortcut,
  identity,
  getSession,
  profiles,
  workspace,
  history,
  taskGate,
  createEngine = createBrowserEngine,
  executionMode = "browser",
  createComputer = null,
  createRunner = (options) => new ComputerSession(options)
}) {
  if (!["browser", "work"].includes(executionMode) || (executionMode === "work" && !createComputer))
    throw Error("COMPUTER_ACTION_INVALID");
  const channel = executionMode === "work" ? "koswork:work" : "koswork:browser";
  const stepLimit = executionMode === "work" ? 90 : 30;
  let shortcutHeld = false;
  function releaseShortcut() {
    if (shortcutHeld) {
      shortcutHeld = false;
      globalShortcut.unregister("CommandOrControl+Alt+Shift+K");
    }
  }
  const page = pathToFileURL(path.join(__dirname, "browser.html")).toString();
  const planner = createComputerApiClient({ identity, getSession });
  let window = null,
    engine = null,
    workDriver = null,
    runner = null,
    bound = null,
    epoch = 0,
    pending = false,
    selection = null,
    projects = [],
    notice = "",
    resizeTimer = null;
  const trusted = (e) =>
    !!window &&
    !window.isDestroyed() &&
    e?.sender === window.webContents &&
    e.senderFrame === window.webContents.mainFrame &&
    e.senderFrame.url === page;
  const folderState = () => {
    try {
      return workspace.snapshot(bound);
    } catch {
      return null;
    }
  };
  const state = () => ({
    ...(engine?.state() ?? {
      tabs: [],
      active: null,
      downloads: [],
      liveTabs: 0,
      maxLiveTabs: 3,
      maxTabs: 8
    }),
    projects,
    folder: bound ? folderState() : null,
    running: !!runner?.active,
    paused: runner?.active?.phase === "awaiting_user",
    notice,
    taskMode: executionMode,
    workTask: workDriver?.state() ?? null
  });
  const tell = (value) => {
    if (window && !window.isDestroyed())
      window.webContents.send(channel + "-state", { ...state(), ...value });
  };
  const same = (a, b) => !!a && !!b && a.origin === b.origin && a.owner === b.owner;
  async function authorize(e) {
    const revision = epoch,
      context = bound,
      current = await identity();
    if (!trusted(e) || revision !== epoch || !same(context, current))
      throw Error("COMPUTER_IDENTITY_CHANGED");
    const privacy = await planner.request("/api/v1/personal-settings/privacy", {
      expected: context
    });
    if (!trusted(e) || revision !== epoch || !same(context, await identity()))
      throw Error("COMPUTER_IDENTITY_CHANGED");
    if (privacy.lifecycle !== "active") throw Error("COMPUTER_PRIVACY_BLOCKED");
    return context;
  }
  const failure = (error) => ({
    error: /^(?:BROWSER|COMPUTER|WORK)_[A-Z_]+$/.test(error?.message)
      ? error.message
      : "BROWSER_INTERRUPTED"
  });
  function stop() {
    epoch++;
    selection?.abort();
    runner?.stop();
    releaseShortcut();
  }
  function invalidate() {
    stop();
    const old = window;
    window = null;
    engine?.dispose();
    engine = null;
    workDriver = null;
    bound = null;
    projects = [];
    void workspace.invalidate();
    if (old && !old.isDestroyed()) old.destroy();
  }
  async function show(initial) {
    if (window && !window.isDestroyed()) {
      if (initial && (pending || runner?.active)) throw Error("COMPUTER_BUSY");
      if (initial) {
        const ownedWindow = window,
          revision = epoch,
          context = bound;
        const result = await planner.request("/api/v1/projects", { expected: context });
        if (window !== ownedWindow || revision !== epoch || !same(context, await identity()))
          throw Error("COMPUTER_IDENTITY_CHANGED");
        if (pending || runner?.active) throw Error("COMPUTER_BUSY");
        projects = (result.items ?? [])
          .filter((p) => ["DRAFT", "ACTIVE"].includes(p.status))
          .map((p) => ({ id: p.id, title: p.title }));
        if (!projects.some((p) => p.id === initial.project))
          throw Error("COMPUTER_PROJECT_UNAVAILABLE");
        tell({ prefill: initial });
      }
      window.show();
      window.focus();
      return true;
    }
    const revision = epoch,
      context = await identity();
    if (!context || revision !== epoch) throw Error("COMPUTER_OWNER_UNVERIFIED");
    const privacy = await planner.request("/api/v1/personal-settings/privacy", {
      expected: context
    });
    if (privacy.lifecycle !== "active") throw Error("COMPUTER_PRIVACY_BLOCKED");
    const session = await profiles.get(context);
    if (revision !== epoch || !same(context, await identity()))
      throw Error("COMPUTER_IDENTITY_CHANGED");
    if (window && !window.isDestroyed()) {
      window.show();
      return true;
    }
    bound = context;
    notice = "";
    const ownedWindow = (window = new BrowserWindow({
      width: 1280,
      height: 840,
      minWidth: 1000,
      minHeight: 640,
      title: executionMode === "work" ? "Koswork · Рабочая задача" : "Koswork · Browser",
      backgroundColor: "#090b0e",
      webPreferences: {
        preload: path.join(
          __dirname,
          executionMode === "work" ? "../work-cycle-preload.cjs" : "preload.cjs"
        ),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true
      }
    }));
    const ownedEngine = (engine = createEngine({
      WebContentsView,
      Menu,
      dialog,
      shortcut: (key) => {
        if (window === ownedWindow) ownedWindow.webContents.send(channel + "-shortcut", key);
      },
      window: ownedWindow,
      browserSession: session,
      workspace,
      context,
      takeover: () => {
        if (window === ownedWindow && runner?.active) {
          runner.stop();
          notice = "Управление у вас. Для новой задачи потребуется новое разрешение.";
          tell();
        }
      },
      searchProvider: async (query, signal) => {
        const current = await identity();
        if (window !== ownedWindow || !same(current, context))
          throw Error("COMPUTER_IDENTITY_CHANGED");
        const privacy = await planner.request("/api/v1/personal-settings/privacy", {
          expected: context,
          signal
        });
        if (privacy.lifecycle !== "active") throw Error("COMPUTER_PRIVACY_BLOCKED");
        return planner.request("/api/v1/web-search", {
          method: "POST",
          body: { q: query, engine: "duckduckgo" },
          expected: context,
          signal
        });
      },
      notify: (value) => {
        if (window === ownedWindow && same(bound, context)) tell(value);
      }
    }));
    const ownedDriver =
      executionMode === "work"
        ? (workDriver = require("../work-cycle-driver.cjs").createWorkCycleDriver({
            browser: ownedEngine,
            computer: createComputer(),
            identity,
            notify: () => {
              if (window === ownedWindow) tell();
            },
            onEnvironment: (environment) => {
              if (window !== ownedWindow) throw Error("COMPUTER_SESSION_STOPPED");
              if (environment === "computer") ownedWindow.minimize();
              else {
                ownedWindow.restore();
                ownedWindow.show();
                ownedWindow.focus();
              }
            },
            confirmEnvironment: async (value) => {
              if (window !== ownedWindow || !same(bound, value.context)) return false;
              const answer = await dialog.showMessageBox(ownedWindow, {
                type: "question",
                title: "Koswork · Доступ к среде",
                defaultId: 1,
                cancelId: 1,
                signal: value.signal,
                buttons: ["Разрешить для задачи", "Отмена"],
                message:
                  value.environment === "computer"
                    ? "Разрешить управление вашим ПК?"
                    : "Разрешить работу в браузере Koswork?",
                detail:
                  value.goal +
                  "\n\n" +
                  (value.environment === "computer"
                    ? "Модель получит снимки основного монитора и сможет открывать приложения, работать с окнами, мышью и клавиатурой в пределах цели. На экране могут быть личные данные. Это отдельное разрешение, доступ к браузеру его не заменяет."
                    : "Модель получит текст и элементы страниц отдельного браузера; снимки страниц — по запросу. Это не разрешает управление рабочим столом.") +
                  "\nРазрешение действует только до остановки текущей задачи. Важные действия подтверждаются отдельно. Остановка: Ctrl+Alt+Shift+K."
              });
              return answer.response === 0;
            }
          }))
        : ownedEngine;
    const ownedRunner = (runner = createRunner({
      driver: ownedDriver,
      planner,
      identity,
      workspace,
      history,
      taskGate,
      executionMode,
      allowHumanResume: true,
      notify: (value) => {
        if (window === ownedWindow && same(bound, context))
          ownedWindow.webContents.send(channel + "-event", value);
      },
      confirm: async (value) => {
        if (window !== ownedWindow || !same(bound, context)) return false;
        const answer = await dialog.showMessageBox(ownedWindow, {
          type: "question",
          title: "Koswork · Browser",
          defaultId: 1,
          cancelId: 1,
          signal: value.signal,
          buttons: [value.kind === "session" ? "Разрешить задачу" : "Выполнить действие", "Отмена"],
          message:
            value.kind === "session"
              ? executionMode === "work"
                ? "Начать общую задачу Koswork?"
                : "Разрешить агенту работать в браузере Koswork?"
              : "Подтвердить действие на сайте?",
          detail:
            value.kind === "session"
              ? `${value.goal}\n\n${executionMode === "work" ? "Сначала агент составит план. Доступ к браузеру и управление ПК запрашиваются отдельно; разрешения не восстанавливаются после перезапуска." : "Агент получит текст и элементы активной страницы; по запросу — снимок только страницы."} Входы и CAPTCHA выполняются вами на паузе. ${value.workspace ? "Выбрана папка: " + value.workspace.name + ". Разрешённые файлы могут передаваться сайту или модели для задачи." : "Рабочая папка не подключена."} Сеанс — до 30 минут и ${stepLimit} шагов. Остановка: Ctrl+Alt+Shift+K или «Забрать управление».`
              : `${value.message}\n\n${JSON.stringify(value.evidence ?? {})}\n\n${JSON.stringify(value.action)}${value.recoveryReview ? "\nПрошлая попытка могла уже изменить данные. Сначала проверьте результат." : ""}`
        });
        return answer.response === 0;
      }
    }));
    ownedWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    ownedWindow.webContents.on("before-input-event", (event, input) => {
      if (
        input?.type === "keyDown" &&
        (input.control || input.meta) &&
        ["l", "t", "w", "r"].includes(input.key?.toLowerCase())
      ) {
        event.preventDefault();
        ownedRunner.stop();
        ownedWindow.webContents.send(channel + "-shortcut", input.key.toLowerCase());
      }
    });
    ownedWindow.webContents.on("will-navigate", (e) => e.preventDefault());
    ownedWindow.webContents.on("render-process-gone", () => {
      if (window === ownedWindow) invalidate();
    });
    ownedWindow.on("unresponsive", () => {
      if (window === ownedWindow) stop();
    });
    ownedWindow.on("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (window === ownedWindow) ownedEngine.resize();
      }, 50);
    });
    ownedWindow.on("closed", () => {
      if (window === ownedWindow) invalidate();
    });
    await ownedWindow.loadFile(path.join(__dirname, "browser.html"));
    await ownedEngine.open();
    try {
      const result = await planner.request("/api/v1/projects", { expected: context });
      if (window === ownedWindow)
        projects = (result.items ?? [])
          .filter((p) => ["DRAFT", "ACTIVE"].includes(p.status))
          .map((p) => ({ id: p.id, title: p.title }));
    } catch {
      notice =
        "Проекты недоступны. Можно просматривать сайты вручную; для агента требуется подключение.";
    }
    if (initial && !projects.some((p) => p.id === initial.project))
      throw Error("COMPUTER_PROJECT_UNAVAILABLE");
    if (window === ownedWindow) tell({ prefill: initial });
    return true;
  }
  ipcMain.handle(channel + "-command", async (e, command, input) => {
    if (!trusted(e) || typeof command !== "string") return { error: "BROWSER_UNTRUSTED" };
    if (command === "state") {
      try {
        return state();
      } catch (error) {
        return failure(error);
      }
    }
    if (command === "stop") {
      stop();
      tell();
      return { stopped: true };
    }
    if (command === "resume") return { resumed: runner?.resume() === true };
    if (command === "revoke-folder") {
      stop();
      await workspace.invalidate();
      tell();
      return { folder: null };
    }
    if (command === "folder") {
      if (pending || runner?.active) return { error: "COMPUTER_BUSY" };
      pending = true;
      selection = new AbortController();
      try {
        const context = await authorize(e);
        const folder = await workspace.connect(context, selection.signal);
        await authorize(e);
        if (selection.signal.aborted) throw Error("COMPUTER_SESSION_STOPPED");
        tell();
        return { folder };
      } catch (error) {
        await workspace.invalidate();
        return failure(error);
      } finally {
        selection = null;
        pending = false;
      }
    }
    if (command === "history") {
      try {
        return {
          items: history.list(await authorize(e)).filter((x) => x.executionMode === executionMode)
        };
      } catch (error) {
        return failure(error);
      }
    }
    if (command === "accept") {
      try {
        if (pending || runner?.active) throw Error("COMPUTER_BUSY");
        return history.accept(await authorize(e), input);
      } catch (error) {
        return failure(error);
      }
    }
    if (command === "start" || command === "recover") {
      if (pending || runner?.active) return { error: "COMPUTER_BUSY" };
      pending = true;
      try {
        const context = await authorize(e);
        let value;
        if (command === "recover") {
          const recovery = history.recovery(context, input);
          if (recovery.executionMode !== executionMode)
            throw Error("COMPUTER_RECOVERY_UNAVAILABLE");
          value = { project: recovery.project, goal: recovery.goal, recovery };
        } else {
          if (
            !input ||
            Object.keys(input).some((k) => !["project", "goal"].includes(k)) ||
            typeof input.goal !== "string" ||
            !input.goal.trim() ||
            input.goal.length > 8000 ||
            typeof input.project !== "string" ||
            !/^[a-zA-Z0-9_-]{1,160}$/.test(input.project)
          )
            throw Error("COMPUTER_PROPOSAL_INVALID");
          value = { project: input.project, goal: input.goal.trim() };
        }
        if (taskGate?.busy) throw Error("COMPUTER_BUSY");
        const ownedRunner = runner;
        if (!globalShortcut.register("CommandOrControl+Alt+Shift+K", () => ownedRunner.stop()))
          throw Error("COMPUTER_STOP_SHORTCUT_UNAVAILABLE");
        shortcutHeld = true;
        const result = await ownedRunner.run({
          ...value,
          maxSteps: stepLimit,
          expectedContext: context
        });
        tell();
        return result;
      } catch (error) {
        return failure(error);
      } finally {
        pending = false;
        releaseShortcut();
        if (trusted(e)) tell();
      }
    }
    // Local manual navigation always takes control away from a running agent.
    if (!["new", "navigate", "switch", "close", "back", "forward", "reload"].includes(command))
      return { error: "BROWSER_COMMAND_INVALID" };
    try {
      if (runner?.active) stop();
      if (selection) selection.abort();
      if (command === "new") await engine.open();
      else if (command === "navigate") {
        const url = address(input);
        if (typeof url === "object") await engine.search(url.query);
        else {
          if (!safeUrl(url)) throw Error("BROWSER_URL_INVALID");
          await engine.navigate(url);
        }
      } else if (["switch", "close"].includes(command)) {
        if (typeof input !== "string" || !/^[a-f0-9]{12}$/.test(input))
          throw Error("BROWSER_STALE");
        if (command === "switch") await engine.activate(input);
        else {
          try {
            await engine.close(input);
          } catch (error) {
            if (error.message !== "BROWSER_DIRTY_TAB") throw error;
            const result = await dialog.showMessageBox(window, {
              type: "question",
              defaultId: 1,
              cancelId: 1,
              buttons: ["Закрыть вкладку", "Отмена"],
              message: "Во вкладке могут быть несохранённые изменения. Закрыть?"
            });
            if (result.response === 0 && trusted(e)) await engine.close(input, true);
          }
        }
      } else await engine.manual(command);
      return state();
    } catch (error) {
      return failure(error);
    }
  });
  return {
    show,
    stop,
    invalidate,
    forget() {
      invalidate();
      workspace.forget();
      return profiles.clear();
    }
  };
}
module.exports = { createKosworkBrowser };
