import type {
  ModelRegistryDocument,
  ModelRegistryEntry,
  ModelRouteRequest
} from "@cosmora/contracts";
import { describe, expect, it } from "vitest";
import { ModelRegistry, ModelRouteError, ModelRouter } from "../src/index.js";

const entry = (overrides: Partial<ModelRegistryEntry> = {}): ModelRegistryEntry => ({
  provider_id: "provider-a",
  model_id: "model-a",
  aliases: ["manager"],
  protocol: "openai-compatible",
  status: "active",
  roles: ["manager"],
  task_types: ["project_chat"],
  capabilities: {
    streaming: true,
    structured_output: true,
    tool_calling: false,
    vision: false
  },
  context_window_tokens: 32_000,
  max_output_tokens: 4_000,
  quality_tier: 4,
  latency_tier: 3,
  pricing: {
    currency: "USD",
    input_per_million_tokens: 1,
    output_per_million_tokens: 4
  },
  privacy: {
    confidential_compatible: false,
    training_usage: "unknown",
    retention: "unknown"
  },
  source: {
    kind: "authorized_discovery",
    verified_at: "2026-08-24T00:00:00.000Z",
    reference: "discovery-fixture"
  },
  ...overrides
});

const document = (entries: ModelRegistryEntry[]): ModelRegistryDocument => ({
  schema_version: 1,
  registry_version: "test-1",
  generated_at: "2026-08-24T00:00:00.000Z",
  entries
});

const request = (overrides: Partial<ModelRouteRequest> = {}): ModelRouteRequest => ({
  role: "manager",
  task_type: "project_chat",
  preferred_provider: null,
  preferred_model_alias: "manager",
  required_features: ["streaming"],
  confidential: false,
  estimated_input_tokens: 2_000,
  max_output_tokens: 1_000,
  max_cost: { amount: 0.01, currency: "USD" },
  optimize_for: "balanced",
  ...overrides
});

const expectRouteError = (action: () => unknown, code: ModelRouteError["code"]): void => {
  try {
    action();
    throw new Error("Expected model routing to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(ModelRouteError);
    expect((error as ModelRouteError).code).toBe(code);
  }
};

describe("ModelRegistry", () => {
  it("rejects duplicate provider/model identities", () => {
    expect(() => new ModelRegistry(document([entry(), entry()]))).toThrow(
      "Duplicate model registry entry"
    );
  });

  it("rejects an output limit larger than the context window", () => {
    expect(
      () =>
        new ModelRegistry(document([entry({ context_window_tokens: 100, max_output_tokens: 101 })]))
    ).toThrow("output limit exceeds");
  });

  it("rejects an active route without verification evidence", () => {
    expect(
      () =>
        new ModelRegistry(
          document([
            entry({
              source: {
                kind: "authorized_discovery",
                verified_at: null,
                reference: null
              }
            })
          ])
        )
    ).toThrow("missing verification evidence");
  });

  it("allows an unverified route to remain disabled and unroutable", () => {
    const registry = new ModelRegistry(
      document([
        entry({
          status: "disabled",
          capabilities: {
            streaming: false,
            structured_output: false,
            tool_calling: false,
            vision: false
          },
          source: {
            kind: "static",
            verified_at: null,
            reference: null
          }
        })
      ])
    );

    expect(registry.list()).toHaveLength(1);
    expectRouteError(() => new ModelRouter(registry).resolve(request()), "NO_ENABLED_MODEL");
  });

  it("rejects an active route that cannot satisfy the streaming gateway contract", () => {
    expect(
      () =>
        new ModelRegistry(
          document([
            entry({
              capabilities: {
                streaming: false,
                structured_output: true,
                tool_calling: false,
                vision: false
              }
            })
          ])
        )
    ).toThrow("does not support gateway streaming");
  });

  it("rejects an active external route that bypassed authorized discovery", () => {
    expect(
      () =>
        new ModelRegistry(
          document([
            entry({
              source: {
                kind: "static",
                verified_at: "2026-08-24T00:00:00.000Z",
                reference: "unreviewed-fixture"
              }
            })
          ])
        )
    ).toThrow("was not authorized through discovery");
  });

  it("rejects a contradictory confidential compatibility declaration", () => {
    expect(
      () =>
        new ModelRegistry(
          document([
            entry({
              privacy: {
                confidential_compatible: true,
                training_usage: "unknown",
                retention: "unknown"
              }
            })
          ])
        )
    ).toThrow("Confidential compatibility is not fully declared");
  });
});

describe("ModelRouter", () => {
  it("selects deterministically by quality, latency and cost", () => {
    const quality = entry({ provider_id: "quality", quality_tier: 5, latency_tier: 4 });
    const fast = entry({
      provider_id: "fast",
      model_id: "model-fast",
      quality_tier: 3,
      latency_tier: 1,
      pricing: {
        currency: "USD",
        input_per_million_tokens: 0.5,
        output_per_million_tokens: 1
      }
    });
    const router = new ModelRouter(new ModelRegistry(document([quality, fast])));

    expect(router.resolve(request({ optimize_for: "quality" })).provider_id).toBe("quality");
    expect(router.resolve(request({ optimize_for: "latency" })).provider_id).toBe("fast");
    expect(router.resolve(request({ optimize_for: "cost" })).provider_id).toBe("fast");
  });

  it("fails closed when confidential policy is not verified", () => {
    const router = new ModelRouter(new ModelRegistry(document([entry()])));
    expectRouteError(
      () => router.resolve(request({ confidential: true })),
      "CONFIDENTIAL_ROUTE_UNAVAILABLE"
    );
  });

  it("allows only a fully declared confidential route", () => {
    const secure = entry({
      provider_id: "secure",
      privacy: {
        confidential_compatible: true,
        training_usage: "none",
        retention: "limited"
      }
    });
    const router = new ModelRouter(new ModelRegistry(document([secure])));
    expect(router.resolve(request({ confidential: true })).provider_id).toBe("secure");
  });

  it("rejects missing capabilities, context and budget with distinct codes", () => {
    const router = new ModelRouter(new ModelRegistry(document([entry()])));
    const cases: Array<[Partial<ModelRouteRequest>, ModelRouteError["code"]]> = [
      [{ required_features: ["tool_calling"] }, "CAPABILITY_UNAVAILABLE"],
      [{ estimated_input_tokens: 31_500, max_output_tokens: 1_000 }, "CONTEXT_WINDOW_EXCEEDED"],
      [{ max_cost: { amount: 0.000_001, currency: "USD" } }, "BUDGET_EXCEEDED"]
    ];

    for (const [overrides, code] of cases) {
      expectRouteError(() => router.resolve(request(overrides)), code);
    }
  });

  it("does not route a cost-limited request through unknown pricing", () => {
    const router = new ModelRouter(
      new ModelRegistry(document([entry({ pricing: null, provider_id: "unknown-price" })]))
    );
    expectRouteError(() => router.resolve(request()), "BUDGET_EXCEEDED");
  });

  it("honors explicit provider and model alias constraints", () => {
    const router = new ModelRouter(new ModelRegistry(document([entry()])));
    expectRouteError(
      () => router.resolve(request({ preferred_provider: "missing-provider" })),
      "PREFERRED_ROUTE_UNAVAILABLE"
    );
    expectRouteError(
      () => router.resolve(request({ preferred_model_alias: "unknown" })),
      "PREFERRED_ROUTE_UNAVAILABLE"
    );
  });
});
