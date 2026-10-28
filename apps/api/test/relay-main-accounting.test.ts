import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelRequest } from "@cosmora/contracts";
import { loadServerConfig } from "@cosmora/config";
import { ProjectStore, openDatabase, runMigrations } from "@cosmora/db";
import type { ModelGateway, ModelGatewayStreamEvent } from "@cosmora/model-gateway";
import { buildApp } from "../src/app.js";
import { AccountStore } from "../src/account-settings/account-store.js";
import { GeneralChatRuntimeStore } from "../src/general-chat-runtime-store.js";
import { GeneralChatBackgroundRunCoordinator } from "../src/general-chat-background-run-coordinator.js";
import { buildModelRuntime } from "../src/model-runtime.js";
import { RuntimeMetrics } from "../src/operations.js";

const resources: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of resources.splice(0).reverse()) await close();
});

describe("canonical main usage survives optional Relay failure", () => {
  for (const mode of ["stream", "background"] as const)
    it.each(["success", "failed", "truncated", "corrupt", "unknown-cost"] as const)(
      `${mode}: %s back-translation`,
      async (outcome) => {
        const database = openDatabase(":memory:");
        resources.push(() => {
          database.close();
          return Promise.resolve();
        });
        await runMigrations(database);
        const store = new GeneralChatRuntimeStore(database.sqlite);
        const account = new AccountStore(database.sqlite);
        account.update("local-owner", {
          ...account.get("local-owner"),
          expected_version: 0,
          preferred_provider: "fixture",
          preferred_model: "fixture-model",
          relay_enabled: true
        });
        const config = loadServerConfig({ NODE_ENV: "test" });
        const runtime = await buildModelRuntime(config);
        const calls: string[] = [];
        let runId = "";
        const gateway = {
          async *stream(request: ModelRequest): AsyncGenerator<ModelGatewayStreamEvent> {
            await Promise.resolve();
            const stage = request.idempotency_key.includes(":to_en:")
              ? "to_en"
              : request.idempotency_key.includes(":from_en:")
                ? "from_en"
                : "main";
            calls.push(stage);
            const route = {
              attempt: 1,
              registry_version: "fixture",
              provider_id: "fixture",
              model_id: "fixture-model",
              estimated_input_tokens: request.routing.estimated_input_tokens,
              max_output_tokens: request.constraints.max_output_tokens,
              estimated_cost:
                outcome === "unknown-cost" ? null : { amount: 0.1, currency: "USD" as const }
            };
            if (stage === "from_en") {
              expect(store.getModelUsageForRun(runId)[0]).toMatchObject({
                status: "committed",
                actual_input_tokens: 25,
                actual_output_tokens: 15
              });
              const main = store.getModelUsageForRun(runId)[0]!;
              expect(account.summary("local-owner").model_tokens_or_upper_bound).toBe(
                outcome === "unknown-cost"
                  ? main.estimated_input_tokens + main.max_output_tokens
                  : 40
              );
            }
            yield { type: "route.selected", route };
            if (stage === "from_en" && outcome === "failed") {
              yield { type: "route.failed", route, errorCode: "PROVIDER_ERROR", retryable: true };
              calls.push("UNEXPECTED_AUTOMATIC_RETRY");
              return;
            }
            const content =
              stage === "to_en"
                ? "Explain the result"
                : stage === "main"
                  ? "Result `const value = 1;`"
                  : outcome === "corrupt"
                    ? "Результат с потерянным кодом"
                    : request.messages.at(-1)!.content.replace("Result", "Результат");
            yield { type: "text.delta", delta: content };
            yield {
              type: "response.completed",
              route,
              provider: "fixture",
              model: "fixture-model",
              finishReason: stage === "from_en" && outcome === "truncated" ? "length" : "stop",
              usage:
                stage === "main"
                  ? { inputTokens: 25, outputTokens: 15 }
                  : { inputTokens: 7, outputTokens: 3 },
              calculatedCost: outcome === "unknown-cost" ? null : { amount: 0.001, currency: "USD" }
            };
          }
        } as unknown as ModelGateway;
        const metrics = new RuntimeMetrics();
        const app = buildApp({
          config,
          database,
          generalChatStore: store,
          projectStore: new ProjectStore(database.sqlite),
          modelGateway: gateway,
          manager: runtime.manager,
          chat: runtime.chat,
          accountStore: account,
          runtimeMetrics: metrics,
          generalChatRunExecutionMode: mode
        });
        resources.push(() => app.close());
        const accepted = await app.inject({
          method: "POST",
          url: "/api/v1/chats",
          payload: {
            initial_message: "Объясни результат",
            client_message_id: `relay-${mode}-${outcome}`
          }
        });
        expect(accepted.statusCode).toBe(201);
        const body = accepted.json<{ run_id: string; stream_url: string }>();
        runId = body.run_id;
        if (mode === "background") {
          const coordinator = new GeneralChatBackgroundRunCoordinator({
            store,
            accountStore: account,
            modelGateway: gateway,
            chat: runtime.chat,
            runtimeMetrics: metrics,
            pollIntervalMs: 5
          });
          resources.push(() => coordinator.stop());
          coordinator.start();
          await vi.waitFor(() =>
            expect(store.getRun(runId)?.status).toBe(
              outcome === "success" || outcome === "unknown-cost" ? "succeeded" : "failed"
            )
          );
        }
        const events = await app.inject({ method: "GET", url: body.stream_url });
        expect(events.statusCode).toBe(200);
        expect(events.body).toContain(
          outcome === "success" || outcome === "unknown-cost"
            ? "event: run.completed"
            : "event: run.failed"
        );
        expect(calls).toEqual(["to_en", "main", "from_en"]);
        const ledger = store.getModelUsageForRun(runId);
        expect(ledger).toHaveLength(1);
        expect(ledger[0]).toMatchObject({
          status: "committed",
          actual_input_tokens: 25,
          actual_output_tokens: 15
        });
        expect(account.summary("local-owner").model_tokens_or_upper_bound).toBe(
          outcome === "unknown-cost"
            ? ledger[0]!.estimated_input_tokens + ledger[0]!.max_output_tokens
            : 40
        );
        expect(database.sqlite.prepare("SELECT status FROM kosmora_usage_holds").all()).toEqual(
          outcome === "unknown-cost" ? [expect.objectContaining({ status: "uncertain" })] : []
        );
        const before = JSON.stringify(account.summary("local-owner"));
        await app.inject({ method: "GET", url: body.stream_url });
        expect(calls).toHaveLength(3);
        expect(JSON.stringify(account.summary("local-owner"))).toBe(before);
        if (outcome !== "failed") {
          expect(account.summary("local-owner").translation_tokens_or_upper_bound).toBe(20);
          expect(account.summary("local-owner").in_flight_or_uncertain_holds).toBe(0);
        }
      }
    );
});
