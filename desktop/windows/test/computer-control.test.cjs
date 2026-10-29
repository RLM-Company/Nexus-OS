"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { ComputerSessionGate, validateComputerAction } = require("../computer-policy.cjs");
const { ComputerSession } = require("../computer-session.cjs");
const { createNativeTransport, createComputerDriver } = require("../computer-driver.cjs");

const context = {
  origin: "https://example.test",
  owner: "owner",
  project: "project",
  goal: "Write a note"
};
const observation = {
  observation_id: "observation",
  active_window: "42",
  description: "test",
  width: 800,
  height: 600,
  image_jpeg_base64: "/9j/2Q=="
};
const proposal = (action, confirm = false) => ({
  action,
  message: "step",
  requires_confirmation: confirm
});
function fixture(actions = [proposal({ kind: "done", summary: "done" })]) {
  const events = [],
    executions = [],
    confirmations = [];
  let identity = { origin: context.origin, owner: context.owner };
  let next = 0;
  const driver = {
    observe: async () => ({ ...observation }),
    execute: async (action) => {
      executions.push(action);
      return { requested: true };
    },
    stop: () => {}
  };
  const planner = {
    begin: async () => ({ id: "session" }),
    next: async () => actions[next++],
    authorize: async () => ({ authorized: true, valid_for_ms: 10000 }),
    end: async () => {}
  };
  const session = new ComputerSession({
    driver,
    planner,
    identity: async () => identity,
    confirm: async (value) => {
      confirmations.push(value);
      return true;
    },
    notify: (value) => events.push(value)
  });
  return {
    session,
    planner,
    driver,
    events,
    executions,
    confirmations,
    setIdentity: (value) => {
      identity = value;
    }
  };
}

test("computer grant binds owner, origin, project, goal, expiry and one-use action IDs", () => {
  let now = 1;
  const gate = new ComputerSessionGate({ now: () => now });
  const grant = gate.enable({ ...context, durationMs: 20 });
  assert.deepEqual(gate.consume(grant, "one", { kind: "observe" }), { kind: "observe" });
  assert.throws(() => gate.consume(grant, "one", { kind: "observe" }), /ALREADY_USED/);
  for (const field of ["owner", "origin", "project", "goal", "id"])
    assert.throws(() => gate.assert({ ...grant, [field]: "foreign" }), /STOPPED/);
  now = 21;
  assert.throws(() => gate.assert(grant), /STOPPED/);
  const fresh = gate.enable(context);
  gate.stop();
  assert.throws(() => gate.assert(fresh), /STOPPED/);
  for (const origin of [
    "ftp://localhost",
    "http://example.test",
    "https://user:password@example.test"
  ])
    assert.throws(() => gate.enable({ ...context, origin }), /GRANT_INVALID/);
});

test("computer action validator refuses shell, injected fields, executable files, UNC and invalid keys", () => {
  for (const action of [
    { kind: "shell", command: "whoami" },
    { kind: "observe", command: "x" },
    { kind: "open_url", url: "javascript:alert(1)" },
    { kind: "open_url", url: "https://user:pass@example.test" },
    { kind: "open_file", path: "C:\\test.ps1" },
    { kind: "open_file", path: "\\\\server\\share\\test.txt" },
    { kind: "open_file", path: "\\test.txt" },
    { kind: "open_file", path: "C:\\test.txt:secret" },
    { kind: "press", keys: ["WIN"] },
    { kind: "press", keys: ["CTRL", "CTRL"] },
    { kind: "click", x: NaN, y: 0, button: "left", count: 1 },
    { kind: "hover", x: 1.1, y: 0 },
    { kind: "drag", from_x: 0, from_y: 0, to_x: -1, to_y: 0 },
    { kind: "drag", from_x: 0, from_y: 0, to_x: 1, to_y: 1, duration: 10000 },
    { kind: "wait", milliseconds: 3000 },
    { kind: "type_text", text: "x\0y" }
  ])
    assert.throws(() => validateComputerAction(action), /INVALID/);
  assert.equal(
    validateComputerAction({ kind: "open_file", path: "C:\\Documents\\report.docx" }).kind,
    "open_file"
  );
  assert.equal(validateComputerAction({ kind: "type_text", text: "Привет 🌙" }).text, "Привет 🌙");
});

test("hover, drag and horizontal wheel retain captured DPI coordinates and window/input guards", async () => {
  for (const [action, expected] of [
    [
      { kind: "hover", x: 0.5, y: 0.5 },
      { kind: "hover", x: 820, y: 640 }
    ],
    [
      { kind: "drag", from_x: 0, from_y: 0, to_x: 1, to_y: 1 },
      { kind: "drag", from_x: 20, from_y: 40, to_x: 1618, to_y: 1238 }
    ],
    [
      { kind: "scroll", direction: "left", amount: 2 },
      { kind: "wheel", amount: -240, horizontal: true }
    ],
    [
      { kind: "scroll", direction: "right", amount: 1 },
      { kind: "wheel", amount: 120, horizontal: true }
    ],
    [
      { kind: "scroll", direction: "down", amount: 1 },
      { kind: "wheel", amount: -120, horizontal: false }
    ]
  ]) {
    const requests = [];
    const driver = createComputerDriver({
      desktopCapturer: {
        getSources: async () => [
          {
            display_id: "9",
            thumbnail: {
              isEmpty: () => false,
              getSize: () => ({ width: 800, height: 600 }),
              toJPEG: () => Buffer.from([255, 216, 255, 217])
            }
          }
        ]
      },
      screen: {
        getPrimaryDisplay: () => ({ id: 9, bounds: { x: 10, y: 20, width: 800, height: 600 } }),
        dipToScreenPoint: (p) => ({ x: p.x * 2, y: p.y * 2 })
      },
      shell: {},
      transport: {
        request: async (value) => {
          requests.push(value);
          return { active_window: "42", input_tick: 10 };
        },
        stop() {}
      }
    });
    const signal = new AbortController().signal;
    const captured = await driver.observe(signal);
    await driver.execute(action, captured, signal);
    assert.deepEqual(requests.at(-1), {
      ...expected,
      expected_window: "42",
      expected_input_tick: 10
    });
    await assert.rejects(driver.execute(action, captured, signal), /STALE/);
  }
});

test("computer cycle observes between actions and completes only on a final proposal", async () => {
  const f = fixture([
    proposal({ kind: "open_app", app_id: "notepad.exe" }),
    proposal({ kind: "type_text", text: "Hello" }),
    proposal({ kind: "done", summary: "Written" })
  ]);
  const result = await f.session.run({ project: context.project, goal: context.goal });
  assert.equal(result.status, "completed");
  assert.equal(result.steps, 3);
  assert.deepEqual(
    f.executions.map((a) => a.kind),
    ["open_app", "type_text"]
  );
  assert.equal(f.confirmations[0].kind, "session");
  assert.equal(f.session.active, null);
});

test("computer cycle denies all observation and model work before native approval", async () => {
  const f = fixture();
  let observed = 0,
    planned = 0;
  f.driver.observe = async () => {
    observed++;
    return observation;
  };
  f.planner.begin = async () => {
    planned++;
    return { id: "session" };
  };
  f.session.confirm = async () => false;
  await assert.rejects(
    f.session.run({ project: context.project, goal: context.goal }),
    /CANCELLED/
  );
  assert.equal(observed, 0);
  assert.equal(planned, 0);
});

test("stopping during native consent cancels the dialog before any observation", async () => {
  const f = fixture();
  let entered;
  const ready = new Promise((resolve) => {
    entered = resolve;
  });
  let observations = 0;
  f.driver.observe = async () => {
    observations++;
    return observation;
  };
  f.session.confirm = ({ signal }) =>
    new Promise((resolve) => {
      signal.addEventListener("abort", () => resolve(false), { once: true });
      entered();
    });
  const pending = f.session.run({ project: context.project, goal: context.goal });
  await ready;
  f.session.stop();
  await assert.rejects(pending, /CANCELLED|STOPPED/);
  assert.equal(observations, 0);
  assert.equal(f.session.active, null);
});

test("known pre-input rejection replans but an unknown partial-input error stops", async () => {
  const action = { kind: "type_text", text: "example" };
  const f = fixture();
  const results = [];
  f.planner.next = async ({ previousResult }) => {
    results.push(previousResult);
    return results.length === 1
      ? proposal(action)
      : proposal({ kind: "done", summary: "Nothing typed" });
  };
  f.driver.execute = async () => {
    throw Error("COMPUTER_TARGET_OCCLUDED");
  };
  assert.equal(
    (await f.session.run({ project: context.project, goal: context.goal })).status,
    "completed"
  );
  assert.equal(JSON.parse(results[1]).not_executed, true);
  assert.equal(JSON.parse(results[1]).reason, "COMPUTER_TARGET_OCCLUDED");
  const other = fixture([proposal(action)]);
  other.driver.execute = async () => {
    throw Error("COMPUTER_INPUT_REJECTED");
  };
  await assert.rejects(
    other.session.run({ project: context.project, goal: context.goal }),
    /INPUT_REJECTED/
  );
  assert.equal(other.events.length, 1);
});

test("computer cycle rejects owner change after a model response before input", async () => {
  const f = fixture();
  f.planner.next = async () => {
    f.setIdentity({ origin: context.origin, owner: "other" });
    return proposal({ kind: "type_text", text: "secret" });
  };
  await assert.rejects(
    f.session.run({ project: context.project, goal: context.goal }),
    /IDENTITY_CHANGED/
  );
  assert.equal(f.executions.length, 0);
});

test("computer cycle stop fences an uncooperative late model response", async () => {
  const f = fixture();
  let release, entered;
  const ready = new Promise((resolve) => {
    entered = resolve;
  });
  f.planner.next = async () => {
    entered();
    return new Promise((resolve) => {
      release = resolve;
    });
  };
  const result = f.session.run({ project: context.project, goal: context.goal });
  await ready;
  f.session.stop();
  release(proposal({ kind: "type_text", text: "late" }));
  await assert.rejects(result, /STOPPED/);
  assert.equal(f.executions.length, 0);
});

test("stop during a settling foreground does not dispatch a model request", async () => {
  const f = fixture();
  let entered,
    planned = 0;
  const ready = new Promise((resolve) => {
    entered = resolve;
  });
  f.driver.observe = async () => {
    entered();
    throw Error("COMPUTER_USER_INPUT_ACTIVE");
  };
  f.planner.next = async () => {
    planned++;
    throw Error("must not plan");
  };
  const pending = f.session.run({ project: context.project, goal: context.goal });
  await ready;
  f.session.stop();
  await assert.rejects(pending);
  assert.equal(planned, 0);
  assert.equal(f.executions.length, 0);
});

test("computer cycle reserves the active slot before asynchronous identity verification", async () => {
  const f = fixture();
  let release;
  f.session.identity = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const first = f.session.run({ project: context.project, goal: context.goal });
  await assert.rejects(f.session.run({ project: context.project, goal: context.goal }), /BUSY/);
  f.session.stop();
  release({ origin: context.origin, owner: context.owner });
  await assert.rejects(first, /STOPPED/);
});

test("consequential confirmation forces replanning with a fresh observation before execution", async () => {
  const action = { kind: "press", keys: ["ENTER"] };
  const f = fixture([
    proposal(action, true),
    proposal(action, true),
    proposal({ kind: "done", summary: "Done" })
  ]);
  await f.session.run({ project: context.project, goal: context.goal });
  assert.equal(f.executions.length, 1);
  assert.equal(f.confirmations.length, 2);
  assert.equal(f.events.length, 3);
});

test("computer step limit stops without presenting an unverified task as completed", async () => {
  const f = fixture([proposal({ kind: "observe" })]);
  const result = await f.session.run({ project: context.project, goal: context.goal, maxSteps: 1 });
  assert.equal(result.status, "step_limit");
});

test("human checkpoint is idle until explicit local resume, then uses a fresh observation", async () => {
  const f = fixture([
    proposal({ kind: "ask_user", question: "Unlock locally" }),
    proposal({ kind: "type_text", text: "continue" }),
    proposal({ kind: "done", summary: "done" })
  ]);
  let paused,
    observations = 0,
    begins = 0;
  const ready = new Promise((resolve) => {
    paused = resolve;
  });
  f.session.allowHumanResume = true;
  f.session.notify = (event) => {
    if (event.phase === "awaiting_user") paused();
  };
  f.driver.observe = async () => ({ ...observation, observation_id: String(++observations) });
  f.planner.begin = async () => {
    begins++;
    return { id: "same-session" };
  };
  const originalNext = f.planner.next;
  const inputs = [];
  f.planner.next = async (input) => {
    inputs.push(input);
    return originalNext();
  };
  const pending = f.session.run({ project: context.project, goal: context.goal });
  await ready;
  await new Promise(setImmediate);
  assert.equal(observations, 1);
  assert.equal(inputs.length, 1);
  assert.equal(f.executions.length, 0);
  assert.equal(f.session.resume(), true);
  assert.equal(f.session.resume(), false);
  assert.equal((await pending).status, "completed");
  assert.equal(begins, 1);
  assert.equal(observations, 3);
  assert.equal(inputs[1].observation.observation_id, "2");
  assert.equal(JSON.parse(inputs[1].previousResult).status, "owner_resumed");
  assert.equal(f.executions.length, 1);
});

test("manual login checkpoint revokes an earlier per-action approval before replanning", async () => {
  const action = { kind: "type_text", text: "write once" };
  const f = fixture([
    proposal(action, true),
    proposal({ kind: "ask_user", question: "Unlock locally" }),
    proposal(action, true),
    proposal(action, true),
    proposal({ kind: "done", summary: "done" })
  ]);
  f.session.allowHumanResume = true;
  f.session.notify = (value) => {
    if (value.phase === "awaiting_user") queueMicrotask(() => f.session.resume());
  };
  await f.session.run({ project: context.project, goal: context.goal });
  assert.equal(f.confirmations.filter((c) => c.kind === "action").length, 2);
  assert.equal(f.executions.length, 1);
});

test("stop, changed owner and expired grant fence a paused session before any new capture", async () => {
  for (const reason of ["stop", "owner", "expiry"]) {
    const f = fixture([proposal({ kind: "ask_user", question: "Unlock locally" })]);
    let paused,
      observations = 0;
    const ready = new Promise((resolve) => {
      paused = resolve;
    });
    f.session.allowHumanResume = true;
    f.session.notify = (event) => {
      if (event.phase === "awaiting_user") paused();
    };
    f.driver.observe = async () => {
      observations++;
      return observation;
    };
    const pending = f.session.run({ project: context.project, goal: context.goal });
    await ready;
    if (reason === "stop") {
      f.session.stop();
      assert.equal(f.session.resume(), false);
    } else {
      if (reason === "owner") f.setIdentity({ ...context, owner: "other" });
      else f.session.gate.now = () => f.session.active.grant.expires + 1;
      assert.equal(f.session.resume(), true);
    }
    await assert.rejects(pending, /STOPPED|IDENTITY_CHANGED/);
    assert.equal(observations, 1);
    assert.equal(f.executions.length, 0);
  }
});

test("server revocation before an action prevents all native input", async () => {
  const f = fixture([proposal({ kind: "type_text", text: "must not type" })]);
  f.planner.authorize = async () => {
    throw Error("COMPUTER_SESSION_STOPPED");
  };
  await assert.rejects(f.session.run({ project: context.project, goal: context.goal }), /STOPPED/);
  assert.equal(f.executions.length, 0);
});

test("an expired one-action authorization is never used after an identity check", async () => {
  const f = fixture([proposal({ kind: "type_text", text: "must not type" })]);
  let now = 1;
  f.session.now = () => now;
  f.planner.authorize = async () => {
    now += 10001;
    return { authorized: true, valid_for_ms: 10000 };
  };
  await assert.rejects(
    f.session.run({ project: context.project, goal: context.goal }),
    /AUTHORIZATION_EXPIRED/
  );
  assert.equal(f.executions.length, 0);
});

test("screen coordinates use captured display bounds and cannot reuse an observation", async () => {
  const requests = [];
  const image = {
    isEmpty: () => false,
    getSize: () => ({ width: 800, height: 600 }),
    toJPEG: () => Buffer.from([255, 216, 255, 217])
  };
  const driver = createComputerDriver({
    desktopCapturer: { getSources: async () => [{ display_id: "9", thumbnail: image }] },
    screen: {
      getPrimaryDisplay: () => ({ id: 9, bounds: { x: 10, y: 20, width: 800, height: 600 } }),
      dipToScreenPoint: (p) => ({ x: p.x * 2, y: p.y * 2 })
    },
    shell: {},
    transport: {
      request: async (value) => {
        requests.push(value);
        return {
          active_window: "42",
          input_tick: 100,
          known_folders: { desktop: "C:\\Users\\fixture\\OneDrive\\Desktop" }
        };
      },
      stop() {}
    }
  });
  const signal = new AbortController().signal;
  const observed = await driver.observe(signal);
  assert.equal(
    JSON.parse(observed.description).known_folders.desktop,
    "C:\\Users\\fixture\\OneDrive\\Desktop"
  );
  await driver.execute(
    { kind: "click", x: 0.5, y: 0.5, button: "left", count: 1 },
    observed,
    signal
  );
  assert.deepEqual(requests.at(-1), {
    kind: "click",
    x: 820,
    y: 640,
    right: false,
    count: 1,
    expected_window: "42",
    expected_input_tick: 100
  });
  await assert.rejects(driver.execute({ kind: "observe" }, observed, signal), /STALE/);
});

test("foreground or physical input changes during capture discard the image before model dispatch", async () => {
  for (const change of ["window", "input"]) {
    let calls = 0;
    const driver = createComputerDriver({
      desktopCapturer: {
        getSources: async () => [
          {
            display_id: "9",
            thumbnail: {
              isEmpty: () => false,
              getSize: () => ({ width: 800, height: 600 }),
              toJPEG: () => Buffer.from([255, 216, 255, 217])
            }
          }
        ]
      },
      screen: { getPrimaryDisplay: () => ({ id: 9, bounds: {} }) },
      shell: {},
      transport: {
        request: async () => {
          calls++;
          return { active_window: change === "window" ? String(calls) : "42", input_tick: calls };
        },
        stop() {}
      }
    });
    await assert.rejects(
      driver.observe(new AbortController().signal),
      change === "window" ? /WINDOW_CHANGED/ : /USER_INPUT_ACTIVE/
    );
  }
});

test("native transport uses data-only stdin, hidden process and refuses mismatched replies", async () => {
  let args, options;
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.kill = () => {};
  const transport = createNativeTransport({
    platform: "win32",
    spawnProcess: (_exe, values, opts) => {
      args = values;
      options = opts;
      return child;
    }
  });
  const result = transport.request({ kind: "state" }, new AbortController().signal);
  assert.equal(options.shell, false);
  assert.equal(options.windowsHide, true);
  assert.equal(args.includes("-Command"), false);
  child.stdout.write(JSON.stringify({ id: "wrong", ok: true }) + "\n");
  await assert.rejects(result, /INTERRUPTED/);
});

test("computer modules are packaged and the helper is extracted from ASAR", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  for (const file of [
    "computer-console.cjs",
    "computer-driver.cjs",
    "computer-session.cjs",
    "computer-policy.cjs",
    "computer-helper.ps1",
    "computer-preload.cjs",
    "computer.html",
    "computer.js",
    "computer.css"
  ])
    assert.ok(pkg.build.files.includes(file), file);
  assert.ok(pkg.build.asarUnpack.includes("computer-helper.ps1"));
  const preload = fs.readFileSync(path.join(__dirname, "..", "preload.cjs"), "utf8");
  assert.equal(
    preload.includes("kosworkComputer"),
    false,
    "hosted content must not receive native computer IPC"
  );
});
