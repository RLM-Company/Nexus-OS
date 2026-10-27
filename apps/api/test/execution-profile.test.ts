import { openDatabase, runMigrations } from "@cosmora/db";
import { afterEach, expect, it, vi } from "vitest";
import type { ModelGateway } from "@cosmora/model-gateway";
import type { ModelRequest } from "@cosmora/contracts";
import { AccountStore, PreferenceConflictError } from "../src/account-settings/account-store.js";
import { RelayExecution } from "../src/account-settings/relay-execution.js";
const databases: ReturnType<typeof openDatabase>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
async function fixture() {
  const db = openDatabase(":memory:");
  databases.push(db);
  await runMigrations(db);
  const store = new AccountStore(db.sqlite);
  store.migrate();
  return { db, store };
}
it("persists profiles and autonomy per owner with CAS and a durable privacy fence", async () => {
  const { db, store } = await fixture();
  expect(store.getExecution("owner")).toEqual({
    version: 0,
    model_profile: "mars",
    autonomy: 2,
    turbo: false
  });
  expect(
    store.setExecution("owner", {
      expected_version: 0,
      model_profile: "jupiter",
      autonomy: 6,
      turbo: true
    })
  ).toEqual({ version: 1, model_profile: "jupiter", autonomy: 6, turbo: true });
  expect(new AccountStore(db.sqlite).getExecution("owner").model_profile).toBe("jupiter");
  expect(store.getExecution("other").turbo).toBe(false);
  expect(() =>
    store.setExecution("owner", {
      expected_version: 0,
      model_profile: "mars",
      autonomy: 0,
      turbo: false
    })
  ).toThrow(PreferenceConflictError);
  expect(() =>
    store.setExecution("owner", {
      expected_version: 1,
      model_profile: "mars",
      autonomy: 7,
      turbo: false
    })
  ).toThrow();
  db.sqlite
    .prepare(
      "INSERT INTO kosmora_owner_data_lifecycle(owner_id,epoch,state,operation_id,started_at,updated_at) VALUES(?,1,'deleting','wipe',?,?)"
    )
    .run("owner", new Date().toISOString(), new Date().toISOString());
  expect(() =>
    store.setExecution("owner", {
      expected_version: 1,
      model_profile: "mars",
      autonomy: 2,
      turbo: false
    })
  ).toThrow("OWNER_DATA_FENCED");
  expect(store.getExecution("owner").version).toBe(1);
});
it("Turbo changes the actual request, skips optional translation and preserves output budget", async () => {
  const { store } = await fixture();
  store.update("owner", {
    expected_version: 0,
    relay_enabled: true,
    response_language: "ru",
    optimize_for: "quality",
    preferred_provider: null,
    preferred_model: null,
    chat_style: "standard",
    max_total_tokens: null
  });
  store.setReasoning("owner", "high");
  store.setExecution("owner", {
    expected_version: 0,
    model_profile: "jupiter",
    autonomy: 5,
    turbo: true
  });
  const stream = vi.fn();
  const relay = new RelayExecution(store, { stream } as unknown as ModelGateway);
  const request: ModelRequest = {
    request_id: "req",
    project_id: "chat",
    run_id: "run",
    agent_id: "assistant",
    role: "assistant",
    task_type: "chat_response",
    messages: [
      { role: "system", content: "System" },
      { role: "user", content: "Write a detailed plan" }
    ],
    constraints: { max_output_tokens: 4096, timeout_ms: 30000 },
    routing: {
      preferred_provider: "cheapvibecode",
      preferred_model_alias: "gpt-6.1-sol",
      fallback_allowed: false,
      required_features: ["streaming"],
      confidential: false,
      estimated_input_tokens: 100,
      max_cost: null,
      optimize_for: "quality"
    },
    idempotency_key: "run"
  };
  const prepared = await relay.prepare(
    "owner",
    "chat",
    "run",
    request,
    new AbortController().signal
  );
  expect(prepared.relay).toBe(false);
  expect(stream).not.toHaveBeenCalled();
  expect(prepared.request.routing.optimize_for).toBe("latency");
  expect(prepared.request.constraints.reasoning_effort).toBe("low");
  expect(prepared.request.constraints.max_output_tokens).toBe(4096);
  expect(prepared.request.messages.some((m) => m.content.includes("initiative level: 5/6"))).toBe(
    true
  );
  expect(request.messages).toHaveLength(2);
  expect(store.getReasoning("owner")).toBe("high");
});
