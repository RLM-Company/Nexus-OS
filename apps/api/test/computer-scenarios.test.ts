import { afterEach, describe, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { loadServerConfig } from "@cosmora/config";
import {
  openDatabase,
  runMigrations,
  ProjectStore,
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

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64");
const workspace = {
  id: "b".repeat(24),
  name: "Scenario folder",
  read_lines: true as const,
  create_documents: true as const,
  read_documents: true as const
};

/** Real service + mock gateway; each next() gets the caller's fresh observation. */
async function scenario(options: {
  mode: "browser" | "computer" | "work";
  decisions: Array<Record<string, unknown>>;
  observation: (step: number) => Partial<ComputerStep["observation"]>;
}) {
  const db = openDatabase(":memory:");
  await runMigrations(db);
  const account = new AccountStore(db.sqlite),
    projects = new ProjectStore(db.sqlite),
    policy = new PolicyStore(db.sqlite),
    emergency = new EmergencyStopStore(db.sqlite);
  const project = projects.createProject("Scenario test", "scenario-test", "local-owner").project;
  policy.ensureProfile(project.id);
  policy.updateProfile({
    projectId: project.id,
    baseLevel: "A2",
    overrides: [],
    expectedVersion: 1
  });
  const config = loadServerConfig({ NODE_ENV: "test", MOCK_PROVIDER_MODE: "success" });
  const runtime = await buildModelRuntime(config);
  const registry = loadModelRegistryDocument("config/model-registry.v1.json");
  registry.entries[0]!.capabilities.vision = true;
  registry.entries[0]!.context_window_tokens = 200000;
  const calls: ModelRequest[] = [];
  let index = 0;
  const adapter: ModelProviderAdapter = {
    id: "mock",
    modelId: "manager-b0.1",
    async *stream(request, signal): AsyncGenerator<ProviderStreamEvent> {
      calls.push(request);
      await Promise.resolve(signal);
      const action = options.decisions[index++];
      if (!action) throw new GatewayRunError("PROVIDER_ERROR", "mock", "script exhausted", true);
      yield {
        type: "text.delta",
        delta: JSON.stringify({
          action,
          message: "synthetic scenario",
          requires_confirmation: false
        })
      };
      yield {
        type: "response.completed",
        provider: "mock",
        model: "manager-b0.1",
        finishReason: "stop",
        usage: { inputTokens: 30, outputTokens: 20 }
      };
    }
  };
  const gateway = new ModelGateway([adapter], new ModelRouter(new ModelRegistry(registry)), [], {
    maxAttemptsPerRoute: 1,
    retryBaseDelayMs: 1,
    retryMaxDelayMs: 1,
    circuitFailureThreshold: 10,
    circuitOpenMs: 1000
  });
  const budget = new SharedOwnerBudget(account, projects);
  const service = new ComputerControlService({
    account,
    projects,
    policy,
    emergency,
    gateway,
    manager: runtime.manager,
    budget,
    now: Date.now
  });
  cleanups.push(async () => {
    await service.stop();
    db.close();
  });
  const input = {
    client_request_id: randomUUID(),
    client_secret: randomBytes(32).toString("base64url"),
    goal: "Open the local site, fill the form and save the result",
    max_steps: 12,
    execution_mode: options.mode
  };
  await service.create("local-owner", "local-owner", project.id, input);
  const step = (i: number): ComputerStep => ({
    step: i,
    previous_result: i === 0 ? "" : `result after step ${i - 1}`,
    observation: {
      observation_id: "obs-" + i,
      active_window: "42",
      description: `observation ${i}`,
      width: 800,
      height: 600,
      ...options.observation(i)
    }
  });
  const next = (i: number) =>
    service.next("local-owner", project.id, input.client_request_id, input.client_secret, step(i));
  return {
    service,
    next,
    calls,
    projectId: project.id,
    requestId: input.client_request_id,
    secret: input.client_secret,
    goal: input.goal,
    decisions: options.decisions
  };
}

const browser = (i: number) => ({ browser: { tab_id: "a".repeat(12), generation: i } });
const workBrowser = (i: number) => ({
  work: { environment: "browser" as const, generation: i, plan_steps: 4, plan_complete: false },
  ...browser(i)
});

describe("Koswork local executor scenarios", () => {
  it("open site → fill form → submit → save verified result → done on fresh observations", async () => {
    const decisions = [
      {
        kind: "work_plan",
        steps: [
          { title: "Open site", criteria: "form visible" },
          { title: "Fill form", criteria: "field contains marker" },
          { title: "Submit", criteria: "confirmation visible" },
          { title: "Save result", criteria: "file verified" }
        ]
      },
      { kind: "work_step", step: 1, state: "running", evidence: "", observation_id: "obs-1" },
      { kind: "work_switch", environment: "browser" },
      { kind: "browser_open", url: "http://127.0.0.1:49999/local-form" },
      { kind: "browser_fill", ref: "e1", text: "19 700 ₽" },
      { kind: "browser_click", ref: "e2" },
      { kind: "work_switch", environment: "computer" },
      { kind: "workspace_create", path: "result.md", content: "19 700 ₽ saved" },
      { kind: "done", summary: "Form submitted and result file verified" }
    ];
    const s = await scenario({
      mode: "work",
      decisions,
      observation: (i) =>
        i >= 3 && i <= 5
          ? {
              ...workBrowser(i),
              work: { ...workBrowser(i).work, plan_complete: i === 5 },
              workspace
            }
          : {
              image_jpeg_base64: jpeg,
              work: {
                environment: "computer" as const,
                generation: i,
                plan_steps: 4,
                plan_complete: i >= 8
              },
              workspace
            }
    });
    const kinds: string[] = [];
    for (let i = 0; i < decisions.length; i++) {
      try {
        const decision = await s.next(i);
        kinds.push((decision.action as { kind: string }).kind);
      } catch (error) {
        throw new Error(`step ${i}: ${(error as Error).message}`, { cause: error });
      }
    }
    expect(kinds).toEqual(decisions.map((d) => d.kind));
    // Every response came from a separately numbered observation packet.
    for (let i = 0; i < s.calls.length; i++)
      expect(s.calls[i]!.messages[1]!.content).toContain(`observation ${i}`);
    expect(s.calls[0]!.messages[0]!.content).toContain("work_plan");
  });

  it("browser actions require an advertised tab and a matching execution mode", async () => {
    const s = await scenario({
      mode: "browser",
      decisions: [{ kind: "browser_fill", ref: "e1", text: "x" }],
      observation: () => ({ image_jpeg_base64: jpeg })
    });
    expect(() => s.next(0)).toThrow();
    expect(s.calls).toHaveLength(0);
  });

  it("a new observation is required for the next action", async () => {
    const s = await scenario({
      mode: "browser",
      decisions: [{ kind: "browser_read" }, { kind: "browser_read" }],
      observation: (i) => browser(i)
    });
    expect(await s.next(0)).toMatchObject({ action: { kind: "browser_read" } });
    // Identical step/observation previous_result returns the cached decision;
    // a different observation produces a new packet and the next script step.
    const second = await s.next(1);
    expect(second).toMatchObject({ action: { kind: "browser_read" } });
    expect(s.calls).toHaveLength(2);
  });

  it("handoff pauses for the owner, stop ends the task and reconnect needs a fresh session", async () => {
    const s = await scenario({
      mode: "work",
      decisions: [
        { kind: "work_plan", steps: [{ title: "Ask owner", criteria: "unlocked" }] },
        { kind: "ask_user", question: "Unlock the local form" },
        { kind: "work_step", step: 1, state: "running", evidence: "", observation_id: "obs-2" },
        { kind: "done", summary: "owner resumed" }
      ],
      observation: (i) => ({
        image_jpeg_base64: jpeg,
        work: {
          environment: "computer" as const,
          generation: i,
          plan_steps: 1,
          plan_complete: i >= 3
        }
      })
    });
    expect(await s.next(0)).toMatchObject({ action: { kind: "work_plan" } });
    expect(await s.next(1)).toMatchObject({ action: { kind: "ask_user" } });
    // Owner resumes locally; the model gets a fresh observation, not credentials.
    const resumed = await s.next(2);
    expect(resumed).toMatchObject({ action: { kind: "work_step" } });
    expect(s.calls[2]!.messages[1]!.content).toContain("result after step 1");

    // Device disconnect / owner stop: the session ends and no late action is accepted.
    expect(s.service.end("local-owner", s.projectId, s.requestId, s.secret)).toEqual({
      stopped: true
    });
    expect(() => s.next(3)).toThrow();

    // Reconnect: the same goal creates a fresh session; the old action hash
    // cannot authorize anything in it (no inherited grant).
    const reconnected = await s.service.create("local-owner", "local-owner", s.projectId, {
      client_request_id: "reconnect-" + Date.now(),
      client_secret: randomBytes(32).toString("base64url"),
      goal: s.goal,
      max_steps: 8,
      execution_mode: "work"
    });
    expect(typeof reconnected.id).toBe("string");
    expect(reconnected.id).not.toBe(s.requestId);
    expect(() =>
      s.service.authorize("local-owner", s.projectId, s.requestId, s.secret, {
        step: 0,
        action_hash: "a".repeat(64)
      })
    ).toThrow();
  });
});
