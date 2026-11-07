import { loadServerConfig } from "@cosmora/config";
import type { ModelRegistryDocument, ModelRegistryEntry } from "@cosmora/contracts";
import { describe, expect, it, vi } from "vitest";
import { buildModelRuntime, loadModelRegistryDocument } from "../src/model-runtime.js";

const externalEntry = (overrides: Partial<ModelRegistryEntry> = {}): ModelRegistryEntry => ({
  provider_id: "vibecode",
  model_id: "manager-model",
  aliases: ["manager"],
  protocol: "openai-compatible",
  status: "active",
  roles: ["manager"],
  task_types: ["project_chat"],
  capabilities: {
    streaming: true,
    structured_output: false,
    tool_calling: false,
    vision: false
  },
  context_window_tokens: 32_000,
  max_output_tokens: 4_000,
  quality_tier: 4,
  latency_tier: 2,
  pricing: null,
  privacy: {
    confidential_compatible: false,
    training_usage: "unknown",
    retention: "unknown"
  },
  source: {
    kind: "authorized_discovery",
    verified_at: "2026-08-25T00:00:00.000Z",
    valid_until: "2099-08-25T00:00:00.000Z",
    reference: "authorized-test-fixture"
  },
  ...overrides
});

const registry = (entries: ModelRegistryEntry[]): ModelRegistryDocument => ({
  schema_version: 1,
  registry_version: "runtime-test-1",
  generated_at: "2026-08-25T00:00:00.000Z",
  entries
});

const secretResolver = {
  resolve: async (name: "MODEL_API_KEY"): Promise<string | null> => {
    await Promise.resolve();
    return name === "MODEL_API_KEY" ? "test-runtime-secret" : null;
  }
};

const externalConfig = () =>
  loadServerConfig({
    NODE_ENV: "test",
    MODEL_PROVIDER: "openai-compatible",
    MODEL_PROVIDER_ID: "vibecode",
    MODEL_BASE_URL: "https://provider.example/v1",
    MODEL_API_KEY: "test-secret",
    MODEL_NAME: "manager-model"
  });

describe("buildModelRuntime", () => {
  it.each([
    ["cheapvibecode", "https://ru.cheapvibecode.ru/v1", "hy4", true],
    ["other", "https://ru.cheapvibecode.ru/v1", "hy4", false],
    ["cheapvibecode", "https://other.example/v1", "hy4", false],
    ["cheapvibecode", "https://ru.cheapvibecode.ru/v1", "another-model", false]
  ] as const)(
    "scopes the reviewed Hy4 response alias to %s / %s / %s",
    async (provider, url, model, allowed) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(() =>
          Promise.resolve(
            new Response(
              `data: ${JSON.stringify({ model: "hy4-free", choices: [{ index: 0, delta: { content: "OK" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } })}\n\ndata: [DONE]\n\n`,
              { headers: { "content-type": "text/event-stream" } }
            )
          )
        )
      );
      try {
        const config = loadServerConfig({
          NODE_ENV: "test",
          MODEL_PROVIDER: "openai-compatible",
          MODEL_PROVIDER_ID: provider,
          MODEL_BASE_URL: url,
          MODEL_API_KEY: "fixture-only",
          MODEL_NAME: model,
          MODEL_MAX_ATTEMPTS_PER_ROUTE: "1"
        });
        const runtime = await buildModelRuntime(config, {
          secretResolver,
          registryDocument: registry([
            externalEntry({ provider_id: provider, model_id: model, aliases: ["manager", model] })
          ])
        });
        const run = async () => {
          const events = [];
          for await (const event of runtime.gateway.stream(
            runtime.manager.buildRequest({ projectId: "fixture", runId: "fixture", messages: [] })
          ))
            events.push(event);
          return events;
        };
        if (allowed)
          expect((await run()).at(-1)).toMatchObject({
            type: "response.completed",
            model: "hy4-free",
            route: { model_id: "hy4" }
          });
        else
          await expect(run()).rejects.toMatchObject({ code: "PROVIDER_ERROR", retryable: false });
      } finally {
        vi.unstubAllGlobals();
      }
    }
  );
  it("propagates the selected route context window into Chat and Manager, including model aliases", async () => {
    const config = loadServerConfig({ NODE_ENV: "test", MODEL_NAME: "manager" });
    const document = loadModelRegistryDocument("config/model-registry.v1.json");
    document.entries[0]!.context_window_tokens = 1050000;
    const runtime = await buildModelRuntime(config, { registryDocument: document });
    const at = "2026-10-31T00:00:00.000Z";
    const common = {
      id: "message",
      chat_id: "chat",
      role: "user" as const,
      content_type: "text" as const,
      content: "a".repeat(90000),
      status: "completed" as const,
      run_id: "run",
      error_code: null,
      created_at: at,
      updated_at: at
    };
    const chat = runtime.chat.buildRequest({ chatId: "chat", runId: "run", messages: [common] });
    const manager = runtime.manager.buildRequest({
      projectId: "project",
      runId: "run",
      messages: [{ ...common, project_id: "project", reply_to_message_id: null }]
    });
    expect(chat.messages.at(-1)!.content).toBe(common.content);
    expect(manager.messages.at(-1)!.content).toBe(common.content);
  });
  it("constructs the refreshed Sol candidate with its discovered window without dispatching", async () => {
    const config = loadServerConfig({
      NODE_ENV: "test",
      MODEL_PROVIDER: "openai-compatible",
      MODEL_PROVIDER_ID: "cheapvibecode",
      MODEL_BASE_URL: "https://ru.cheapvibecode.ru/v1",
      MODEL_API_KEY: "fixture",
      MODEL_NAME: "gpt-6.1-sol",
      MODEL_REGISTRY_PATH: "config/model-registry.cheapvibecode.sol.v1.json"
    });
    const document = loadModelRegistryDocument(config.modelRegistryPath!);
    document.entries.find((e) => e.provider_id === "cheapvibecode")!.source.valid_until =
      "2099-11-01T00:00:00.000Z";
    const runtime = await buildModelRuntime(config, { registryDocument: document, secretResolver });
    expect(runtime.gateway.hasProvider("cheapvibecode")).toBe(true);
    expect(
      document.entries.find((e) => e.provider_id === "cheapvibecode")!.context_window_tokens
    ).toBe(1050000);
  });
  it("constructs the owner-selected Fable route without dispatch or mock fallback", async () => {
    const config = loadServerConfig({
      NODE_ENV: "test",
      MODEL_PROVIDER: "openai-compatible",
      MODEL_PROVIDER_ID: "tokenshop",
      MODEL_BASE_URL: "https://token-shop.online/v1",
      MODEL_API_KEY: "fixture-only",
      MODEL_NAME: "claude-fable-5",
      MODEL_FALLBACK_TO_MOCK: "false",
      MANAGER_MAX_OUTPUT_TOKENS: "100000",
      MODEL_REGISTRY_PATH: "config/model-registry.tokenshop.fable.v1.json"
    });
    const runtime = await buildModelRuntime(config, {
      secretResolver: { resolve: () => Promise.resolve("fixture-only") }
    });
    expect(runtime.contextWindowTokens).toBe(1_000_000);
    expect(runtime.registryVersion).toBe("tokenshop-fable-live-2026-11-02");
    expect(config.modelFallbackToMock).toBe(false);
  });
  it("loads a repository-relative registry path independently of process cwd", () => {
    const document = loadModelRegistryDocument("config/model-registry.v1.json");

    expect(document.registry_version).toBe("b0.2-bootstrap-1");
  });

  it("builds the checked-in owner-preview route without making a provider request", async () => {
    const config = loadServerConfig({
      NODE_ENV: "test",
      MODEL_PROVIDER: "openai-compatible",
      MODEL_PROVIDER_ID: "vibecode",
      MODEL_REGISTRY_PATH: "config/model-registry.vibecode.v1.json",
      MODEL_BASE_URL: "https://vibecode.moe/v1",
      MODEL_API_KEY: "test-secret",
      MODEL_NAME: "gpt-5.5"
    });

    // This is a historical adapter-construction fixture, not a current live-readiness claim.
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-14T00:00:00.000Z"));
    try {
      const runtime = await buildModelRuntime(config, { secretResolver });
      expect(runtime.registryVersion).toBe("vibecode-owner-preview-2026-09-13");
      expect(runtime.gateway.hasProvider("vibecode")).toBe(true);
    } finally {
      clock.mockRestore();
    }
  });

  it("fails closed after the checked-in preview evidence expires", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-16T00:00:00.000Z"));
    try {
      const config = loadServerConfig({
        NODE_ENV: "test",
        MODEL_PROVIDER: "openai-compatible",
        MODEL_PROVIDER_ID: "vibecode",
        MODEL_REGISTRY_PATH: "config/model-registry.vibecode.v1.json",
        MODEL_BASE_URL: "https://vibecode.moe/v1",
        MODEL_API_KEY: "test-secret",
        MODEL_NAME: "gpt-5.5"
      });
      await expect(buildModelRuntime(config, { secretResolver })).rejects.toThrow(
        "evidence has expired"
      );
    } finally {
      clock.mockRestore();
    }
  });

  it("binds an external adapter only to an active registry route", async () => {
    const runtime = await buildModelRuntime(externalConfig(), {
      registryDocument: registry([externalEntry()]),
      secretResolver
    });

    expect(runtime.registryVersion).toBe("runtime-test-1");
    expect(runtime.gateway.hasProvider("vibecode")).toBe(true);
    expect(
      runtime.manager.buildRequest({
        projectId: "project-1",
        runId: "run-1",
        messages: []
      }).routing
    ).toMatchObject({
      preferred_provider: "vibecode",
      preferred_model_alias: "manager-model",
      required_features: ["streaming"]
    });
  });

  it("fails closed when configured provider metadata is absent or mismatched", async () => {
    await expect(
      buildModelRuntime(externalConfig(), {
        registryDocument: registry([]),
        secretResolver
      })
    ).rejects.toThrow("is not active in Model Registry");

    await expect(
      buildModelRuntime(externalConfig(), {
        registryDocument: registry([externalEntry({ protocol: "anthropic-compatible" })]),
        secretResolver
      })
    ).rejects.toThrow("is not active in Model Registry");
  });

  it("fails closed when the secret resolver cannot provide the credential", async () => {
    await expect(
      buildModelRuntime(externalConfig(), {
        registryDocument: registry([externalEntry()]),
        secretResolver: { resolve: () => Promise.resolve(null) }
      })
    ).rejects.toThrow("External model provider configuration is incomplete");
  });
});
