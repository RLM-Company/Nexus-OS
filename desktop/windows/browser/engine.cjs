"use strict";
const { randomBytes, randomUUID } = require("node:crypto");
const { setTimeout: delay } = require("node:timers/promises");
const { safeUrl, agentUrl } = require("./policy.cjs");
const documentCode = require("./document.cjs");

const HOME = "about:blank";
function createBrowserEngine({
  WebContentsView,
  Menu,
  dialog,
  shortcut = () => {},
  window,
  browserSession,
  workspace,
  context,
  notify = () => {},
  takeover = () => {},
  commandTimeout = 3000,
  now = Date.now
}) {
  const tabs = new Map();
  let active = null,
    last = null,
    stopped = false,
    wantImage = false,
    automated = 0;
  const downloads = [],
    intents = new Map();
  const bounds = () => {
    const [width, height] = window.getContentSize();
    return { x: 0, y: 100, width: Math.max(1, width - 320), height: Math.max(1, height - 100) };
  };
  const live = () => {
    if (stopped || window.isDestroyed()) throw Error("COMPUTER_SESSION_STOPPED");
  };
  const emit = () => {
    if (!stopped) notify(state());
  };
  function invalidate(tab) {
    tab.version++;
    tab.world = null;
    last = null;
  }
  function state() {
    return {
      active,
      tabs: [...tabs.values()].map((t) => ({
        id: t.id,
        title: t.title,
        url: t.url,
        loaded: !!t.view && !t.view.webContents.isDestroyed(),
        loading: !!t.view && !t.view.webContents.isDestroyed() && t.view.webContents.isLoading(),
        dirty: t.dirty,
        error: t.error || null
      })),
      liveTabs: [...tabs.values()].filter((t) => t.view).length,
      maxLiveTabs: 3,
      maxTabs: 8,
      downloads: downloads.map(({ item, path, ...d }) => d)
    };
  }
  function detach(tab) {
    if (!tab.view) return;
    window.contentView.removeChildView(tab.view);
    tab.view.webContents.close({ waitForBeforeUnload: false });
    tab.view = null;
    invalidate(tab);
  }
  function send(web, method, args) {
    let timer;
    return Promise.race([
      web.debugger.sendCommand(method, args),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error("BROWSER_DOM_TIMEOUT")), commandTimeout);
        timer.unref?.();
      })
    ]).finally(() => clearTimeout(timer));
  }
  async function world(tab) {
    live();
    if (!tab.view) throw Error("BROWSER_STALE");
    const web = tab.view.webContents;
    if (!web.debugger.isAttached()) web.debugger.attach("1.3");
    if (!tab.world) {
      const { frameTree } = await send(web, "Page.getFrameTree");
      const { executionContextId } = await send(web, "Page.createIsolatedWorld", {
        frameId: frameTree.frame.id,
        worldName: "koswork-browser-observer"
      });
      tab.world = executionContextId;
    }
    return web;
  }
  async function evaluate(tab, fn, args, byValue = true) {
    let result;
    try {
      const web = await world(tab);
      result = await send(web, "Runtime.callFunctionOn", {
        functionDeclaration: fn,
        executionContextId: tab.world,
        arguments: args.map((value) => ({ value })),
        returnByValue: byValue,
        awaitPromise: false,
        userGesture: false
      });
    } catch (error) {
      if (
        /context.*(?:specified|destroyed|not found)|Cannot find.*context|frame.*not found/i.test(
          error.message
        )
      ) {
        tab.world = null;
        throw Error("BROWSER_STALE");
      }
      throw error;
    }
    live();
    if (result.exceptionDetails) throw Error("BROWSER_ELEMENT_UNAVAILABLE");
    return byValue ? result.result.value : result.result;
  }
  async function canSleep(tab) {
    if (
      tab.id === active ||
      !tab.view ||
      tab.dirty ||
      tab.view.webContents.isLoading() ||
      tab.view.webContents.isCurrentlyAudible() ||
      downloads.some((d) => d.tab === tab.id && d.status === "progressing")
    )
      return false;
    try {
      return await evaluate(
        tab,
        `function(){const nodes=document.querySelectorAll('input,textarea,select,[contenteditable=true]');if(nodes.length>500)return false;return !Array.from(nodes).some(e=>e.isContentEditable||(e.type==='checkbox'||e.type==='radio'?e.checked!==e.defaultChecked:e.tagName==='SELECT'?Array.from(e.options).some(o=>o.selected!==o.defaultSelected):!!e.value&&e.value!==e.defaultValue));}`,
        []
      );
    } catch {
      return false;
    }
  }
  async function room() {
    if ([...tabs.values()].filter((t) => t.view).length < 3) return;
    for (const candidate of [...tabs.values()].sort((a, b) => a.touched - b.touched))
      if (await canSleep(candidate)) {
        detach(candidate);
        return;
      }
    throw Error("BROWSER_TAB_LIMIT");
  }
  function wire(tab) {
    const web = tab.view.webContents;
    web.setWindowOpenHandler(() => {
      tab.error = "Всплывающее окно заблокировано. Откройте нужную ссылку отдельной вкладкой.";
      emit();
      return { action: "deny" };
    });
    for (const event of ["will-navigate", "will-frame-navigate", "will-redirect"])
      web.on(event, (ev, url) => {
        const destination = typeof url === "string" ? url : ev.url;
        if (destination && !safeUrl(destination)) {
          ev.preventDefault();
          tab.error = "Этот тип адреса не поддерживается.";
          emit();
        }
      });
    web.on("did-start-navigation", (_e, url, _inPlace, mainFrame) => {
      if (mainFrame) {
        invalidate(tab);
        if (safeUrl(url)) tab.url = url;
      }
    });
    web.on("did-navigate", (_e, url) => {
      tab.url = url;
      tab.dirty = false;
      tab.error = null;
      invalidate(tab);
      emit();
    });
    web.on("did-navigate-in-page", (_e, url, main) => {
      if (main) {
        tab.url = url;
        invalidate(tab);
        emit();
      }
    });
    web.on("page-title-updated", (_e, title) => {
      tab.title = String(title).slice(0, 180);
      emit();
    });
    for (const event of ["did-start-loading", "did-stop-loading"]) web.on(event, emit);
    web.on("did-fail-load", (_e, code, _description, _url, main) => {
      if (main && code !== -3) {
        tab.error = "Страница не загрузилась. Проверьте адрес и соединение.";
        emit();
      }
    });
    web.on("before-input-event", (event, input) => {
      tab.dirty = true;
      if (!automated) {
        takeover();
        if (
          input?.type === "keyDown" &&
          (input.control || input.meta) &&
          ["l", "t", "w", "r"].includes(input.key?.toLowerCase())
        ) {
          event.preventDefault();
          shortcut(input.key.toLowerCase());
        }
      }
    });
    if (Menu && dialog)
      web.on("context-menu", (_event, params) => {
        const url = safeUrl(params.linkURL || "");
        if (!url) return;
        Menu.buildFromTemplate([
          {
            label: "Открыть ссылку в новой вкладке",
            click: () => {
              takeover();
              void open(url).catch(() => {});
            }
          },
          {
            label: "Скачать ссылку в рабочую папку",
            click: async () => {
              try {
                takeover();
                const selected = workspace.snapshot(context);
                if (!selected) throw Error("COMPUTER_WORKSPACE_UNAVAILABLE");
                const answer = await dialog.showMessageBox(window, {
                  type: "question",
                  defaultId: 1,
                  cancelId: 1,
                  buttons: ["Скачать", "Отмена"],
                  message: "Скачать файл в выбранную рабочую папку?",
                  detail:
                    url +
                    "\n\nПапка: " +
                    selected.name +
                    ". До 25 МиБ; существующие файлы не заменяются."
                });
                if (answer.response !== 0) return;
                live();
                if (workspace.snapshot(context)?.id !== selected.id)
                  throw Error("COMPUTER_WORKSPACE_CHANGED");
                intents.set(tab.id, { url, workspaceId: selected.id, expires: now() + 10000 });
                web.downloadURL(url);
              } catch {
                notify({
                  ...state(),
                  notice: "Не удалось начать загрузку. Подключите рабочую папку и проверьте ссылку."
                });
              }
            }
          }
        ]).popup({ window });
      });
    web.on("render-process-gone", () => {
      tab.error = "Вкладка остановлена. Её можно перезагрузить.";
      tab.dirty = true;
      invalidate(tab);
      takeover();
      emit();
    });
    web.on("will-prevent-unload", () => {
      tab.dirty = true;
    });
  }
  async function activate(id, signal) {
    if (signal?.aborted) throw Error("COMPUTER_SESSION_STOPPED");
    live();
    const tab = tabs.get(id);
    if (!tab) throw Error("BROWSER_STALE");
    if (tab.view?.webContents.isDestroyed()) {
      window.contentView.removeChildView(tab.view);
      tab.view = null;
    }
    if (!tab.view && tab.url !== HOME) {
      await room();
      live();
      if (signal?.aborted) throw Error("COMPUTER_SESSION_STOPPED");
      tab.view = new WebContentsView({
        webPreferences: {
          session: browserSession,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          spellcheck: false,
          backgroundThrottling: true,
          autoplayPolicy: "document-user-activation-required"
        }
      });
      wire(tab);
      window.contentView.addChildView(tab.view);
      tab.view.setVisible(false);
      if (tab.url !== HOME) void tab.view.webContents.loadURL(tab.url).catch(() => {});
    }
    if (active && tabs.get(active)?.view) tabs.get(active).view.setVisible(false);
    active = id;
    last = null;
    tab.touched = now();
    tab.view?.setBounds(bounds());
    tab.view?.setVisible(tab.url !== HOME);
    emit();
    return tab;
  }
  async function open(url = HOME, signal) {
    if (signal?.aborted) throw Error("COMPUTER_SESSION_STOPPED");
    if (url !== HOME && !safeUrl(url)) throw Error("BROWSER_URL_INVALID");
    live();
    if (tabs.size >= 8) throw Error("BROWSER_TAB_LIMIT");
    const tab = {
      id: randomBytes(6).toString("hex"),
      url,
      title: url === HOME ? "Новая вкладка" : new URL(url).hostname,
      version: 0,
      world: null,
      view: null,
      touched: now(),
      dirty: false
    };
    tabs.set(tab.id, tab);
    try {
      await activate(tab.id, signal);
    } catch (error) {
      tabs.delete(tab.id);
      throw error;
    }
    return tab;
  }
  async function close(id, force = false, signal) {
    const tab = tabs.get(id);
    if (!tab) throw Error("BROWSER_STALE");
    if (!force && (tab.dirty || !(await canSleep({ ...tab, id: "not-active" }))))
      throw Error("BROWSER_DIRTY_TAB");
    detach(tab);
    tabs.delete(id);
    if (active === id) {
      active = null;
      if (tabs.size) await activate([...tabs.keys()].at(-1), signal);
      else await open(HOME, signal);
    }
    emit();
  }
  function expected(observation) {
    live();
    const tab = tabs.get(active);
    if (
      !tab ||
      (tab.url !== HOME && !tab.view) ||
      !last ||
      last.id !== observation.observation_id ||
      last.tab !== active ||
      last.version !== tab.version
    )
      throw Error("BROWSER_STALE");
    return tab;
  }
  function refNode(action, observation) {
    expected(observation);
    const node = last.document.nodes.find((n) => n.ref === action.ref);
    if (!node) throw Error("BROWSER_STALE");
    return node;
  }
  async function target(action, observation) {
    const tab = expected(observation);
    const node = refNode(action, observation);
    const found = await evaluate(tab, documentCode.locate, [last.id, action.ref]);
    if (!found || found.blocked || found.info.signature !== node.signature)
      throw Error("BROWSER_ELEMENT_UNAVAILABLE");
    expected(observation);
    return { tab, web: tab.view.webContents, node, found };
  }
  async function clickPoint(web, x, y, guard = () => {}) {
    guard();
    try {
      await send(web, "Input.dispatchMouseEvent", {
        type: "mousePressed",
        x,
        y,
        button: "left",
        clickCount: 1
      });
    } finally {
      await send(web, "Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x,
        y,
        button: "left",
        clickCount: 1
      });
    }
  }
  async function pressKey(web, key, code, modifiers, guard) {
    guard();
    try {
      await send(web, "Input.dispatchKeyEvent", {
        type: "keyDown",
        key,
        code: key === "a" ? "KeyA" : key,
        modifiers,
        windowsVirtualKeyCode: code,
        ...(key === "Enter" ? { text: "\r" } : {})
      });
    } finally {
      await send(web, "Input.dispatchKeyEvent", {
        type: "keyUp",
        key,
        code: key === "a" ? "KeyA" : key,
        modifiers,
        windowsVirtualKeyCode: code
      });
    }
  }
  async function observe(signal) {
    live();
    if (signal.aborted) throw Error("COMPUTER_SESSION_STOPPED");
    const tab = tabs.get(active) || (await open());
    if (tab.view?.webContents.isLoading()) await delay(200, undefined, { signal });
    const id = randomUUID(),
      version = tab.version;
    const doc =
      tab.url === HOME
        ? {
            url: HOME,
            title: "Новая вкладка",
            text: "Пустая вкладка Koswork. Используйте browser_open, чтобы открыть сайт.",
            nodes: [],
            dirty: false
          }
        : await evaluate(tab, documentCode.capture, [id]);
    if (signal.aborted || version !== tab.version) throw Error("BROWSER_STALE");
    tab.dirty ||= doc.dirty;
    doc.text = doc.text.slice(0, 6000);
    const publicDoc = () =>
      JSON.stringify({
        url: agentUrl(doc.url),
        title: doc.title,
        text: doc.text,
        nodes: doc.nodes.map(({ signature, ...node }) => ({
          ...node,
          href: node.href ? agentUrl(node.href) : ""
        })),
        truncated: doc.truncated,
        downloads: downloads.slice(-5).map(({ item, path, ...d }) => d)
      });
    while (publicDoc().length > 14500 && doc.nodes.length) doc.nodes.pop();
    if (publicDoc().length > 14500) doc.text = doc.text.slice(0, 1000);
    last = { id, tab: active, version, document: doc };
    const size = bounds(),
      observation = {
        observation_id: id,
        active_window: tab.id + ":" + version,
        width: Math.min(8192, doc.viewport?.width || size.width),
        height: Math.min(8192, doc.viewport?.height || size.height),
        description: publicDoc(),
        browser: { tab_id: tab.id, generation: version }
      };
    if (wantImage) {
      wantImage = false;
      if (!tab.view) throw Error("BROWSER_ELEMENT_UNAVAILABLE");
      const image = await tab.view.webContents.capturePage();
      const jpeg = image.resize({ width: Math.min(1100, image.getSize().width) }).toJPEG(60);
      if (jpeg.length > 1000000) throw Error("BROWSER_IMAGE_TOO_LARGE");
      observation.image_jpeg_base64 = jpeg.toString("base64");
    }
    return observation;
  }
  function approvalKey(action, observation) {
    if (!action.kind.startsWith("browser_")) return "";
    const tab = expected(observation);
    const node = action.ref ? refNode(action, observation) : null;
    return JSON.stringify([tab.id, tab.version, tab.url, node?.signature ?? null]);
  }
  function requiresConfirmation(action, observation) {
    if (
      [
        "browser_upload",
        "browser_download",
        "browser_fill",
        "browser_key",
        "browser_click_at",
        "browser_close"
      ].includes(action.kind)
    )
      return true;
    if (action.kind === "browser_click") {
      const node = refNode(action, observation);
      return node.role !== "a" || !safeUrl(node.href) || node.submit === true;
    }
    return false;
  }
  function describe(action, observation) {
    const node = action.ref ? refNode(action, observation) : null;
    return { site: tabs.get(active)?.url, target: node?.name, role: node?.role, path: action.path };
  }
  async function execute(action, observation, signal) {
    live();
    if (signal.aborted) throw Error("COMPUTER_SESSION_STOPPED");
    expected(observation);
    const guard = () => {
      if (signal.aborted) throw Error("COMPUTER_SESSION_STOPPED");
      expected(observation);
    };
    let attemptedInput = false;
    const inputGuard = () => {
      guard();
      attemptedInput = true;
    };
    automated++;
    try {
      const tab = tabs.get(active),
        web = tab.view?.webContents;
      switch (action.kind) {
        case "observe":
        case "browser_read":
          return { observed: true };
        case "wait":
          await delay(action.milliseconds, undefined, { signal });
          return { waited: true };
        case "browser_tabs":
          return {
            tabs: state().tabs.map(({ id, title, url, loaded }) => ({
              id,
              title,
              url: agentUrl(url),
              loaded
            }))
          };
        case "browser_open":
          await open(action.url, signal);
          return { opened: true };
        case "browser_switch":
          await activate(action.tab_id, signal);
          return { selected: true };
        case "browser_close":
          await close(action.tab_id, true, signal);
          return { closed: true };
        case "browser_back":
          if (web.navigationHistory.canGoBack()) web.navigationHistory.goBack();
          return { requested: true };
        case "browser_forward":
          if (web.navigationHistory.canGoForward()) web.navigationHistory.goForward();
          return { requested: true };
        case "browser_reload":
          web.reload();
          return { requested: true };
        case "browser_screenshot":
          wantImage = true;
          return { next_observation_includes_page_image: true };
        case "browser_scroll":
          await world(tab);
          guard();
          await send(web, "Input.dispatchMouseEvent", {
            type: "mouseWheel",
            x: Math.max(1, bounds().width / 2),
            y: Math.max(1, bounds().height / 2),
            deltaX: 0,
            deltaY: (action.direction === "down" ? 1 : -1) * action.amount * 350
          });
          return { requested: true };
        case "browser_click_at":
          if (!observation.image_jpeg_base64) throw Error("BROWSER_STALE");
          await world(tab);
          await clickPoint(
            web,
            action.x * observation.width,
            action.y * observation.height,
            inputGuard
          );
          tab.dirty = true;
          return { requested: true };
        case "browser_click": {
          const t = await target(action, observation);
          await clickPoint(t.web, t.found.x, t.found.y, inputGuard);
          tab.dirty ||= t.node.role !== "a";
          return { requested: true };
        }
        case "browser_fill": {
          const t = await target(action, observation);
          if (
            !["input", "textarea", "textbox"].includes(t.node.role) ||
            t.node.secret ||
            t.node.upload
          )
            throw Error("BROWSER_ELEMENT_UNAVAILABLE");
          await clickPoint(t.web, t.found.x, t.found.y, inputGuard);
          guard();
          await pressKey(t.web, "a", 65, 2, inputGuard);
          inputGuard();
          if (action.text) await send(t.web, "Input.insertText", { text: action.text });
          else await pressKey(t.web, "Backspace", 8, 0, inputGuard);
          tab.dirty = true;
          guard();
          const verified = await evaluate(
            tab,
            `function(snapshot,ref,text){const s=globalThis.__kosworkDocument,e=s?.refs.get(ref);return s?.snapshotId===snapshot&&e?.node.isConnected&&!s.info(e.node).secret&&(e.node.isContentEditable?e.node.innerText:e.node.value)===text;}`,
            [last.id, action.ref, action.text]
          );
          return { requested: true, input_verified: verified === true };
        }
        case "browser_key": {
          const t = await target(action, observation);
          await clickPoint(t.web, t.found.x, t.found.y, inputGuard);
          guard();
          const key = { ENTER: ["Enter", 13], TAB: ["Tab", 9], ESCAPE: ["Escape", 27] }[action.key];
          await pressKey(t.web, key[0], key[1], 0, inputGuard);
          tab.dirty = true;
          return { requested: true };
        }
        case "browser_upload": {
          const t = await target(action, observation);
          if (!t.node.upload) throw Error("BROWSER_ELEMENT_UNAVAILABLE");
          const selected = workspace.snapshot(context);
          const file = workspace.uploadFile(context, selected?.id, action.path);
          const object = await evaluate(tab, documentCode.fileNode, [last.id, action.ref], false);
          guard();
          workspace.uploadFile(context, selected?.id, action.path);
          if (!object.objectId) throw Error("BROWSER_ELEMENT_UNAVAILABLE");
          try {
            inputGuard();
            await send(t.web, "DOM.setFileInputFiles", {
              objectId: object.objectId,
              files: [file]
            });
          } finally {
            await send(t.web, "Runtime.releaseObject", { objectId: object.objectId }).catch(
              () => {}
            );
          }
          tab.dirty = true;
          return { attached: action.path };
        }
        case "browser_download": {
          const t = await target(action, observation);
          if (!safeUrl(t.node.href) || intents.size) throw Error("BROWSER_ELEMENT_UNAVAILABLE");
          const selected = workspace.snapshot(context);
          if (!selected) throw Error("COMPUTER_WORKSPACE_UNAVAILABLE");
          intents.set(tab.id, {
            url: t.node.href,
            workspaceId: selected.id,
            expires: now() + 10000
          });
          web.downloadURL(t.node.href);
          return {
            requested: true,
            instruction:
              "Wait for a completed download in the next observations; requested is not proof of a saved file."
          };
        }
        default:
          throw Error("COMPUTER_ACTION_INVALID");
      }
    } catch (error) {
      if (attemptedInput)
        throw Error(signal.aborted ? "COMPUTER_SESSION_STOPPED" : "BROWSER_INPUT_UNCERTAIN");
      throw error;
    } finally {
      automated--;
    }
  }
  function onDownload(event, item, web) {
    const tab = [...tabs.values()].find((t) => t.view?.webContents === web),
      intent = tab && intents.get(tab.id);
    if (tab) intents.delete(tab.id);
    if (
      stopped ||
      !intent ||
      intent.expires < now() ||
      item.getURLChain()[0] !== intent.url ||
      item.getURLChain().some((url) => !safeUrl(url)) ||
      item.getTotalBytes() > 25 * 1024 * 1024
    ) {
      event.preventDefault();
      downloads.push({
        id: randomBytes(6).toString("hex"),
        tab: tab?.id ?? null,
        name: String(item.getFilename?.() ?? "Загрузка").slice(0, 150),
        status: "blocked",
        bytes: 0
      });
      if (downloads.length > 20) downloads.shift();
      notify({
        ...state(),
        notice: "Загрузка не разрешена. Агенту нужна команда скачивания и выбранная рабочая папка."
      });
      return;
    }
    let reservation;
    try {
      reservation = workspace.reserveDownload(context, intent.workspaceId, item.getFilename());
      item.setSavePath(reservation.path);
    } catch {
      event.preventDefault();
      downloads.push({
        id: randomBytes(6).toString("hex"),
        tab: tab.id,
        name: "Загрузка",
        status: "blocked",
        bytes: 0
      });
      if (downloads.length > 20) downloads.shift();
      emit();
      return;
    }
    const d = {
      id: randomBytes(6).toString("hex"),
      tab: tab.id,
      name: reservation.name,
      status: "progressing",
      bytes: 0,
      item,
      path: reservation.path
    };
    downloads.push(d);
    while (downloads.length > 20) {
      const i = downloads.findIndex((x) => x.status !== "progressing");
      if (i < 0) break;
      downloads.splice(i, 1);
    }
    let lastProgress = 0;
    item.on("updated", () => {
      d.bytes = item.getReceivedBytes();
      if (stopped || d.bytes > 25 * 1024 * 1024) item.cancel();
      if (now() - lastProgress >= 200) {
        lastProgress = now();
        emit();
      }
    });
    item.once("done", (_event, status) => {
      d.bytes = item.getReceivedBytes();
      d.status = status;
      try {
        if (status === "completed")
          workspace.verifyDownload(context, intent.workspaceId, reservation.path, d.bytes);
        else d.status = status === "cancelled" ? "cancelled" : "interrupted";
      } catch {
        d.status = "unverified";
      }
      delete d.item;
      delete d.path;
      emit();
    });
    emit();
  }
  browserSession.setPermissionRequestHandler((_web, _permission, callback) => callback(false));
  browserSession.setPermissionCheckHandler(() => false);
  browserSession.on("will-download", onDownload);
  const timer = setInterval(() => {
    void (async () => {
      if (stopped) return;
      for (const tab of tabs.values())
        if (tab.id !== active && now() - tab.touched > 120000 && (await canSleep(tab))) {
          detach(tab);
          emit();
        }
    })().catch(() => {});
  }, 30000);
  timer.unref?.();
  return {
    reobserveAfterApproval: true,
    state,
    open,
    activate,
    close,
    observe,
    execute,
    isCurrent(observation) {
      try {
        expected(observation);
        return true;
      } catch {
        return false;
      }
    },
    approvalKey,
    requiresConfirmation,
    describe,
    resize() {
      const t = tabs.get(active);
      if (t?.view) {
        t.view.setBounds(bounds());
        invalidate(t);
      }
    },
    manual(command) {
      live();
      const tab = tabs.get(active);
      if (!tab?.view) return;
      const web = tab.view.webContents;
      invalidate(tab);
      if (command === "back" && web.navigationHistory.canGoBack()) web.navigationHistory.goBack();
      else if (command === "forward" && web.navigationHistory.canGoForward())
        web.navigationHistory.goForward();
      else if (command === "reload") web.reload();
    },
    async navigate(url) {
      live();
      if (!safeUrl(url)) throw Error("BROWSER_URL_INVALID");
      const tab = tabs.get(active) || (await open());
      const existed = !!tab.view;
      tab.url = url;
      tab.error = null;
      invalidate(tab);
      await activate(tab.id);
      if (existed) void tab.view.webContents.loadURL(url).catch(() => {});
      tab.view.setVisible(true);
      emit();
    },
    cancel() {
      last = null;
      wantImage = false;
      intents.clear();
      for (const d of downloads) if (d.item) d.item.cancel();
    },
    stop() {
      this.cancel();
    },
    dispose() {
      if (stopped) return;
      this.cancel();
      stopped = true;
      clearInterval(timer);
      browserSession.removeListener("will-download", onDownload);
      for (const tab of tabs.values()) detach(tab);
      tabs.clear();
      active = null;
    }
  };
}
module.exports = { createBrowserEngine };
