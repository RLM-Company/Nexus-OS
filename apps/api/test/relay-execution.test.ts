import { afterEach, describe, expect, it } from "vitest";
import type { ModelRequest } from "@cosmora/contracts";
import { estimateInputTokensUpperBound } from "@cosmora/core";
import { GeneralChatStore, openDatabase, runMigrations, type DatabaseHandle } from "@cosmora/db";
import type { ModelGateway, ModelGatewayStreamEvent } from "@cosmora/model-gateway";
import { AccountStore, QuotaExceededError } from "../src/account-settings/account-store.js";
import {
  RelayExecution,
  RelayUnavailableError,
  RelayProtectionError
} from "../src/account-settings/relay-execution.js";

const databases: DatabaseHandle[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
const fixture = async () => {
  const db = openDatabase(":memory:");
  databases.push(db);
  await runMigrations(db);
  const chat = new GeneralChatStore(db.sqlite).createChat("Привет", "relay-test", "owner");
  const store = new AccountStore(db.sqlite);
  const request: ModelRequest = {
    request_id: "request-1",
    project_id: chat.chat.id,
    run_id: chat.run.id,
    agent_id: "manager",
    role: "manager",
    task_type: "project_chat",
    messages: [
      { role: "system", content: "System" },
      { role: "user", content: "Привет" }
    ],
    constraints: { timeout_ms: 1000, max_output_tokens: 500 },
    routing: {
      preferred_provider: "live",
      preferred_model_alias: "model",
      fallback_allowed: false,
      required_features: ["streaming"],
      confidential: false,
      estimated_input_tokens: 100,
      max_cost: null,
      optimize_for: "balanced"
    },
    idempotency_key: "run-1"
  };
  return { store, request, chatId: chat.chat.id, runId: chat.run.id };
};
const gateway = (
  transform: (request: ModelRequest) => string,
  seen: ModelRequest[],
  finish = "stop",
  toolCall = false,
  usage: { inputTokens: number | null; outputTokens: number | null } = {
    inputTokens: 20,
    outputTokens: 10
  }
) =>
  ({
    async *stream(request: ModelRequest): AsyncGenerator<ModelGatewayStreamEvent> {
      await Promise.resolve();

      seen.push(request);
      const route = {
        attempt: 1,
        registry_version: "fixture",
        provider_id: "live",
        model_id: "model",
        estimated_input_tokens: request.routing.estimated_input_tokens,
        max_output_tokens: request.constraints.max_output_tokens,
        estimated_cost: null
      };
      yield { type: "route.selected", route };
      if (toolCall)
        yield {
          type: "tool.call",
          id: "translation-tool",
          name: "invalid_translation_tool",
          arguments: "{}"
        };
      yield { type: "text.delta", delta: transform(request) };
      yield {
        type: "response.completed",
        route,
        provider: "live",
        model: "model",
        finishReason: finish,
        usage,
        calculatedCost: null
      };
    }
  }) as unknown as ModelGateway;

describe("English Relay integration with canonical account schema", () => {
  it("fails closed on the newly integrated tool-call event instead of treating it as completion", async () => {
    const { store, request, chatId, runId } = await fixture();
    const relay = new RelayExecution(
      store,
      gateway(() => "Hello", [], "stop", true)
    );
    await expect(
      relay.translate(
        "owner",
        chatId,
        runId,
        request,
        "Привет",
        "to_en",
        new AbortController().signal
      )
    ).rejects.toBeInstanceOf(RelayUnavailableError);
    expect(store.usage("owner").rows[0]).toMatchObject({ status: "uncertain" });
  });
  it("starts OFF and does not invoke a translator", async () => {
    const { store, request, chatId, runId } = await fixture();
    const seen: ModelRequest[] = [];
    const prepared = await new RelayExecution(
      store,
      gateway(() => "English", seen)
    ).prepare("owner", chatId, runId, request, new AbortController().signal);
    expect(prepared.relay).toBe(false);
    expect(prepared.request.messages).toEqual(request.messages);
    expect(seen).toHaveLength(0);
  });
  it("translates model copies and charges both translation stages separately", async () => {
    const { store, request, chatId, runId } = await fixture();
    const seen: ModelRequest[] = [];
    store.setChatRelay("owner", chatId, true);
    const relay = new RelayExecution(
      store,
      gateway((req) => (req.messages[1]?.content === "Привет" ? "Hello" : "Привет"), seen)
    );
    const prepared = await relay.prepare(
      "owner",
      chatId,
      runId,
      request,
      new AbortController().signal
    );
    expect(prepared.request.messages[1]?.content).toBe("Hello");
    expect(request.messages[1]?.content).toBe("Привет");
    expect(
      await relay.finish(
        "owner",
        chatId,
        runId,
        prepared.request,
        "Hello",
        new AbortController().signal
      )
    ).toBe("Привет");
    expect(store.summary("owner").translation_tokens_or_upper_bound).toBe(60);
    for (const req of seen)
      expect(req.routing.estimated_input_tokens).toBe(estimateInputTokensUpperBound(req.messages));
  });
  it("protects code bytes through actual execution and rejects a missing marker", async () => {
    const { store, request, chatId, runId } = await fixture();
    const seen: ModelRequest[] = [];
    const relay = new RelayExecution(
      store,
      gateway((req) => req.messages[1]!.content.replace("Объясни", "Explain"), seen)
    );
    expect(
      await relay.translate(
        "owner",
        chatId,
        runId,
        request,
        "Объясни `const x=1;`",
        "to_en",
        new AbortController().signal
      )
    ).toBe("Explain `const x=1;`");
    const broken = new RelayExecution(
      store,
      gateway(() => "No protected markers", [])
    );
    await expect(
      broken.translate(
        "owner",
        chatId,
        "second-run",
        request,
        "Объясни `const x=1;`",
        "to_en",
        new AbortController().signal
      )
    ).rejects.toBeInstanceOf(RelayProtectionError);
  });
  it("rejects truncated output while accounting for its verified usage", async () => {
    const { store, request, chatId, runId } = await fixture();
    const relay = new RelayExecution(
      store,
      gateway(() => "Hello", [], "length")
    );
    await expect(
      relay.translate(
        "owner",
        chatId,
        runId,
        request,
        "Привет",
        "to_en",
        new AbortController().signal
      )
    ).rejects.toBeInstanceOf(RelayUnavailableError);
    expect(store.usage("owner").rows[0]).toMatchObject({ status: "committed" });
    expect(store.summary("owner").translation_tokens_or_upper_bound).toBe(30);
  });
  it("rejects secrets before network and quota before the provider resumes after route selection", async () => {
    const { store, request, chatId, runId } = await fixture();
    const seen: ModelRequest[] = [];
    let dispatched = 0;
    const relay = new RelayExecution(
      store,
      gateway(() => {
        dispatched++;
        return "Hello";
      }, seen)
    );
    await expect(
      relay.translate(
        "owner",
        chatId,
        runId,
        request,
        "password = NOT_A_REAL_SECRET_EXAMPLE",
        "to_en",
        new AbortController().signal
      )
    ).rejects.toBeInstanceOf(RelayProtectionError);
    expect(seen).toHaveLength(0);
    store.update("owner", { ...store.get("owner"), expected_version: 0, max_total_tokens: 1 });
    await expect(
      relay.translate(
        "owner",
        chatId,
        runId,
        request,
        "Привет",
        "to_en",
        new AbortController().signal
      )
    ).rejects.toBeInstanceOf(QuotaExceededError);
    expect(dispatched).toBe(0);
  });
});
