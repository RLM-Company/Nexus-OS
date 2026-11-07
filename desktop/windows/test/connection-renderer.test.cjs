"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function renderer() {
  const nodes = new Map();
  const pending = [];
  let state = { origin: "https://saved.example", mode: "offline", connecting: false };
  let changed;
  const bridge = {
    getConnectionState: async () => state,
    onConnectionStateChanged: (fn) => {
      changed = fn;
    },
    connect: () => {
      const request = deferred();
      pending.push(request);
      return request.promise;
    },
    retry: () => {
      const request = deferred();
      pending.push(request);
      return request.promise;
    },
    cancel: () => {
      const request = deferred();
      pending.push(request);
      return request.promise;
    }
  };
  const document = {
    querySelector: (id) => {
      if (!nodes.has(id))
        nodes.set(id, {
          value: "",
          textContent: "",
          disabled: false,
          hidden: false,
          handlers: {},
          focus() {},
          select() {},
          addEventListener(event, fn) {
            this.handlers[event] = fn;
          }
        });
      return nodes.get(id);
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "connection.js"), "utf8"), {
    document,
    window: { cosmoraDesktop: bridge }
  });
  return {
    nodes,
    pending,
    bridge,
    changeState: (value) => {
      state = value;
      changed();
    }
  };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("connection state updates preserve the replacement address while connecting", async () => {
  const r = renderer();
  await tick();
  r.nodes.get("#change").handlers.click();
  r.nodes.get("#origin").value = "https://replacement.example";
  const submit = r.nodes.get("#connection-form").handlers.submit({ preventDefault() {} });
  r.changeState({ origin: "https://saved.example", mode: "offline", connecting: true });
  await tick();
  assert.equal(r.nodes.get("#origin").value, "https://replacement.example");
  assert.equal(r.nodes.get("#connection-form").hidden, false);
  r.pending[0].resolve({ ok: false, message: "Server unavailable" });
  await submit;
  assert.equal(r.nodes.get("#origin").value, "https://replacement.example");
  assert.equal(r.nodes.get("#error").textContent, "Server unavailable");
});

test("older connection completion cannot clear a newer request's busy state or error", async () => {
  const r = renderer();
  await tick();
  const first = r.nodes.get("#retry").handlers.click();
  const second = r.nodes.get("#retry").handlers.click();
  r.pending[0].resolve({ ok: false, message: "Obsolete failure" });
  await first;
  assert.equal(r.nodes.get("#retry").disabled, true);
  assert.equal(r.nodes.get("#error").textContent, "");
  r.pending[1].resolve({ ok: false, message: "Current failure" });
  await second;
  assert.equal(r.nodes.get("#retry").disabled, false);
  assert.equal(r.nodes.get("#error").textContent, "Current failure");
});

test("an old asynchronous state read cannot overwrite the newer state", async () => {
  const r = renderer();
  await tick();
  const old = deferred();
  r.bridge.getConnectionState = () => old.promise;
  r.changeState({});
  r.bridge.getConnectionState = async () => ({
    origin: "https://new.example",
    mode: "setup",
    connecting: true
  });
  r.changeState({});
  await tick();
  old.resolve({ origin: "https://old.example", mode: "offline", connecting: false });
  await tick();
  assert.equal(r.nodes.get("#origin").value, "https://new.example");
  assert.equal(r.nodes.get("#connect").disabled, true);
});

test("cancel wins over a late submit answer and clears the busy latch", async () => {
  const r = renderer();
  await tick();
  const submit = r.nodes.get("#connection-form").handlers.submit({ preventDefault() {} });
  await tick();
  assert.equal(r.nodes.get("#connect").disabled, true);
  assert.equal(r.nodes.get("#cancel").hidden, false);
  const cancelClick = r.nodes.get("#cancel").handlers.click();
  const submitIndex = 0,
    cancelIndex = 1;
  // The main process publishes the cancelled state, same as the real flow.
  r.changeState({
    origin: "https://saved.example",
    mode: "offline",
    connecting: false,
    message: "Проверка подключения отменена. Сохранённый адрес не изменён."
  });
  r.pending[cancelIndex].resolve({
    ok: true,
    message: "Проверка подключения отменена. Сохранённый адрес не изменён."
  });
  await cancelClick;
  await tick();
  assert.equal(r.nodes.get("#connect").disabled, false);
  assert.equal(r.nodes.get("#cancel").hidden, true);
  assert.equal(
    r.nodes.get("#error").textContent,
    "Проверка подключения отменена. Сохранённый адрес не изменён."
  );
  // A stale submit answer arrives only after cancel: it may not restore the
  // error text, the busy state or the canceled request semantics.
  r.pending[submitIndex].resolve({ ok: false, message: "Late server failure" });
  await submit;
  await tick();
  assert.equal(r.nodes.get("#connect").disabled, false);
  assert.equal(
    r.nodes.get("#error").textContent,
    "Проверка подключения отменена. Сохранённый адрес не изменён."
  );
});

test("a completed check can never leave the connection screen busy forever", async () => {
  const r = renderer();
  await tick();
  const submit = r.nodes.get("#connection-form").handlers.submit({ preventDefault() {} });
  await tick();
  r.pending[0].resolve({ ok: false, message: "Сервер Kosmora не ответил за 6 секунд." });
  await submit;
  assert.equal(r.nodes.get("#connect").disabled, false);
  assert.equal(r.nodes.get("#retry").disabled, false);
  assert.equal(r.nodes.get("#error").textContent, "Сервер Kosmora не ответил за 6 секунд.");
});

test("refused cancel keeps the existing decision visible and stays busy", async () => {
  const r = renderer();
  await tick();
  const refusal = "Проверка уже завершилась или выполняется смена сервера — дождитесь результата.";
  r.changeState({ origin: "https://saved.example", mode: "offline", connecting: true, message: refusal });
  const cancelClick = r.nodes.get("#cancel").handlers.click();
  r.pending[0].resolve({ ok: false, stale: true, message: refusal });
  await cancelClick;
  await tick();
  assert.equal(r.nodes.get("#error").textContent, refusal);
  assert.equal(r.nodes.get("#connect").disabled, true);
});
