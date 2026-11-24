// Automatic end-to-end acceptance for the Koswork -> local executor link.
//
// Uses the REAL desktop modules (ComputerSession, createComputerWorkspace,
// createComputerHistory) against a dedicated temporary folder and a synthetic
// deterministic planner. No Electron binary, no installer, no paid model, no
// owner PC control: those belong to other chats. The result is honestly a
// fixture acceptance, not a live installed-client acceptance.
//
//   node scripts/run-koswork-local-cycle.mjs [--out=<dir>]
//
// Without --out a fresh temp folder is created and printed at the end.

import { createRequire } from "node:module";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktop = join(root, "desktop", "windows");
const { createComputerWorkspace } = require(join(desktop, "computer-workspace.cjs"));
const { ComputerSession } = require(join(desktop, "computer-session.cjs"));
const { createComputerHistory } = require(join(desktop, "computer-history.cjs"));
const { validateComputerAction } = require(join(desktop, "computer-policy.cjs"));

const arg = process.argv.find((a) => a.startsWith("--out="));
const output = arg?.slice(6);
if (arg && (!output || !isAbsolute(output) || !basename(output).includes("koswork")))
  throw Error("OUT_MUST_BE_DEDICATED_FOLDER");
const outDir = output ? resolve(output) : mkdtempSync(join(tmpdir(), "koswork-local-cycle-"));
if (output) mkdirSync(outDir, { mode: 0o700 });
const workRoot = join(outDir, "work");
const profile = join(outDir, "profile");
mkdirSync(workRoot, { recursive: true });
mkdirSync(profile, { recursive: true });

const identity = { owner: "test-profile-owner", origin: "http://127.0.0.1" };
const goal = "Create and save a Koswork result file in the selected folder";
const project = "koswork-local-cycle";
const reportPath = "koswork-cycle.md";
const controlText = "19 700 ₽; артикул 00123; кроме доставки";
const sha = (value) => createHash("sha256").update(value).digest("hex");

const key = createHash("sha256").update(randomBytes(32)).digest();
const codec = {
  seal(text) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const body = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
    return Buffer.concat([iv, body, cipher.getAuthTag()]).toString("base64");
  },
  open(text) {
    const b = Buffer.from(text, "base64");
    const d = createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
    d.setAuthTag(b.subarray(-16));
    return Buffer.concat([d.update(b.subarray(12, -16)), d.final()]).toString("utf8");
  }
};

const journal = [];
function log(event, detail = {}) {
  journal.push({ at: new Date().toISOString(), event, ...detail });
  writeFileSync(
    join(outDir, "actions.jsonl"),
    journal.map((x) => JSON.stringify(x)).join("\n") + "\n"
  );
}
const checks = [];
async function acheck(name, fn) {
  try {
    const detail = await fn();
    checks.push({ name, status: "pass", detail: detail ?? "" });
    log("check", { name, status: "pass" });
  } catch (error) {
    checks.push({ name, status: "fail", detail: String(error?.message ?? error) });
    log("check", { name, status: "fail", error: String(error?.message ?? error) });
  }
}
function observation() {
  return {
    observation_id: "obs-" + randomBytes(6).toString("hex"),
    active_window: "42",
    description: "fixture observation; no desktop permission claimed",
    width: 800,
    height: 600,
    image_jpeg_base64: "dummy"
  };
}
function plannerFor(actions, sink = {}) {
  return {
    begin: async () => ({ id: "cycle-session" }),
    authorize: async () => ({ authorized: true, valid_for_ms: 10000 }),
    end: async () => {},
    next: async ({ observation: obs, previousResult }) => {
      sink.observations?.push(obs);
      sink.previous?.push(previousResult);
      log("planner_step", {
        step: sink.proposed?.length ?? 0,
        previous: String(previousResult).slice(0, 800)
      });
      const action = actions.shift();
      if (!action) throw Error("PLANNER_EXHAUSTED");
      sink.proposed?.push(action);
      return { action, message: "synthetic cycle", requires_confirmation: false };
    }
  };
}
const driver = {
  observe: async () => observation(),
  // The confirmation UI keeps the same owned fixture window; no focus change.
  approvalKey: () => "fixture-window-42",
  execute: async () => {
    throw Error("NO_NATIVE_DESKTOP_INPUT_IN_FIXTURE");
  },
  stop() {}
};

async function run() {
  const workspace = createComputerWorkspace({
    userDataPath: profile,
    codec,
    pickDirectory: async () => workRoot
  });
  const history = createComputerHistory(profile, { codec });
  let connected;

  await acheck("01 connect + workspace selection", async () => {
    connected = await workspace.connect(identity, new AbortController().signal);
    if (!connected?.id) throw Error("NO_WORKSPACE_ID");
    if (workspace.snapshot(identity)?.id !== connected.id) throw Error("WORKSPACE_NOT_SELECTED");
    log("connected", { id: connected.id, name: connected.name });
    return `workspace ${connected.id}`;
  });

  await acheck("02 open test application proposal is bounded", () => {
    const openApp = validateComputerAction({ kind: "open_app", app_id: "fixture-app" });
    if (!openApp || openApp.kind !== "open_app") throw Error("OPEN_APP_REJECTED");
    let unsafeRejected = false;
    try {
      validateComputerAction({ kind: "workspace_create", path: "../escape.md", content: "x" });
    } catch {
      unsafeRejected = true;
    }
    if (!unsafeRejected) throw Error("UNSAFE_PATH_ACCEPTED");
    log("app", { kind: "open_app", app_id: "fixture-app" });
    return "open_app accepted; unsafe workspace path rejected";
  });

  const sink = { observations: [], previous: [], proposed: [] };
  // A native workspace write is confirmed on the first proposal and executed
  // only on the re-proposal of the SAME action (approval gate). Mirror the
  // established test fixture: propose create twice, then read and finish.
  const create = { kind: "workspace_create", path: reportPath, content: controlText };
  const actions = [
    create,
    { ...create },
    { kind: "workspace_read", path: reportPath },
    { kind: "done", summary: "Koswork result file created and verified" }
  ];
  const session = new ComputerSession({
    driver,
    planner: plannerFor(actions, sink),
    history,
    workspace,
    identity: async () => identity,
    confirm: async (input) => {
      log("confirm", { action: input.action?.kind, workspace: input.workspace?.id });
      return true;
    },
    notify: (value) =>
      log("notify", { phase: value.phase, type: value.type, message: value.message })
  });
  let result;
  await acheck("03-05 create/save file, read back and return result to Koswork", async () => {
    result = await session.run({ project, goal, maxSteps: 6 });
    log("session_result", { status: result.status, steps: result.steps });
    if (result.status !== "completed") throw Error("SESSION_NOT_COMPLETED:" + result.status);
    const file = join(workRoot, reportPath);
    if (!existsSync(file)) throw Error("RESULT_FILE_MISSING");
    const content = readFileSync(file, "utf8");
    if (!content.includes(controlText)) throw Error("RESULT_CONTENT_MISMATCH");
    const record = history.list(identity)[0];
    if (record?.status !== "completed") throw Error("HISTORY_NOT_COMPLETED");
    if (!sink.observations[0]?.workspace?.id) throw Error("WORKSPACE_NOT_IN_OBSERVATION");
    log("result_file", {
      path: reportPath,
      sha256: sha(content),
      bytes: Buffer.byteLength(content)
    });
    return `file ${reportPath} sha256=${sha(content).slice(0, 12)} status=${result.status}`;
  });

  await acheck("06 revoke permission mid-action", async () => {
    await workspace.invalidate();
    let refused = false;
    try {
      await workspace.execute(
        { kind: "workspace_create", path: "after-revoke.md", content: "must not be written" },
        { context: identity, workspaceId: connected.id, signal: new AbortController().signal }
      );
    } catch (error) {
      refused = String(error.message).includes("COMPUTER_WORKSPACE_CHANGED");
    }
    if (!refused) throw Error("REVOKE_NOT_ENFORCED");
    if (existsSync(join(workRoot, "after-revoke.md"))) throw Error("WRITE_AFTER_REVOKE");
    connected = await workspace.connect(identity, new AbortController().signal);
    return "write after revoke refused; no file created";
  });

  await acheck("07 stop during action", async () => {
    const currentId = workspace.snapshot(identity)?.id;
    const controller = new AbortController();
    controller.abort();
    let cancelled = false;
    try {
      await workspace.execute(
        { kind: "workspace_list", path: "", cursor: 0 },
        { context: identity, workspaceId: currentId, signal: controller.signal }
      );
    } catch (error) {
      cancelled = /CANCEL|STOPPED/i.test(String(error.message) + String(error.code));
    }
    if (!cancelled) throw Error("STOP_NOT_ENFORCED");
    return "aborted action rejected before execution";
  });

  await acheck("08 assistant restart restores status from history", () => {
    const record = history.list(identity)[0];
    if (!record || record.status !== "completed") throw Error("HISTORY_MISSING");
    const fresh = createComputerHistory(profile, { codec });
    const restored = fresh.list(identity)[0];
    if (!restored || restored.status !== "completed") throw Error("STATUS_NOT_RESTORED");
    if (restored.workspaceId !== record.workspaceId) throw Error("WORKSPACE_LINK_LOST");
    return `status ${restored.status} restored after restart`;
  });

  await acheck("09 lost save response continues without duplication", async () => {
    const currentId = workspace.snapshot(identity)?.id;
    if (!currentId) throw Error("WORKSPACE_NOT_SELECTED");
    const before = readFileSync(join(workRoot, reportPath), "utf8");
    let duplicateRefused = false;
    try {
      await workspace.execute(
        { kind: "workspace_create", path: reportPath, content: controlText },
        { context: identity, workspaceId: currentId, signal: new AbortController().signal }
      );
    } catch (error) {
      duplicateRefused =
        String(error.code).includes("WORKSPACE_ALREADY_EXISTS") ||
        String(error.message).includes("WORKSPACE_ALREADY_EXISTS");
      log("duplicate_probe", { code: error.code, error: String(error.message) });
    }
    if (!duplicateRefused) throw Error("DUPLICATE_WRITE_ALLOWED");
    const verified = await workspace.execute(
      { kind: "workspace_read", path: reportPath },
      { context: identity, workspaceId: currentId, signal: new AbortController().signal }
    );
    const after = readFileSync(join(workRoot, reportPath), "utf8");
    if (after !== before) throw Error("FILE_CHANGED_ON_RECOVERY");
    if (!verified.content?.includes(controlText)) throw Error("READBACK_DID_NOT_VERIFY");
    log("recovery", { duplicate: "refused", verified: "workspace_read" });
    return "duplicate create refused; readback verified same bytes";
  });

  await acheck("10 executor respects selected permissions", async () => {
    const currentId = workspace.snapshot(identity)?.id;
    const foreign = { owner: "other-owner", origin: identity.origin };
    let refused = false;
    try {
      await workspace.execute(
        { kind: "workspace_list", path: "", cursor: 0 },
        { context: foreign, workspaceId: currentId, signal: new AbortController().signal }
      );
    } catch {
      refused = true;
    }
    if (!refused) throw Error("FOREIGN_OWNER_ALLOWED");
    if (journal.some((x) => x.event === "native_desktop_input")) throw Error("DESKTOP_INPUT_USED");
    return "foreign owner refused; no native desktop input";
  });

  const resultFile = join(outDir, "result.json");
  const payload = {
    passed: checks.every((c) => c.status === "pass"),
    suite: "koswork-local-cycle",
    at: new Date().toISOString(),
    base: "synthetic deterministic planner + real desktop modules + dedicated temp folder",
    checks,
    result: {
      file: reportPath,
      sha256: sha(readFileSync(join(workRoot, reportPath), "utf8")),
      session: result?.status
    },
    limits: [
      "No Electron binary or installed Windows client was used; GUI/live acceptance is a separate chat.",
      "No paid model, real owner profile or PC control; all data is synthetic and scoped to the temp folder."
    ]
  };
  writeFileSync(resultFile, JSON.stringify(payload, null, 2) + "\n");
  console.log(
    JSON.stringify(
      { ...payload, outDir, actions: join(outDir, "actions.jsonl"), file: resultFile },
      null,
      2
    )
  );
  process.exitCode = payload.passed ? 0 : 1;
}

run().catch((error) => {
  log("fatal", { error: String(error?.message ?? error) });
  console.error(error);
  process.exitCode = 1;
});
