import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { loadServerConfig } from "@cosmora/config";
import {
  openDatabase,
  runMigrations,
  ProjectStore,
  IdentityStore,
  PolicyStore,
  EmergencyStopStore
} from "@cosmora/db";
import type { ComputerStep, ModelRequest } from "@cosmora/contracts";
import {
  GatewayRunError,
  ModelGateway,
  ModelRegistry,
  ModelRouter,
  type ModelProviderAdapter,
  type ProviderStreamEvent
} from "@cosmora/model-gateway";
import { AccountStore } from "../src/account-settings/account-store.js";
import { SharedOwnerBudget } from "../src/account-settings/shared-owner-budget.js";
import { buildModelRuntime, loadModelRegistryDocument } from "../src/model-runtime.js";
import { ComputerControlService } from "../src/computer-control/service.js";
import { buildApp } from "../src/app.js";
import { BearerSessionIdentityResolver } from "../src/identity.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});
const step: ComputerStep = {
  step: 0,
  previous_result: "",
  observation: {
    observation_id: "test-observation",
    active_window: "42",
    description: "Fixture only; not a real desktop capture",
    width: 800,
    height: 600,
    image_jpeg_base64: Buffer.from([255, 216, 255, 217]).toString("base64")
  }
};
const action = {
  action: { kind: "open_url", url: "https://example.test" },
  message: "Открываю страницу",
  requires_confirmation: false
};
async function fixture(
  options: {
    output?: unknown;
    finish?: string;
    vision?: boolean;
    fail?: boolean;
    onCall?: (request: ModelRequest, signal: AbortSignal) => Promise<void>;
  } = {}
) {
  const db = openDatabase(":memory:");
  await runMigrations(db);
  const account = new AccountStore(db.sqlite),
    projects = new ProjectStore(db.sqlite),
    policy = new PolicyStore(db.sqlite),
    emergency = new EmergencyStopStore(db.sqlite);
  const project = projects.createProject("Computer test", "computer-test").project;
  policy.ensureProfile(project.id);
  policy.updateProfile({
    projectId: project.id,
    baseLevel: "A2",
    overrides: [],
    expectedVersion: 1
  });
  const config = loadServerConfig({ NODE_ENV: "test" });
  const runtime = await buildModelRuntime(config);
  const registry = loadModelRegistryDocument("config/model-registry.v1.json");
  registry.entries[0]!.capabilities.vision = options.vision ?? true;
  registry.entries[0]!.context_window_tokens = 200000;
  const calls: ModelRequest[] = [];
  const adapter: ModelProviderAdapter = {
    id: "mock",
    modelId: "manager-b0.1",
    async *stream(request, signal): AsyncGenerator<ProviderStreamEvent> {
      calls.push(request);
      await options.onCall?.(request, signal);
      if (options.fail) throw new GatewayRunError("PROVIDER_ERROR", "mock", "fixture error", true);
      yield { type: "text.delta", delta: JSON.stringify(options.output ?? action) };
      yield {
        type: "response.completed",
        provider: "mock",
        model: "manager-b0.1",
        finishReason: options.finish ?? "stop",
        usage: { inputTokens: 30, outputTokens: 20 }
      };
    }
  };
  const gateway = new ModelGateway([adapter], new ModelRouter(new ModelRegistry(registry)), [], {
    maxAttemptsPerRoute: 3,
    retryBaseDelayMs: 1,
    retryMaxDelayMs: 1,
    circuitFailureThreshold: 10,
    circuitOpenMs: 1000
  });
  let now = Date.now();
  const budget = new SharedOwnerBudget(account, projects);
  const dependencies = {
    account,
    projects,
    policy,
    emergency,
    gateway,
    manager: runtime.manager,
    budget,
    now: () => now
  };
  const service = new ComputerControlService(dependencies);
  cleanups.push(async () => {
    await service.stop();
    db.close();
  });
  const input = {
    client_request_id: randomUUID(),
    client_secret: randomBytes(32).toString("base64url"),
    goal: "Open the fixture webpage",
    max_steps: 3
  };
  const create = () => service.create("local-owner", "local-owner", project.id, input);
  const next = (value = step) =>
    service.next(
      "local-owner",
      project.id,
      input.client_request_id,
      input.client_secret,
      structuredClone(value)
    );
  return {
    db,
    account,
    projects,
    policy,
    emergency,
    config,
    runtime,
    gateway,
    budget,
    dependencies,
    service,
    project,
    input,
    calls,
    create,
    next,
    advance: (ms: number) => {
      now += ms;
    }
  };
}

describe("owner-bound computer proposals", () => {
  it("browser search uses its first-party action on a text-only route", async () => {
    const f = await fixture({
      vision: false,
      output: { ...action, action: { kind: "browser_search", query: "Kosmora sources" } }
    });
    Object.assign(f.input, { execution_mode: "browser" });
    await f.create();
    const value = structuredClone(step);
    delete value.observation.image_jpeg_base64;
    value.observation.browser = { tab_id: "a".repeat(12), generation: 1 };
    expect(await f.next(value)).toMatchObject({
      action: { kind: "browser_search", query: "Kosmora sources" }
    });
    expect(f.calls[0]!.messages[0]!.content).toContain("first-party Kosmora results page");
    expect(f.calls[0]!.messages[1]!.images).toBeUndefined();
  });
  it("browser mode starts on a text-only route and does not transmit a screenshot by default", async () => {
    const f = await fixture({
      vision: false,
      output: { ...action, action: { kind: "browser_open", url: "https://example.test" } }
    });
    Object.assign(f.input, { execution_mode: "browser" });
    expect(await f.create()).toMatchObject({ execution_mode: "browser" });
    const value = structuredClone(step);
    delete value.observation.image_jpeg_base64;
    value.observation.browser = { tab_id: "a".repeat(12), generation: 1 };
    expect(await f.next(value)).toMatchObject({ action: { kind: "browser_open" } });
    expect(f.calls[0]!.messages[1]!.images).toBeUndefined();
    expect(f.calls[0]!.routing.required_features).not.toContain("vision");
    expect(f.calls[0]!.messages[0]!.content).toContain("no desktop, shell");
  });
  it("browser image requests require a vision route before dispatch, with no automatic fallback", async () => {
    const f = await fixture({ vision: false });
    Object.assign(f.input, { execution_mode: "browser" });
    await f.create();
    const value = structuredClone(step);
    value.observation.browser = { tab_id: "a".repeat(12), generation: 1 };
    await expect(f.next(value)).rejects.toThrow();
    expect(f.calls).toHaveLength(0);
  });
  it("browser sessions reject native OS commands and computer sessions reject browser commands", async () => {
    const a = await fixture();
    Object.assign(a.input, { execution_mode: "browser" });
    await a.create();
    const value = structuredClone(step);
    delete value.observation.image_jpeg_base64;
    value.observation.browser = { tab_id: "a".repeat(12), generation: 1 };
    await expect(a.next(value)).rejects.toMatchObject({ code: "COMPUTER_OUTPUT_INVALID" });
    const b = await fixture({ output: { ...action, action: { kind: "browser_read" } } });
    await b.create();
    await expect(b.next()).rejects.toMatchObject({ code: "COMPUTER_OUTPUT_INVALID" });
  });
  it.each([
    { kind: "workspace_list", path: "", cursor: 0 },
    { kind: "workspace_find", path: "", mode: "text", query: "summary" },
    { kind: "workspace_read", path: "note.md" },
    { kind: "workspace_mkdir", path: "reports" },
    { kind: "workspace_create", path: "empty.md", content: "" },
    {
      kind: "workspace_update",
      path: "note.md",
      content: "updated",
      expected_version: "sha256:" + "a".repeat(64)
    },
    { kind: "workspace_backups", path: "note.md" },
    {
      kind: "workspace_restore",
      backup_id: "bkp_1000_abcdef123456",
      expected_version: "sha256:" + "a".repeat(64)
    }
  ])(
    "validates $kind through the real Gateway with advertised selected-folder capability",
    async (workspaceAction) => {
      const f = await fixture({ output: { ...action, action: workspaceAction } });
      await f.create();
      const value = structuredClone(step);
      value.observation.workspace = { id: "a".repeat(24), name: "Owner project" };
      expect(await f.next(value)).toMatchObject({ action: workspaceAction });
      expect(f.calls).toHaveLength(1);
      expect(f.calls[0]!.messages[1]!.content).toContain("Owner project");
      expect(f.calls[0]!.messages[0]!.content).toContain(
        "Never overwrite a file using guessed or truncated content"
      );
    }
  );
  it("rejects a file-tool proposal when no selected-folder capability was advertised", async () => {
    const f = await fixture({
      output: { ...action, action: { kind: "workspace_read", path: "note.md" } }
    });
    await f.create();
    await expect(f.next()).rejects.toMatchObject({ code: "COMPUTER_OUTPUT_INVALID" });
  });
  it.each([
    { kind: "hover", x: 0.2, y: 0.3 },
    { kind: "drag", from_x: 0.2, from_y: 0.3, to_x: 0.8, to_y: 0.3 },
    { kind: "scroll", direction: "left", amount: 2 }
  ])("validates pointer proposal $kind without executing OS input", async (pointerAction) => {
    const f = await fixture({ output: { ...action, action: pointerAction } });
    await f.create();
    expect(await f.next()).toMatchObject({
      action: pointerAction,
      decision_source: { mode: "test" }
    });
    expect(f.calls).toHaveLength(1);
  });
  it("authorizes one exact action once and refuses a project pause before native input", async () => {
    const f = await fixture();
    await f.create();
    await f.next();
    const input = {
      step: 0,
      action_hash: createHash("sha256").update(JSON.stringify(action.action)).digest("hex")
    };
    expect(
      f.service.authorize(
        "local-owner",
        f.project.id,
        f.input.client_request_id,
        f.input.client_secret,
        input
      )
    ).toEqual({ authorized: true, valid_for_ms: 10000 });
    expect(() =>
      f.service.authorize(
        "local-owner",
        f.project.id,
        f.input.client_request_id,
        f.input.client_secret,
        input
      )
    ).toThrow("CONFLICT");
    const other = await fixture();
    await other.create();
    await other.next();
    other.db.sqlite
      .prepare("INSERT INTO work_project_controls VALUES (?,?,'paused')")
      .run(other.project.id, "local-owner");
    expect(() =>
      other.service.authorize(
        "local-owner",
        other.project.id,
        other.input.client_request_id,
        other.input.client_secret,
        input
      )
    ).toThrow("STOPPED");
  });
  it("cannot restore a native grant by replaying its policy audit after an API restart", async () => {
    const f = await fixture();
    await f.create();
    await f.service.stop();
    const restarted = new ComputerControlService(f.dependencies);
    cleanups.push(() => restarted.stop());
    await expect(
      restarted.create("local-owner", "local-owner", f.project.id, f.input)
    ).rejects.toThrow("RECOVERY_REQUIRED");
    expect(f.calls).toHaveLength(0);
  });
  it("activates a prepared project only when its first computer task is authorized", async () => {
    const f = await fixture();
    const id = randomUUID();
    f.projects.createEmptyProject(id, "Prepared");
    f.policy.ensureProfile(id);
    f.policy.updateProfile({ projectId: id, baseLevel: "A2", overrides: [], expectedVersion: 1 });
    expect(f.projects.getProject(id)?.status).toBe("DRAFT");
    await f.service.create("local-owner", "local-owner", id, f.input);
    expect(f.projects.getProject(id)?.status).toBe("ACTIVE");
    expect(f.calls).toHaveLength(0);
  });
  it("uses the real gateway and canonical accounting, includes a vision observation, replays without another request", async () => {
    const f = await fixture();
    const accepted = await f.create();
    expect(await f.create()).toEqual(accepted);
    expect(accepted.planner).toEqual({ kind: "model_gateway", mode: "test" });
    const decision = await f.next();
    expect(decision).toMatchObject({
      ...action,
      decision_source: {
        kind: "model_gateway",
        mode: "test",
        provider_id: "mock",
        model_id: "manager-b0.1",
        session_id: accepted.id,
        step: 0
      }
    });
    expect(decision.decision_source.run_id).toBe(f.calls[0]!.run_id);
    expect(await f.next()).toEqual(decision);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.messages[1]!.images).toHaveLength(1);
    expect(f.calls[0]!.messages[0]!.content).toContain("untrusted evidence");
    const runs = f.db.sqlite
      .prepare("SELECT id,status FROM runs WHERE id=?")
      .all(f.calls[0]!.run_id);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("succeeded");
    const ledger = f.projects.getModelUsageForRun(String(runs[0]!.id));
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.status).toBe("committed");
  });
  it("binds secret, owner, project, accepted goal and step fingerprints", async () => {
    const f = await fixture();
    await f.create();
    expect(() =>
      f.service.next("other", f.project.id, f.input.client_request_id, f.input.client_secret, step)
    ).toThrow("NOT_FOUND");
    expect(() =>
      f.service.next(
        "local-owner",
        "other-project",
        f.input.client_request_id,
        f.input.client_secret,
        step
      )
    ).toThrow("NOT_FOUND");
    expect(() =>
      f.service.next("local-owner", f.project.id, f.input.client_request_id, "wrong", step)
    ).toThrow("NOT_FOUND");
    await expect(
      f.service.create("local-owner", "local-owner", f.project.id, { ...f.input, goal: "changed" })
    ).rejects.toThrow("CONFLICT");
    expect(() => f.next({ ...step, step: 1 })).toThrow("CONFLICT");
    await f.next();
    expect(() => f.next({ ...step, previous_result: "changed" })).toThrow("CONFLICT");
    expect(f.calls).toHaveLength(1);
  });
  it("rejects malformed image bytes before model dispatch", async () => {
    const f = await fixture();
    await f.create();
    expect(() =>
      f.next({
        ...step,
        observation: {
          ...step.observation,
          image_jpeg_base64: Buffer.from("not jpeg").toString("base64")
        }
      })
    ).toThrow("IMAGE_INVALID");
    expect(f.calls).toHaveLength(0);
  });
  it("enforces policy before authorizing a local session and revokes it on policy change", async () => {
    const f = await fixture();
    await f.create();
    f.policy.updateProfile({
      projectId: f.project.id,
      baseLevel: "A0",
      overrides: [],
      expectedVersion: 2
    });
    expect(() => f.next()).toThrow("STOPPED");
    await expect(
      f.service.create("local-owner", "local-owner", f.project.id, {
        ...f.input,
        client_request_id: randomUUID()
      })
    ).rejects.toThrow();
    expect(f.calls).toHaveLength(0);
  });
  it("does not fall back to a non-vision route", async () => {
    const f = await fixture({ vision: false });
    await expect(f.create()).rejects.toThrow("COMPUTER_ROUTE_UNAVAILABLE");
    expect(f.calls).toHaveLength(0);
  });
  it("checks the vision route before activating an empty project or creating a run", async () => {
    const f = await fixture({ vision: false });
    const id = randomUUID();
    f.projects.createEmptyProject(id, "Prepared");
    f.policy.ensureProfile(id);
    f.policy.updateProfile({ projectId: id, baseLevel: "A2", overrides: [], expectedVersion: 1 });
    await expect(f.service.create("local-owner", "local-owner", id, f.input)).rejects.toThrow(
      "COMPUTER_ROUTE_UNAVAILABLE"
    );
    expect(f.projects.getProject(id)?.status).toBe("DRAFT");
    expect(
      f.db.sqlite.prepare("SELECT COUNT(*) AS count FROM runs WHERE project_id=?").get(id)?.count
    ).toBe(0);
    expect(f.calls).toHaveLength(0);
  });
  it("does not accept a decision-source claim supplied by the model", async () => {
    const f = await fixture({
      output: { ...action, decision_source: { kind: "model_gateway", mode: "provider" } }
    });
    await f.create();
    await expect(f.next()).rejects.toThrow("COMPUTER_OUTPUT_INVALID");
    expect(f.calls).toHaveLength(1);
  });
  it("keeps a human checkpoint in the same bounded session without another creation", async () => {
    const f = await fixture({
      output: {
        action: { kind: "ask_user", question: "Unlock the app locally" },
        message: "Waiting",
        requires_confirmation: false
      }
    });
    await f.create();
    await f.next();
    expect(f.calls).toHaveLength(1);
    const after = await f.next({ ...step, step: 1, previous_result: '{"status":"owner_resumed"}' });
    expect(after.decision_source.step).toBe(1);
    expect(after.decision_source.session_id).toBe(f.input.client_request_id);
    expect(f.calls).toHaveLength(2);
    expect(f.calls[1]!.messages[1]!.content).toContain("owner_resumed");
    f.service.end("local-owner", f.project.id, f.input.client_request_id, f.input.client_secret);
    expect(() => f.next({ ...step, step: 2 })).toThrow("STOPPED");
  });
  it("refuses unrecognized model actions and extra authority fields after accounting for the call", async () => {
    const f = await fixture({
      output: { ...action, action: { kind: "shell", command: "whoami" } }
    });
    await f.create();
    await expect(f.next()).rejects.toThrow("OUTPUT_INVALID");
    expect(f.calls).toHaveLength(1);
    expect(
      f.db.sqlite.prepare("SELECT status FROM runs WHERE id=?").get(f.calls[0]!.run_id)?.status
    ).toBe("succeeded");
  });
  it("refuses a truncated completion even if its JSON happens to parse", async () => {
    const f = await fixture({ finish: "length" });
    await f.create();
    await expect(f.next()).rejects.toThrow("OUTPUT_INCOMPLETE");
    expect(f.calls).toHaveLength(1);
  });
  it("never silently retries a paid model call", async () => {
    const f = await fixture({ fail: true });
    await f.create();
    await expect(f.next()).rejects.toThrow();
    expect(f.calls).toHaveLength(1);
    expect(() => f.next()).toThrow("STOPPED");
  });
  it("holds the slot until a late transport settles and refuses its action after stop", async () => {
    let release!: () => void, entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const f = await fixture({
      onCall: async () => {
        entered();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
    });
    await f.create();
    const pending = f.next();
    await ready;
    expect(() => f.next()).toThrow("CONFLICT");
    f.service.end("local-owner", f.project.id, f.input.client_request_id, f.input.client_secret);
    await expect(
      f.service.create("local-owner", "local-owner", f.project.id, {
        ...f.input,
        client_request_id: randomUUID()
      })
    ).rejects.toThrow("BUSY");
    release();
    await expect(pending).rejects.toThrow("STOPPED");
    expect(
      f.db.sqlite.prepare("SELECT status FROM runs WHERE id=?").get(f.calls[0]!.run_id)?.status
    ).toBe("failed");
    expect(
      f.db.sqlite
        .prepare("SELECT status FROM kosmora_usage_holds WHERE run_id=?")
        .get(f.calls[0]!.run_id)?.status
    ).toBe("uncertain");
  });
  it("expires sessions and blocks dispatch under a durable owner privacy fence", async () => {
    const f = await fixture();
    await f.create();
    f.advance(30 * 60_000);
    expect(() => f.next()).toThrow("STOPPED");
    const other = await fixture();
    await other.create();
    other.db.sqlite
      .prepare(
        "INSERT INTO kosmora_owner_data_lifecycle(owner_id,state,epoch,operation_id,started_at,updated_at) VALUES (?,'quiescing',1,'fixture',?,?)"
      )
      .run("local-owner", new Date().toISOString(), new Date().toISOString());
    expect(() => other.next()).toThrow("STOPPED");
    expect(other.calls).toHaveLength(0);
  });
  it("privacy export requires a fence, contains no screenshot or session secret, and deletion checks the epoch", async () => {
    const f = await fixture();
    await f.create();
    await f.next();
    const adapter = f.service.privacyAdapter();
    expect(() => adapter.export("local-owner")).toThrow("FENCE_REQUIRED");
    f.db.sqlite
      .prepare(
        "INSERT INTO kosmora_owner_data_lifecycle(owner_id,state,epoch,operation_id,started_at,updated_at) VALUES (?,'quiescing',1,'fixture',?,?)"
      )
      .run("local-owner", new Date().toISOString(), new Date().toISOString());
    await adapter.quiesce("local-owner", 1);
    const exported = JSON.stringify(await adapter.export("local-owner"));
    expect(exported).toContain(f.input.goal);
    expect(exported).not.toContain(f.input.client_secret);
    expect(exported).not.toContain(step.observation.image_jpeg_base64);
    f.db.sqlite
      .prepare("UPDATE kosmora_owner_data_lifecycle SET state='deleting' WHERE owner_id=?")
      .run("local-owner");
    expect(() => adapter.delete("local-owner", 2)).toThrow("FENCE_REQUIRED");
    expect((await adapter.delete("local-owner", 1)).deleted_records).toBe(1);
  });
  it("registers HTTP routes with validation and no-store responses", async () => {
    const f = await fixture();
    const app = buildApp({
      config: f.config,
      database: f.db,
      accountStore: f.account,
      projectStore: f.projects,
      policyStore: f.policy,
      emergencyStopStore: f.emergency,
      modelGateway: f.gateway,
      manager: f.runtime.manager,
      ownerBudget: f.budget,
      computerControl: { enabled: true }
    });
    cleanups.push(() => app.close());
    const root = `/api/v1/projects/${f.project.id}/computer-sessions`;
    const created = await app.inject({ method: "POST", url: root, payload: f.input });
    expect(created.statusCode, created.body).toBe(200);
    expect(created.headers["cache-control"]).toBe("private, no-store");
    const url = `${root}/${f.input.client_request_id}/step`;
    expect((await app.inject({ method: "POST", url, payload: step })).statusCode).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url,
          headers: { "x-kosmora-computer-token": f.input.client_secret },
          payload: { ...step, shell: "x" }
        })
      ).statusCode
    ).toBe(400);
    const response = await app.inject({
      method: "POST",
      url,
      headers: { "x-kosmora-computer-token": f.input.client_secret },
      payload: step
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      ...action,
      decision_source: {
        mode: "test",
        kind: "model_gateway",
        session_id: f.input.client_request_id,
        step: 0
      }
    });
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `${root}/${f.input.client_request_id}`,
          headers: { "x-kosmora-computer-token": f.input.client_secret }
        })
      ).json()
    ).toEqual({ stopped: true });
  });
  it("requires an owner login and rejects foreign owners and agent sessions at the HTTP boundary", async () => {
    const f = await fixture();
    const identities = new IdentityStore(f.db.sqlite);
    const token = (owner: string, kind: "owner" | "agent") => {
      const actor = `${owner}-${kind}`;
      identities.registerActor(owner, actor, kind);
      return identities.issueSession({
        ownerId: owner,
        actorId: actor,
        assurance: "single_factor",
        ttlMs: 60000
      }).token;
    };
    const owner = token("local-owner", "owner"),
      foreign = token("foreign-owner", "owner"),
      agent = token("local-owner", "agent");
    const app = buildApp({
      config: f.config,
      database: f.db,
      accountStore: f.account,
      projectStore: f.projects,
      policyStore: f.policy,
      emergencyStopStore: f.emergency,
      modelGateway: f.gateway,
      manager: f.runtime.manager,
      ownerBudget: f.budget,
      computerControl: { enabled: true },
      identityStore: identities,
      identityResolver: new BearerSessionIdentityResolver(identities)
    });
    cleanups.push(() => app.close());
    const root = `/api/v1/projects/${f.project.id}/computer-sessions`;
    expect((await app.inject({ method: "POST", url: root, payload: f.input })).statusCode).toBe(
      401
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url: root,
          payload: f.input,
          headers: { authorization: `Bearer ${agent}` }
        })
      ).statusCode
    ).toBe(403);
    const denied = await app.inject({
      method: "POST",
      url: root,
      payload: f.input,
      headers: { authorization: `Bearer ${foreign}` }
    });
    expect(denied.statusCode).toBe(409);
    const created = await app.inject({
      method: "POST",
      url: root,
      payload: f.input,
      headers: { authorization: `Bearer ${owner}` }
    });
    expect(created.statusCode, created.body).toBe(200);
    expect(f.calls).toHaveLength(0);
  });
});
