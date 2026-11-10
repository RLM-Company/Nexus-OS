"use strict";
const path = require("node:path"),
  { pathToFileURL } = require("node:url");
const { createBrowserEngine } = require("./engine.cjs");
const { createComputerApiClient } = require("../computer-api-client.cjs");
const { ComputerSession } = require("../computer-session.cjs");
const { address, safeUrl } = require("./policy.cjs");
const { createWorkResultRelay } = require("../work-result.cjs");
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
  const resultRelay = createWorkResultRelay();
  let showQueue = Promise.resolve();
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
    correctionPending = false,
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
    vaultAvailable: executionMode === "work" && typeof workspace.connectVault === "function",
    vaultAccess: Boolean(bound && workspace.vaultState?.(bound)),
    workTask: workDriver?.state() ?? null
  });
  const tell = (value) => {
    if (window && !window.isDestroyed())
      window.webContents.send(channel + "-state", { ...state(), ...value });
  };
  const same = (a, b) => !!a && !!b && a.origin === b.origin && a.owner === b.owner;
  async function authorize(e, signal) {
    const revision = epoch,
      context = bound,
      current = await identity();
    if (!trusted(e) || revision !== epoch || !same(context, current))
      throw Error("COMPUTER_IDENTITY_CHANGED");
    const privacy = await planner.request("/api/v1/personal-settings/privacy", {
      expected: context,
      ...(signal ? { signal } : {})
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
    resultRelay.cancel();
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
  /**
   * `bindingOptions.requestId` and `bindingOptions.document` are supplied by the
   * trusted originating-window callback, not generated here. The relay checks
   * their shape and binds the native completion receipt to this exact request.
   */
  function show(initial, onResult = null, expectedContext = null, bindingOptions = null) {
    const requestedEpoch = epoch;
    const queued = showQueue.then(() => {
      if (initial && requestedEpoch !== epoch) throw Error("COMPUTER_CANCELLED");
      return showNow(initial, onResult, expectedContext, bindingOptions);
    });
    showQueue = queued.then(
      () => {},
      () => {}
    );
    return queued;
  }
  async function showNow(initial, onResult, expectedContext, bindingOptions) {
    if (expectedContext && window && !same(bound, expectedContext))
      throw Error("COMPUTER_IDENTITY_CHANGED");
    if (window && !window.isDestroyed()) {
      if (initial && (pending || runner?.active)) throw Error("COMPUTER_BUSY");
      if (initial) {
        const ownedWindow = window,
          revision = epoch,
          context = bound;
        const result = await planner.request("/api/v1/projects", { expected: context });
        const currentOwner = await identity();
        if (window !== ownedWindow || revision !== epoch || !same(context, currentOwner))
          throw Error("COMPUTER_IDENTITY_CHANGED");
        if (pending || runner?.active) throw Error("COMPUTER_BUSY");
        projects = (result.items ?? [])
          .filter((p) => ["DRAFT", "ACTIVE"].includes(p.status))
          .map((p) => ({ id: p.id, title: p.title }));
        if (!projects.some((p) => p.id === initial.project))
          throw Error("COMPUTER_PROJECT_UNAVAILABLE");
        resultRelay.bind(context, initial, onResult, bindingOptions);
        tell({ prefill: initial });
      }
      window.show();
      window.focus();
      return true;
    }
    const revision = epoch,
      context = await identity();
    if (!context || revision !== epoch) throw Error("COMPUTER_OWNER_UNVERIFIED");
    if (expectedContext && !same(context, expectedContext))
      throw Error("COMPUTER_IDENTITY_CHANGED");
    const privacy = await planner.request("/api/v1/personal-settings/privacy", {
      expected: context
    });
    if (privacy.lifecycle !== "active") throw Error("COMPUTER_PRIVACY_BLOCKED");
    const session = await profiles.get(context);
    const currentOwner = await identity();
    if (revision !== epoch || !same(context, currentOwner))
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
          stop();
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
              ? `${value.goal}\n\n${value.reference ? (value.reference.format === "koswork.confirmed-correction.v1" ? "Подтверждённое исправление: " + value.reference.guidance + "\nУсловие: " + value.reference.applies_when : "Пример из истории: " + value.reference.source_goal) + "\nВыбранные данные будут переданы модели. Старые разрешения и действия не переносятся.\n\n" : ""}${executionMode === "work" ? "Сначала агент составит план. Доступ к браузеру и управление ПК запрашиваются отдельно; разрешения не восстанавливаются после перезапуска." : "Агент получит текст и элементы активной страницы; по запросу — снимок только страницы."} Входы и CAPTCHA выполняются вами на паузе. ${value.workspace ? "Выбрана папка: " + value.workspace.name + ". Разрешённые файлы могут передаваться сайту или модели для задачи." : "Рабочая папка не подключена."} Сеанс — до 30 минут и ${stepLimit} шагов. Остановка: Ctrl+Alt+Shift+K или «Забрать управление».`
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
        if (window === ownedWindow) stop();
        else ownedRunner.stop();
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
    const finalOwner = await identity();
    if (window !== ownedWindow || revision !== epoch || !same(context, finalOwner))
      throw Error("COMPUTER_IDENTITY_CHANGED");
    if (initial && !projects.some((p) => p.id === initial.project))
      throw Error("COMPUTER_PROJECT_UNAVAILABLE");
    if (window === ownedWindow) {
      if (initial) resultRelay.bind(context, initial, onResult, bindingOptions);
      tell({ prefill: initial });
    }
    return true;
  }
  ipcMain.handle(channel + "-command", async (e, command, input) => {
    if (!trusted(e) || typeof command !== "string") return { error: "BROWSER_UNTRUSTED" };
    if (correctionPending && !["state", "stop", "history"].includes(command))
      return { error: "COMPUTER_BUSY" };
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
    if (command === "vault" || command === "revoke-vault") {
      if (executionMode !== "work" || typeof workspace.connectVault !== "function")
        return { error: "COMPUTER_ACTION_INVALID" };
      if (command === "revoke-vault") {
        stop();
        workspace.revokeVault();
        tell();
        return { revoked: true };
      }
      if (pending || runner?.active) return { error: "COMPUTER_BUSY" };
      pending = true;
      selection = new AbortController();
      try {
        const context = await authorize(e);
        const folder = await workspace.connectVault(
          context,
          selection.signal,
          async ({ files }) => {
            const answer = await dialog.showMessageBox(window, {
              type: "question",
              buttons: ["Отмена", "Разрешить чтение для задачи"],
              defaultId: 0,
              cancelId: 0,
              message: "Разрешить Koswork поиск в локальном хранилище?",
              detail: `В хранилище ${files} файлов. Агент сможет искать и читать текстовые фрагменты; эти данные передаются серверу и модели для задачи. Изменение файлов хранилища и загрузка из него на сайты запрещены. Доступ прекратится после завершения или остановки задачи. Для записи результата подключите отдельную рабочую папку до выдачи этого разрешения.`
            });
            return answer.response === 1;
          }
        );
        await authorize(e);
        if (selection.signal.aborted) throw Error("COMPUTER_SESSION_STOPPED");
        tell();
        return { folder };
      } catch (error) {
        workspace.revokeVault();
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
    if (
      ["correction", "save-correction", "remove-correction", "suggest-corrections"].includes(
        command
      )
    ) {
      let consent = null,
        claimed = false;
      try {
        if (executionMode !== "work") throw Error("COMPUTER_REFERENCE_UNAVAILABLE");
        if (["save-correction", "remove-correction"].includes(command)) {
          if ((pending && !runner?.active) || (command === "save-correction" && runner?.active))
            throw Error("COMPUTER_BUSY");
          correctionPending = claimed = true;
          consent = selection = new AbortController();
        }
        const generation = epoch,
          context = await authorize(e, consent?.signal);
        if (command === "suggest-corrections") {
          if (
            !input ||
            Object.keys(input).length !== 2 ||
            typeof input.goal !== "string" ||
            input.goal.length > 8000 ||
            !projects.some((p) => p.id === input.project)
          )
            throw Error("COMPUTER_REFERENCE_UNAVAILABLE");
          return { items: history.suggestCorrections(context, input.project, input.goal) };
        }
        const keys =
          command === "correction"
            ? ["taskId"]
            : command === "save-correction"
              ? ["taskId", "revision", "correction"]
              : ["taskId", "revision"];
        if (
          !input ||
          Object.keys(input).length !== keys.length ||
          keys.some((key) => !Object.hasOwn(input, key))
        )
          throw Error("COMPUTER_REFERENCE_UNAVAILABLE");
        const item = history
          .list(context)
          .find(
            (record) =>
              record.id === input.taskId &&
              record.correctable &&
              projects.some((p) => p.id === record.project)
          );
        if (!item) throw Error("COMPUTER_REFERENCE_UNAVAILABLE");
        const draft = history.correction(context, item.id);
        if (command === "correction") return draft;
        if ((pending && !runner?.active) || (command === "save-correction" && runner?.active))
          throw Error("COMPUTER_BUSY");
        if (draft.revision !== input.revision) throw Error("COMPUTER_REFERENCE_CHANGED");
        if (command === "remove-correction" && !draft.correction)
          throw Error("COMPUTER_REFERENCE_UNAVAILABLE");
        const correction =
          command === "save-correction"
            ? require("../work-experience.cjs").correctionText(input.correction)
            : null;
        const answer = await dialog.showMessageBox(window, {
          type: "question",
          defaultId: 0,
          cancelId: 0,
          signal: consent.signal,
          buttons: ["Отмена", correction ? "Подтвердить исправление" : "Удалить исправление"],
          message: correction
            ? "Сохранить исправление для похожих задач проекта?"
            : "Удалить подтверждённое исправление?",
          detail: correction
            ? `Источник: ${draft.source_goal}\n\nОшибка: ${correction.issue}\nПравильный подход: ${correction.guidance}\nКогда применять: ${correction.applies_when}\n\nИсправление хранится локально и передаётся модели только после выбора для задачи. Оно не расширяет права агента.`
            : "Исправление будет удалено из локальной истории. Задача, использующая его сейчас, будет остановлена. История исходной задачи останется."
        });
        if (answer.response !== 1) throw Error("COMPUTER_CANCELLED");
        const after = await authorize(e, consent.signal);
        if (generation !== epoch || consent.signal.aborted || !same(context, after))
          throw Error("COMPUTER_SESSION_STOPPED");
        if (history.correction(context, item.id).revision !== input.revision)
          throw Error("COMPUTER_REFERENCE_CHANGED");
        if (!correction && runner?.active?.reference?.taskId === item.id) stop();
        return correction
          ? history.saveCorrection(context, item.id, input.revision, correction)
          : history.removeCorrection(context, item.id, input.revision);
      } catch (error) {
        return failure(consent?.signal.aborted ? Error("COMPUTER_SESSION_STOPPED") : error);
      } finally {
        if (claimed) {
          if (selection === consent) selection = null;
          correctionPending = false;
        }
      }
    }
    if (command === "reference") {
      try {
        if (executionMode !== "work" || pending || runner?.active)
          throw Error("COMPUTER_REFERENCE_UNAVAILABLE");
        const context = await authorize(e),
          requested = typeof input === "string" ? { taskId: input } : input,
          item = history
            .list(context)
            .find((r) => r.id === requested?.taskId && r.reusable && r.executionMode === "work");
        if (!item || !projects.some((p) => p.id === item.project))
          throw Error("COMPUTER_REFERENCE_UNAVAILABLE");
        if (
          typeof input !== "string" &&
          (!input || Object.keys(input).length !== 2 || !/^[a-f0-9]{64}$/.test(input.revision))
        )
          throw Error("COMPUTER_REFERENCE_UNAVAILABLE");
        const source = history.reference(
          context,
          item.project,
          item.id,
          requested.revision ?? null
        );
        if (source.format === "koswork.confirmed-correction.v1" && !requested.revision)
          throw Error("COMPUTER_REFERENCE_CHANGED");
        return {
          project: item.project,
          goal: item.goal,
          reference: { taskId: item.id, revision: source.revision }
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
      let completion = null;
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
            Object.keys(input).some((k) => !["project", "goal", "reference"].includes(k)) ||
            typeof input.goal !== "string" ||
            !input.goal.trim() ||
            input.goal.length > 8000 ||
            typeof input.project !== "string" ||
            !/^[a-zA-Z0-9_-]{1,160}$/.test(input.project)
          )
            throw Error("COMPUTER_PROPOSAL_INVALID");
          if (input.reference && executionMode !== "work")
            throw Error("COMPUTER_REFERENCE_UNAVAILABLE");
          value = {
            project: input.project,
            goal: input.goal.trim(),
            reference: input.reference ?? null
          };
        }
        if (taskGate?.busy) throw Error("COMPUTER_BUSY");
        completion = resultRelay.claim(context, value.project, value.goal);
        // Native-only one-shot receipt identity comes from the actual relay
        // ticket. It grants no file, model, screen or owner-acceptance authority
        // and carries no private paths. A model cannot invent its binding.
        const binding = completion ? resultRelay.ticketFor(completion) : null;
        const resultTicket = binding
          ? {
              task_id: binding.taskId,
              request_id: binding.requestId,
              nonce: binding.nonce,
              project: binding.project,
              document: binding.document
            }
          : null;
        const ownedRunner = runner;
        if (
          !globalShortcut.register("CommandOrControl+Alt+Shift+K", () => {
            if (runner === ownedRunner) stop();
            else ownedRunner.stop();
          })
        )
          throw Error("COMPUTER_STOP_SHORTCUT_UNAVAILABLE");
        shortcutHeld = true;
        const result = await ownedRunner.run({
          ...value,
          maxSteps: stepLimit,
          expectedContext: context,
          ...(resultTicket ? { resultTicket } : {})
        });
        resultRelay.finish(completion, result);
        tell();
        return result;
      } catch (error) {
        resultRelay.finish(completion, {
          status:
            ["COMPUTER_CANCELLED", "COMPUTER_SESSION_STOPPED"].includes(error?.message) ||
            error?.name === "AbortError"
              ? "cancelled"
              : "failed"
        });
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
    async canReturnResult(context, project) {
      const owned = window,
        revision = epoch;
      if (!owned || owned.isDestroyed() || !same(bound, context)) return false;
      try {
        if (!same(await identity(), context)) return false;
        const privacy = await planner.request("/api/v1/personal-settings/privacy", {
          expected: context
        });
        const found = await planner.request("/api/v1/projects", { expected: context });
        const finalOwner = await identity();
        return (
          privacy.lifecycle === "active" &&
          (found.items ?? []).some(
            (p) => p.id === project && ["ACTIVE", "DRAFT"].includes(p.status)
          ) &&
          window === owned &&
          revision === epoch &&
          same(bound, context) &&
          same(finalOwner, context)
        );
      } catch {
        return false;
      }
    },
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
