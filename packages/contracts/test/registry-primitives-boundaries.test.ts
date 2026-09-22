import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
  CurrencySchema,
  EntityIdSchema,
  IsoDateTimeSchema,
  ModelFeatureSchema,
  ModelProtocolSchema,
  ModelRegistryDocumentSchema,
  ModelRegistryEntrySchema,
  ModelRouteRequestSchema
} from "../src/index.js";

const baseEntry = {
  provider_id: "provider-1",
  model_id: "model-1",
  aliases: ["manager"],
  protocol: "mock",
  status: "active",
  roles: ["manager"],
  task_types: ["chat_response"],
  capabilities: {
    streaming: true,
    structured_output: false,
    tool_calling: false,
    vision: false
  },
  context_window_tokens: 128_000,
  max_output_tokens: 8_000,
  quality_tier: 3,
  latency_tier: 3,
  pricing: {
    currency: "USD",
    input_per_million_tokens: 1,
    output_per_million_tokens: 2
  },
  privacy: {
    confidential_compatible: true,
    training_usage: "none",
    retention: "zero"
  },
  source: {
    kind: "static",
    verified_at: "2026-09-22T20:00:00.000Z",
    valid_until: "2026-10-22T20:00:00.000Z",
    reference: "provider evidence"
  }
} as const;

const baseRoute = {
  role: "manager",
  task_type: "chat_response",
  preferred_provider: null,
  preferred_model_alias: null,
  required_features: ["streaming"],
  confidential: false,
  estimated_input_tokens: 0,
  max_output_tokens: 1,
  max_cost: null,
  optimize_for: "balanced"
} as const;

const isEntry = (candidate: unknown) => Value.Check(ModelRegistryEntrySchema, candidate);
const isRoute = (candidate: unknown) => Value.Check(ModelRouteRequestSchema, candidate);

describe("primitive contract boundaries", () => {
  it("enforces entity id length and whitespace rules", () => {
    expect(Value.Check(EntityIdSchema, "a")).toBe(true);
    expect(Value.Check(EntityIdSchema, "a".repeat(128))).toBe(true);
    expect(Value.Check(EntityIdSchema, "")).toBe(false);
    expect(Value.Check(EntityIdSchema, "a".repeat(129))).toBe(false);

    for (const value of [" ", "a b", "a\tb", "a\nb", "\ra"]) {
      expect(Value.Check(EntityIdSchema, value)).toBe(false);
    }
  });

  it("accepts canonical ISO datetime text shapes", () => {
    const values = ["2026-09-22T20:00:00Z", "2026-09-22T20:00:00.000Z"];

    for (const value of values) {
      expect(Value.Check(IsoDateTimeSchema, value)).toBe(true);
    }
  });

  it("rejects non-canonical ISO datetime text shapes", () => {
    const values = [
      "",
      "2026-09-22",
      "2026-09-22T20:00:00",
      "2026-09-22 20:00:00Z",
      "2026-09-22T20:00:00+03:00",
      "2026-09-22T20:00:00.0Z",
      "2026-09-22T20:00:00.00Z",
      "2026-09-22T20:00:00.0000Z"
    ];

    for (const value of values) {
      expect(Value.Check(IsoDateTimeSchema, value)).toBe(false);
    }
  });

  it("accepts only supported currencies", () => {
    for (const currency of ["USD", "RUB"]) {
      expect(Value.Check(CurrencySchema, currency)).toBe(true);
    }

    for (const currency of ["", "EUR", "usd", " RUB ", null, 1]) {
      expect(Value.Check(CurrencySchema, currency)).toBe(false);
    }
  });
});

describe("model registry entry boundaries", () => {
  it("accepts every supported protocol", () => {
    const protocols = ["mock", "openai-compatible", "anthropic-compatible"] as const;

    for (const protocol of protocols) {
      expect(Value.Check(ModelProtocolSchema, protocol)).toBe(true);
      expect(isEntry({ ...baseEntry, protocol })).toBe(true);
    }
  });

  it("rejects invalid protocols", () => {
    const protocols = ["", "openai", "anthropic", "Mock", " mock ", null, 1];

    for (const protocol of protocols) {
      expect(Value.Check(ModelProtocolSchema, protocol)).toBe(false);
      expect(isEntry({ ...baseEntry, protocol })).toBe(false);
    }
  });

  it("accepts every supported model feature", () => {
    const features = ["streaming", "structured_output", "tool_calling", "vision"] as const;

    for (const feature of features) {
      expect(Value.Check(ModelFeatureSchema, feature)).toBe(true);
    }
  });

  it("rejects invalid model features", () => {
    const features = ["", "audio", "tools", "Streaming", " streaming ", null, 1];

    for (const feature of features) {
      expect(Value.Check(ModelFeatureSchema, feature)).toBe(false);
    }
  });

  it("enforces provider and model id lengths", () => {
    const cases = [
      ["provider_id", 1, true],
      ["provider_id", 128, true],
      ["provider_id", 129, false],
      ["model_id", 1, true],
      ["model_id", 256, true],
      ["model_id", 257, false]
    ] as const;

    for (const [field, length, expected] of cases) {
      const candidate = { ...baseEntry, [field]: "a".repeat(length) };
      expect(isEntry(candidate)).toBe(expected);
    }
  });

  it("requires at least one bounded alias", () => {
    expect(isEntry({ ...baseEntry, aliases: [] })).toBe(false);
    expect(isEntry({ ...baseEntry, aliases: ["a"] })).toBe(true);
    expect(isEntry({ ...baseEntry, aliases: ["a".repeat(128)] })).toBe(true);
    expect(isEntry({ ...baseEntry, aliases: ["a".repeat(129)] })).toBe(false);
    expect(isEntry({ ...baseEntry, aliases: [""] })).toBe(false);
  });

  it("accepts only active or disabled status", () => {
    for (const status of ["active", "disabled"] as const) {
      expect(isEntry({ ...baseEntry, status })).toBe(true);
    }

    for (const status of ["", "inactive", "Active", null, 1]) {
      expect(isEntry({ ...baseEntry, status })).toBe(false);
    }
  });

  it("enforces registry numeric boundaries", () => {
    const cases = [
      ["context_window_tokens", 1, true],
      ["context_window_tokens", 0, false],
      ["context_window_tokens", -1, false],
      ["context_window_tokens", 1.5, false],
      ["max_output_tokens", 1, true],
      ["max_output_tokens", 0, false],
      ["max_output_tokens", -1, false],
      ["max_output_tokens", 1.5, false],
      ["quality_tier", 1, true],
      ["quality_tier", 5, true],
      ["quality_tier", 0, false],
      ["quality_tier", 6, false],
      ["quality_tier", 1.5, false],
      ["latency_tier", 1, true],
      ["latency_tier", 5, true],
      ["latency_tier", 0, false],
      ["latency_tier", 6, false],
      ["latency_tier", 1.5, false]
    ] as const;

    for (const [field, value, expected] of cases) {
      expect(isEntry({ ...baseEntry, [field]: value })).toBe(expected);
    }
  });

  it("requires strict boolean capability values", () => {
    const fields = ["streaming", "structured_output", "tool_calling", "vision"] as const;

    for (const field of fields) {
      let capabilities = { ...baseEntry.capabilities, [field]: true };
      expect(isEntry({ ...baseEntry, capabilities })).toBe(true);

      capabilities = { ...baseEntry.capabilities, [field]: false };
      expect(isEntry({ ...baseEntry, capabilities })).toBe(true);

      for (const value of [0, 1, "true", null]) {
        const invalidCapabilities = {
          ...baseEntry.capabilities,
          [field]: value
        };
        expect(isEntry({ ...baseEntry, capabilities: invalidCapabilities })).toBe(false);
      }
    }
  });

  it("rejects extra capability properties", () => {
    const capabilities = {
      ...baseEntry.capabilities,
      audio: true
    };
    expect(isEntry({ ...baseEntry, capabilities })).toBe(false);
  });

  it("accepts null or non-negative pricing", () => {
    expect(isEntry({ ...baseEntry, pricing: null })).toBe(true);

    const pricing = {
      currency: "RUB",
      input_per_million_tokens: 0,
      output_per_million_tokens: 0
    };
    expect(isEntry({ ...baseEntry, pricing })).toBe(true);
  });

  it("rejects malformed pricing", () => {
    const cases = [
      { ...baseEntry.pricing, input_per_million_tokens: -0.01 },
      { ...baseEntry.pricing, output_per_million_tokens: -0.01 },
      { ...baseEntry.pricing, currency: "EUR" },
      { ...baseEntry.pricing, unexpected: true }
    ];

    for (const pricing of cases) {
      expect(isEntry({ ...baseEntry, pricing })).toBe(false);
    }
  });

  it("accepts every privacy vocabulary value", () => {
    for (const trainingUsage of ["none", "opt_out", "unknown"] as const) {
      const privacy = {
        ...baseEntry.privacy,
        training_usage: trainingUsage
      };
      expect(isEntry({ ...baseEntry, privacy })).toBe(true);
    }

    for (const retention of ["zero", "limited", "unknown"] as const) {
      const privacy = {
        ...baseEntry.privacy,
        retention
      };
      expect(isEntry({ ...baseEntry, privacy })).toBe(true);
    }
  });

  it("rejects invalid privacy vocabulary and extra properties", () => {
    let privacy = {
      ...baseEntry.privacy,
      training_usage: "yes"
    };
    expect(isEntry({ ...baseEntry, privacy })).toBe(false);

    privacy = {
      ...baseEntry.privacy,
      retention: "forever"
    };
    expect(isEntry({ ...baseEntry, privacy })).toBe(false);

    const extraPrivacy = {
      ...baseEntry.privacy,
      unexpected: true
    };
    expect(isEntry({ ...baseEntry, privacy: extraPrivacy })).toBe(false);
  });

  it("accepts every source kind", () => {
    for (const kind of ["static", "authorized_discovery"] as const) {
      const source = { ...baseEntry.source, kind };
      expect(isEntry({ ...baseEntry, source })).toBe(true);
    }
  });

  it("accepts nullable source evidence metadata", () => {
    const source = {
      kind: "static",
      verified_at: null,
      valid_until: null,
      reference: null
    };
    expect(isEntry({ ...baseEntry, source })).toBe(true);
  });

  it("rejects malformed source evidence metadata", () => {
    const cases = [
      { ...baseEntry.source, kind: "manual" },
      { ...baseEntry.source, verified_at: "2026-09-22" },
      { ...baseEntry.source, valid_until: "2026-10-22" },
      { ...baseEntry.source, reference: "" },
      { ...baseEntry.source, unexpected: true }
    ];

    for (const source of cases) {
      expect(isEntry({ ...baseEntry, source })).toBe(false);
    }
  });

  it("rejects unexpected top-level entry properties", () => {
    expect(isEntry({ ...baseEntry, api_key: "secret" })).toBe(false);
  });
});

describe("model registry document boundaries", () => {
  const baseDocument = {
    schema_version: 1,
    registry_version: "registry-1",
    generated_at: "2026-09-22T20:00:00.000Z",
    entries: [baseEntry]
  } as const;

  const isDocument = (candidate: unknown) => Value.Check(ModelRegistryDocumentSchema, candidate);

  it("accepts the canonical document", () => {
    expect(isDocument(baseDocument)).toBe(true);
  });

  it("accepts only schema version one", () => {
    for (const schemaVersion of [0, 2, "1", null]) {
      const candidate = {
        ...baseDocument,
        schema_version: schemaVersion
      };
      expect(isDocument(candidate)).toBe(false);
    }
  });

  it("enforces registry version length", () => {
    const cases = [
      ["", false],
      ["a", true],
      ["a".repeat(64), true],
      ["a".repeat(65), false]
    ] as const;

    for (const [registryVersion, expected] of cases) {
      const candidate = {
        ...baseDocument,
        registry_version: registryVersion
      };
      expect(isDocument(candidate)).toBe(expected);
    }
  });

  it("accepts an empty registry", () => {
    expect(isDocument({ ...baseDocument, entries: [] })).toBe(true);
  });

  it("rejects malformed generated time and extra properties", () => {
    expect(isDocument({ ...baseDocument, generated_at: "2026-09-22" })).toBe(false);
    expect(isDocument({ ...baseDocument, secret: "unexpected" })).toBe(false);
  });
});

describe("model route request boundaries", () => {
  it("accepts every optimization mode", () => {
    for (const optimizeFor of ["balanced", "quality", "latency", "cost"] as const) {
      expect(isRoute({ ...baseRoute, optimize_for: optimizeFor })).toBe(true);
    }
  });

  it("accepts nullable and non-null preferred routing targets", () => {
    expect(isRoute(baseRoute)).toBe(true);

    const candidate = {
      ...baseRoute,
      preferred_provider: "provider-1",
      preferred_model_alias: "manager"
    };
    expect(isRoute(candidate)).toBe(true);
  });

  it("rejects empty non-null preferred routing targets", () => {
    expect(isRoute({ ...baseRoute, preferred_provider: "" })).toBe(false);
    expect(isRoute({ ...baseRoute, preferred_model_alias: "" })).toBe(false);
  });

  it("enforces unique known required features", () => {
    const valid = {
      ...baseRoute,
      required_features: ["streaming", "vision"]
    };
    expect(isRoute(valid)).toBe(true);

    const duplicate = {
      ...baseRoute,
      required_features: ["streaming", "streaming"]
    };
    expect(isRoute(duplicate)).toBe(false);

    const unknown = {
      ...baseRoute,
      required_features: ["audio"]
    };
    expect(isRoute(unknown)).toBe(false);
  });

  it("enforces route numeric boundaries", () => {
    const zeroTokens = {
      ...baseRoute,
      estimated_input_tokens: 0,
      max_output_tokens: 1
    };
    expect(isRoute(zeroTokens)).toBe(true);

    expect(isRoute({ ...baseRoute, estimated_input_tokens: -1 })).toBe(false);
    expect(isRoute({ ...baseRoute, estimated_input_tokens: 1.5 })).toBe(false);
    expect(isRoute({ ...baseRoute, max_output_tokens: 0 })).toBe(false);
    expect(isRoute({ ...baseRoute, max_output_tokens: 1.5 })).toBe(false);
  });

  it("enforces route max-cost shape", () => {
    const zeroCost = {
      ...baseRoute,
      max_cost: { amount: 0, currency: "USD" }
    };
    expect(isRoute(zeroCost)).toBe(true);

    const negativeCost = {
      ...baseRoute,
      max_cost: { amount: -0.01, currency: "USD" }
    };
    expect(isRoute(negativeCost)).toBe(false);

    const invalidCurrency = {
      ...baseRoute,
      max_cost: { amount: 1, currency: "EUR" }
    };
    expect(isRoute(invalidCurrency)).toBe(false);

    const extraProperty = {
      ...baseRoute,
      max_cost: {
        amount: 1,
        currency: "USD",
        unexpected: true
      }
    };
    expect(isRoute(extraProperty)).toBe(false);
  });

  it("rejects missing or additional route properties", () => {
    expect(isRoute({ ...baseRoute, unexpected: true })).toBe(false);

    const candidate: Record<string, unknown> = { ...baseRoute };
    delete candidate.role;
    expect(isRoute(candidate)).toBe(false);
  });
});
