"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  { EventEmitter } = require("node:events");
test("the packaged preload exposes only outcome values with removable listeners", () => {
  for (const protocol of ["https:", "http:", "file:"]) {
    const exposed = {},
      ipc = new EventEmitter();
    ipc.invoke = async (...args) => args;
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../preload.cjs"), "utf8"), {
      window: { location: { protocol } },
      require: (name) => {
        assert.equal(name, "electron");
        return {
          ipcRenderer: ipc,
          contextBridge: {
            exposeInMainWorld: (key, value) => {
              exposed[key] = value;
            }
          }
        };
      }
    });
    if (protocol === "file:") {
      assert.equal(exposed.kosmoraDesktopWork, undefined);
      continue;
    }
    const bridge = exposed.kosmoraDesktopWork,
      received = [];
    assert.deepEqual(Object.keys(bridge).sort(), ["onResult", "open"]);
    bridge.onResult(null)();
    assert.equal(ipc.listenerCount("koswork:work-result"), 0);
    const release = bridge.onResult((...args) => received.push(args));
    const outcome = { request_id: "fixture", result: { status: "completed" } };
    ipc.emit("koswork:work-result", { privileged: true }, outcome);
    assert.deepEqual(received, [[outcome]]);
    release();
    release();
    ipc.emit("koswork:work-result", {}, outcome);
    assert.equal(received.length, 1);
    assert.equal(ipc.listenerCount("koswork:work-result"), 0);
  }
});
