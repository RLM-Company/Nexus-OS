"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const tick = () => new Promise(setImmediate);
function fixture() {
  const nodes = new Map(),
    calls = [];
  let status;
  function element(tag) {
    return {
      tag,
      children: [],
      handlers: {},
      disabled: false,
      value: "",
      textContent: "",
      get options() {
        return this.children;
      },
      addEventListener(name, fn) {
        this.handlers[name] = fn;
      },
      append(...items) {
        this.children.push(...items);
      },
      replaceChildren(...items) {
        this.children = items;
      }
    };
  }
  const state = {
    items: [
      {
        id: "old",
        project: "project",
        goal: "<img src=x onerror=alert(1)>",
        status: "interrupted",
        updatedAt: 10000,
        steps: [{ kind: "type_text", phase: "dispatching" }],
        requiresReview: true,
        recoverable: true
      }
    ],
    error: null
  };
  const bridge = {
    projects: async () => ({
      origin: "https://example.test",
      projects: [{ id: "project", title: "Project" }]
    }),
    history: async () => ({ items: state.items, error: state.error }),
    recover: async (id) => {
      calls.push({ kind: "recover", id });
      return { status: "needs_user", summary: "Check state" };
    },
    accept: async (id) => {
      calls.push({ kind: "accept", id });
      return { accepted: true };
    },
    start: async (input) => {
      calls.push({ kind: "start", input });
      return { status: "completed" };
    },
    clearHistory: async () => {
      calls.push({ kind: "clear" });
      state.items = [];
      return { cleared: true };
    },
    onPrefill() {},
    onStatus(fn) {
      status = fn;
    }
  };
  const document = {
    createElement: element,
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, element(id));
      return nodes.get(id);
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "computer.js"), "utf8"), {
    document,
    window: { kosworkComputer: bridge }
  });
  return { nodes, calls, state, bridge, status: (value) => status(value) };
}
test("opening history cannot run desktop actions; recovery is explicit and task text is rendered as text", async () => {
  const f = fixture();
  await tick();
  assert.deepEqual(f.calls, []);
  const row = f.nodes.get("history").children[0];
  assert.ok(row.children[0].textContent.startsWith("<img src=x"));
  assert.equal(
    row.children.some((c) => c.tag === "img"),
    false
  );
  assert.ok(
    row.children.find((c) => c.tag === "ol").children[0].textContent.includes("исход неизвестен")
  );
  const button = row.children.find((c) => c.tag === "button");
  button.handlers.click();
  await tick();
  assert.deepEqual(f.calls, [{ kind: "recover", id: "old" }]);
  assert.equal(f.nodes.get("stop").disabled, true);
  assert.equal(f.nodes.get("goal").disabled, false);
});
test("model completion offers owner acceptance instead of replay; local clear removes displayed records", async () => {
  const f = fixture();
  f.state.items[0] = { ...f.state.items[0], status: "completed", recoverable: false };
  await tick();
  const buttons = f.nodes.get("history").children[0].children.filter((c) => c.tag === "button");
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].textContent, "Результат проверен мной");
  await buttons[0].handlers.click();
  assert.deepEqual(f.calls, [{ kind: "accept", id: "old" }]);
  await f.nodes.get("clear-history").handlers.click();
  assert.equal(f.nodes.get("history").children.length, 0);
});
test("checkpoint event has no undefined step and active recovery disables history controls", async () => {
  const f = fixture();
  await tick();
  let resolve;
  f.bridge.recover = () =>
    new Promise((done) => {
      resolve = done;
    });
  f.nodes
    .get("history")
    .children[0].children.find((c) => c.tag === "button")
    .handlers.click();
  assert.equal(f.nodes.get("clear-history").disabled, true);
  assert.equal(
    f.nodes.get("history").children[0].children.find((c) => c.tag === "button").disabled,
    true
  );
  f.status({ phase: "checkpoint", message: "Checkpoint saved" });
  assert.equal(f.nodes.get("events").children[0].textContent, "Checkpoint saved");
  resolve({ status: "step_limit" });
  await tick();
  assert.equal(f.nodes.get("clear-history").disabled, false);
});
