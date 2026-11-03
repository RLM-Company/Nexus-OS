"use strict";
const fs = require("node:fs"),
  path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createLocalVault } = require("./local-vault.cjs");
function createVaultConsole({
  BrowserWindow,
  ipcMain,
  dialog,
  profileDirectory,
  codec,
  identity,
  getEpoch,
  getMainWindow,
  getSession
}) {
  const vault = createLocalVault({ userDataPath: profileDirectory, codec });
  const page = pathToFileURL(path.join(__dirname, "vault.html")).toString();
  let window = null,
    bound = null,
    epoch = null,
    busy = false,
    pending = null;
  const same = (a, b) => a && b && a.owner === b.owner && a.origin === b.origin;
  const trusted = (e) =>
    window &&
    !window.isDestroyed() &&
    e?.sender === window.webContents &&
    e.senderFrame === window.webContents.mainFrame &&
    e.senderFrame.url === page &&
    window.webContents.getURL() === page;
  async function authorized(e) {
    if (!trusted(e) || epoch !== getEpoch()) throw Error("VAULT_IDENTITY");
    const current = await identity();
    if (!trusted(e) || epoch !== getEpoch() || !same(current, bound)) throw Error("VAULT_IDENTITY");
    return current;
  }
  async function show() {
    const start = getEpoch(),
      context = await identity();
    if (!context || start !== getEpoch()) throw Error("VAULT_IDENTITY");
    if (window && !window.isDestroyed()) {
      if (same(bound, context) && epoch === start) {
        window.show();
        window.focus();
        return;
      }
      window.destroy();
    }
    bound = context;
    epoch = start;
    const next = new BrowserWindow({
      parent: getMainWindow() || undefined,
      width: 760,
      height: 650,
      minWidth: 520,
      minHeight: 400,
      title: "Kosmora — Локальное хранилище",
      backgroundColor: "#ffffff",
      webPreferences: {
        preload: path.join(__dirname, "vault-preload.cjs"),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        partition: "kosmora-local-vault"
      }
    });
    window = next;
    next.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    next.webContents.on("will-navigate", (e) => e.preventDefault());
    next.webContents.on("will-redirect", (e) => e.preventDefault());
    next.on("closed", () => {
      if (window === next) {
        window = null;
        bound = null;
        epoch = null;
      }
    });
    await next.loadURL(page);
  }
  ipcMain.handle("kosmora:vault-command", async (e, command, value) => {
    if (busy) return { ok: false, message: "Дождитесь завершения операции." };
    busy = true;
    try {
      const c = await authorized(e);
      if (command === "status") return { ok: true, data: vault.status(c) };
      if (command === "choose") {
        const selected = await dialog.showOpenDialog(window, {
          title: "Папка локального хранилища Kosmora",
          properties: ["openDirectory", "dontAddToRecent"]
        });
        await authorized(e);
        return {
          ok: true,
          data: selected.canceled ? vault.status(c) : vault.choose(c, selected.filePaths[0])
        };
      }
      if (command === "disconnect") {
        pending = null;
        return { ok: true, data: vault.disconnect(c) };
      }
      if (command === "import") {
        const selected = await dialog.showOpenDialog(window, {
          title: "Оригинал для локального хранения",
          properties: ["openFile", "dontAddToRecent"]
        });
        await authorized(e);
        if (!selected.canceled) {
          const file = selected.filePaths[0],
            stat = fs.lstatSync(file);
          if (
            !stat.isFile() ||
            stat.isSymbolicLink() ||
            stat.nlink !== 1 ||
            stat.size > 10 * 1024 * 1024
          )
            throw Error("VAULT_FILE_INVALID");
          const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
          let bytes;
          try {
            const after = fs.fstatSync(fd);
            if (after.ino !== stat.ino || after.dev !== stat.dev || after.size !== stat.size)
              throw Error("VAULT_FILE_CHANGED");
            bytes = Buffer.alloc(after.size);
            let at = 0;
            while (at < bytes.length) {
              const n = fs.readSync(fd, bytes, at, bytes.length - at, at);
              if (!n) throw Error("VAULT_FILE_CHANGED");
              at += n;
            }
          } finally {
            fs.closeSync(fd);
          }
          vault.put(c, path.basename(file), bytes);
        }
        return { ok: true, data: vault.list(c) };
      }
      if (command === "snapshot") {
        const url = c.origin + "/api/v1/memory/local-snapshot";
        const response = await getSession().fetch(url, {
          redirect: "manual",
          cache: "no-store",
          credentials: "include",
          bypassCustomProtocolHandlers: true,
          signal: AbortSignal.timeout(15000)
        });
        if (
          response.status !== 200 ||
          response.redirected ||
          (response.url && response.url !== url) ||
          !/^application\/json/i.test(response.headers.get("content-type") || "")
        )
          throw Error("VAULT_SNAPSHOT_FAILED");
        const reader = response.body.getReader(),
          chunks = [];
        let count = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            count += value.byteLength;
            if (count > 4 * 1024 * 1024) throw Error("VAULT_LIMIT");
            chunks.push(Buffer.from(value));
          }
        } finally {
          await reader.cancel().catch(() => {});
        }
        await authorized(e);
        const bytes = Buffer.concat(chunks),
          data = JSON.parse(bytes.toString("utf8"));
        if (data.format !== "kosmora.memory-snapshot.v1" || !Array.isArray(data.entries))
          throw Error("VAULT_SNAPSHOT_FAILED");
        vault.put(
          c,
          "memory-" + new Date().toISOString().replace(/[:.]/g, "-") + ".json",
          bytes,
          "memory"
        );
        return { ok: true, data: vault.list(c) };
      }
      if (command === "search") return { ok: true, data: vault.search(c, value) };
      if (command === "preview") return { ok: true, text: vault.context(c, value) };
      if (command === "send") {
        const text = vault.context(c, value);
        const choice = await dialog.showMessageBox(window, {
          type: "question",
          buttons: ["Отмена", "Передать в черновик чата"],
          defaultId: 0,
          cancelId: 0,
          message: "Передать выбранный локальный текст в Kosmora?",
          detail:
            "До 12 000 символов попадут в черновик. Они будут отправлены серверу и модели только после нажатия отправки сообщения."
        });
        await authorized(e);
        if (choice.response === 1) {
          pending = {
            id: require("node:crypto").randomUUID(),
            text,
            context: c,
            epoch: getEpoch()
          };
          getMainWindow()?.webContents.send("kosmora:vault-context-ready");
        }
        return { ok: true };
      }
      if (command === "export") {
        const { item, bytes } = vault.get(c, value),
          choice = await dialog.showSaveDialog(window, {
            title: "Сохранить копию оригинала",
            defaultPath: item.name,
            properties: ["dontAddToRecent"]
          });
        await authorized(e);
        if (!choice.canceled && choice.filePath)
          fs.writeFileSync(choice.filePath, bytes, { flag: "wx", mode: 0o600 });
        return { ok: true };
      }
      if (command === "remove") {
        const choice = await dialog.showMessageBox(window, {
          type: "warning",
          buttons: ["Отмена", "Удалить локальную копию"],
          defaultId: 0,
          cancelId: 0,
          message: "Удалить только выбранную копию из локального хранилища?",
          detail: "Исходный файл и данные сервера сохранятся."
        });
        await authorized(e);
        return { ok: true, data: choice.response === 1 ? vault.remove(c, value) : vault.list(c) };
      }
      throw Error("VAULT_COMMAND_INVALID");
    } catch (error) {
      const messages = {
        VAULT_CONTEXT_LIMIT: "Текст слишком большой для передачи целиком. Выберите меньший файл.",
        VAULT_TEXT_ONLY:
          "Этот оригинал можно сохранить копией. Текстовый поиск и передача пока поддерживают текстовые файлы.",
        VAULT_IDENTITY: "Нужен подтверждённый вход в тот же аккаунт.",
        VAULT_FILE_CHANGED: "Локальный файл изменился или повреждён. Он не будет использован.",
        VAULT_LIMIT: "Достигнут предел хранилища или операции.",
        EEXIST: "Файл уже существует. Выберите новое имя."
      };
      return {
        ok: false,
        message:
          messages[error.code || error.message] ||
          "Хранилище недоступно. Проверьте папку, файл и вход в аккаунт."
      };
    } finally {
      busy = false;
    }
  });
  return {
    show,
    invalidate() {
      pending = null;
      window?.destroy();
      bound = null;
      epoch = null;
    },
    async readContext() {
      const c = await identity();
      if (!pending || pending.epoch !== getEpoch() || !same(pending.context, c)) return null;
      return { id: pending.id, text: pending.text };
    },
    async ackContext(id) {
      const c = await identity();
      if (pending?.id === id && pending.epoch === getEpoch() && same(pending.context, c))
        pending = null;
    }
  };
}
module.exports = { createVaultConsole };
