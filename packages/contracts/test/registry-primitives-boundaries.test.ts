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

const baseRouteRequest = {
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

  it.each([
    "2026-09-22T20:00:00Z",
    "2026-09-22T20:00:00.000Z"
  ] as const)("accepts canonical ISO datetime shape %s", (value) => {
    expect(Value.Check(IsoDateTimeSchema, value)).toBe(true);
  });

  it.each([
    "",
    "2026-09-22",
    "2026-09-22T20:00:00",
    "2026-09-22 20:00:00Z",
    "2026-09-22T20:00:00+03:00",
    "2026-09-22T20:00:00.0Z",
    "2026-09-22T20:00:00.00Z",
    "2026-09-22T20:00:00.0000Z"
  ] as const)("rejects non-canonical ISO datetime shape %s", (value) => {
    expect(Value.Check(IsoDateTimeSchema, value)).toBe(false);
  });

  it.each(["USD", "RUB"] as const)("accepts currency %s", (currency) => {
    expect(Value.Check(CurrencySchema, currency)).toBe(true);
  });

  it.each(["", "EUR", "usd", " RUB ", null, 1] as const)(
    "rejects unsupported currency %j",
    (currency) => {
      expect(Value.Check(CurrencySchema, currency)).toBe(false);
    }
  );
});

describe("model registry entry boundaries", () => {
  it.each(["mock", "openai-compatible", "anthropic-compatible"] as const)(
    "accepts protocol %s",
    (protocol) => {
      expect(Value.Check(ModelProtocolSchema, protocol)).toBe(true);
      expect(Value.Check(ModelRegistryEntrySchema, { ...baseEntry, protocol })).toBe(true);
    }
  );

  it.each(["", "openai", "anthropic", "Mock", " mock ", null, 1] as const)(
    "rejects invalid protocol %j",
    (protocol) => {
      expect(Value.Check(ModelProtocolSchema, protocol)).toBe(false);
      expect(Value.Check(ModelRegistryEntrySchema, { ...baseEntry, protocol })).toBe(false);
    }
  );

  it.each(["streaming", "structured_output", "tool_calling", "vision"] as const)(
    "accepts feature %s",
    (feature) => {
      expect(Value.Check(ModelFeatureSchema, feature)).toBe(true);
    }
  );

  it.each(["", "audio", "tools", "Streaming", " streaming ", null, 1] as const)(
    "rejects invalid feature %j",
    (feature) => {
      expect(Value.Check(ModelFeatureSchema, feature)).toBe(false);
    }
  );

  it.each([
    ["provider_id", 1, true],
    ["provider_id", 128, true],
    ["provider_id", 129, false],
    ["model_id", 1, true],
    ["model_id", 256, true],
    ["model_id", 257, false]
  ] as const)("checks %s length %d", (field, length, expected) => {
    expect(Value.Check(ModelRegistryEntrySchema, { ...baseEntry, [field]: "a".repeat(length) })).toBe(
      expected
    );
  });

  it("requires at least one alias and bounds alias length", () => {
    expect(Value.Check(ModelRegistryEntrySchema, { ...baseEntry, aliases: [] })).toBe(false);
    expect(Value.Check(ModelRegistryEntrySchema, { ...baseEntry, aliases: ["a"] })).toBe(true);
    expect(
      Value.Check(ModelRegistryEntrySchema, { ...baseEntry, aliases: ["a".repeat(128)] })
    ).toBe(true);
    expect(
      Value.Check(ModelRegistryEntrySchema, { ...baseEntry, aliases: ["a".repeat(129)] })
    ).toBe(false);
    expect(Value.Check(ModelRegistryEntrySchema, { ...baseEntry, aliases: [""] })).toBe(false);
  });

  it.each(["active", "disabled"] as const)("accepts status %s", (status) => {
    expect(Value.Check(ModelRegistryEntrySchema, { ...baseEntry, status })).toBe(true);
  });

  it.each(["", "inactive", "Active", null, 1] as const)("rejects invalid status %j", (status) => {
    expect(Value.Check(ModelRegistryEntrySchema, { ...baseEntry, status })).toBe(false);
  });

  it.each([
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
  ] as const)("checks numeric %s value %s", (field, value, expected) => {
    expect(Value.Check(ModelRegistryEntrySchema, { ...baseEntry, [field]: value })).toBe(expected);
  });

  it.each([
    "streaming",
    "structured_output",
    "tool_calling",
    "vision"
  ] as const)("requires boolean capability %s", (field) => {
    expect(
      Value.Check(ModelRegistryEntrySchema, {
        ...baseEntry,
        capabilities: { ...baseEntry.capabilities, [field]: true }
      })
    ).toBe(true);
    expect(
      Value.Check(ModelRegistryEntrySchema, {
        ...baseEntry,
        capabilities: { ...baseEntry.capabilities, [field]: false }
      })
    ).toBe(true);

    for (const value of [0, 1, "true", null]) {
      expect(
        Value.Check(ModelRegistryEntrySchema, {
          ...baseEntry,
          capabilities: { ...baseEntry.capabilities, [field]: value }
        })
      ).toBe(false);
    }
  });

  it("rejects extra capability properties", () => {
    expect(
      Value.Check(ModelRegistryEntrySchema, {
        ...baseEntry,
        capabilities: { ...baseEntry.capabilities, audio: true }
      })
    ).toBe(false);
  });

  it("accepts null or non-negative pricing", () => {
    expect(Value.Check(ModelRegistryEntrySchema, { ...baseEntry, pricing: null })).toBe(true);
    expect(
      Value.Check(ModelRegistryEntrySchema, {
        ...baseEntry,
        pricing: {
          currency: "RUB",
          input_per_million_tokens: 0,
          output_per_million_tokens: 0
        }
      })
    ).toBe(true);

    for (const pricing of [
      { ...baseEntry.pricing, input_per_million_tokens: -0.01 },
      { ...baseEntry.pricing, output_per_million_tokens: -0.01 },
      { ...baseEntry.pricing, currency: "EUR" },
      { ...baseEntry.pricing, unexpected: true }
    ]) {
      expect(Value.Check(ModelRegistryEntrySchema, { ...baseEntry, pricing })).toBe(false);
    }
  });

  it.each(["none", "opt_out", "unknown"] as const)(
    "accepts training usage %s",
    (trainingUsage) => {
      expect(
        Value.Check(ModelRegistryEntrySchema, {
          ...baseEntry,
          privacy: { ...baseEntry.privacy, training_usage: trainingUsage }
        })
      ).toBe(true);
    }
  );

  it.each(["zero", "limited", "unknown"] as const)("accepts retention %s", (retention) => {
    expect(
      Value.Check(ModelRegistryEntrySchema, {
        ...baseEntry,
        privacy: { ...baseEntry.privacy, retention }
      })
    ).toBe(true);
  });

  it("rejects invalid privacy vocabulary and extra properties", () => {
    expect(
      Value.Check(ModelRegistryEntrySchema, {
        ...baseEntry,
        privacy: { ...baseEntry.privacy, training_usage: "yes" }
      })
    ).toBe(false);
    expect(
      Value.Check(ModelRegistryEntrySchema, {
        ...baseEntry,
        privacy: { ...baseEntry.privacy, retention: "forever" }
      })
    ).toBe(false);
    expect(
      Value.Check(ModelRegistryEntrySchema, {
        ...baseEntry,
        privacy: { ...baseEntry.privacy, unexpected: true }
      })
    ).toBe(false);
  });

  it.each(["static", "authorized_discovery"] as const)("accepts source kind %s", (kind) => {
    expect(
      Value.Check(ModelRegistryEntrySchema, {
        ...baseEntry,
        source: { ...baseEntry.source, kind }
      })
    ).toBe(true);
  });

  it("accepts nullable source evidence metadata", () => {
    expect(
      Value.Check(ModelRegistryEntrySchema, {
        ...baseEntry,
        source: {
          kind: "static",
          verified_at: null,
          valid_until: null,
          reference: null
        }
      })
    ).toBe(true);
  });

  it("rejects malformed source evidence metadata", () => {
    for (const source of [
      { ...baseEntry.source, kind: "manual" },
      { ...baseEntry.source, verified_at: "2026-09-22" },
      { ...baseEntry.source, valid_until: "2026-10-22" },
      { ...baseEntry.source, reference: "" },
      { ...baseEntry.source, unexpected: true }
    ]) {
      expect(Value.Check(ModelRegistryEntrySchema, { ...baseEntry, source })).toBe(false);
    }
  });

  it("rejects unexpected top-level entry properties", () => {
    expect(Value.Check(ModelRegistryEntrySchema, { ...baseEntry, api_key: "secret" })).toBe(false);
  });
});

describe("model registry document boundaries", () => {
  const baseDocument = {
    schema_version: 1,
    registry_version: "registry-1",
    generated_at: "2026-09-22T20:00:00.000Z",
    entries: [baseEntry]
  } as const;

  it("accepts the canonical document", () => {
    expect(Value.Check(ModelRegistryDocumentSchema, baseDocument)).toBe(true);
  });

  it.each([0, 2, "1", null] as const)("rejects schema version %j", (schemaVersion) => {
    expect(
      Value.Check(ModelRegistryDocumentSchema, {
        ...baseDocument,
        schema_version: schemaVersion
      })
    ).toBe(false);
  });

  it.each([
    ["", false],
    ["a", true],
    ["a".repeat(64), true],
    ["a".repeat(65), false]
  ] as const)("checks registry version length for %s", (registryVersion, expected) => {
    expect(
      Value.Check(ModelRegistryDocumentSchema, {
        ...baseDocument,
        registry_version: registryVersion
      })
    ).toBe(expected);
  });

  it("accepts an empty registry and rejects malformed generated time", () => {
    expect(Value.Check(ModelRegistryDocumentSchema, { ...baseDocument, entries: [] })).toBe(true);
    expect(
      Value.Check(ModelRegistryDocumentSchema, {
        ...baseDocument,
        generated_at: "2026-09-22"
      })
    ).toBe(false);
  });

  it("rejects extra document properties", () => {
    expect(
      Value.Check(ModelRegistryDocumentSchema, {
        ...baseDocument,
        secret: "unexpected"
      })
    ).toBe(false);
  });
});

describe("model route request boundaries", () => {
  it.each(["balanced", "quality", "latency", "cost"] as const)(
    "accepts optimization mode %s",
    (optimizeFor) => {
      expect(
        Value.Check(ModelRouteRequestSchema, {
          ...baseRouteRequest,
          optimize_for: optimizeFor
        })
      ).toBe(true);
    }
  );

  it("accepts nullable preferred routing targets", () => {
    expect(Value.Check(ModelRouteRequestSchema, baseRouteRequest)).toBe(true);
    expect(
      Value.Check(ModelRouteRequestSchema, {
        ...baseRouteRequest,
        preferred_provider: "provider-1",
        preferred_model_alias: "manager"
      })
    ).toBe(true);
  });

  it("rejects empty non-null preferred routing targets", () => {
    expect(
      Value.Check(ModelRouteRequestSchema, {
        ...baseRouteRequest,
        preferred_provider: ""
      })
    ).toBe(false);
    expect(
      Value.Check(ModelRouteRequestSchema, {
        ...baseRouteRequest,
        preferred_model_alias: ""
      })
    ).toBe(false);
  });

  it("enforces unique known required features", () => {
    expect(
      Value.Check(ModelRouteRequestSchema, {
        ...baseRouteRequest,
        required_features: ["streaming", "vision"]
      })
    ).toBe(true);
    expect(
      Value.Check(ModelRouteRequestSchema, {
        ...baseRouteRequest,
        required_features: ["streaming", "streaming"]
      })
    ).toBe(false);
    expect(
      Value.Check(ModelRouteRequestSchema, {
        ...baseRouteRequest,
        required_features: ["audio"]
      })
    ).toBe(false);
  });

  it("enforces route numeric boundaries", () => {
    expect(
      Value.Check(ModelRouteRequestSchema, {
        ...baseRouteRequest,
        estimated_input_tokens: 0,
        max_output_tokens: 1
      })
    ).toBe(true);
    expect(
      Value.Check(ModelRouteRequestSchema, {
        ...baseRouteRequest,
        estimated_input_tokens: -1
      })
    ).toBe(false);
    expect(
      Value.Check(ModelRouteRequestSchema, {
        ...baseRouteRequest,
        estimated_input_tokens: 1.5
      })
    ).toBe(false);
    expect(
      Value.Check(ModelRouteRequestSchema, {
        ...baseRouteRequest,
        max_output_tokens: 0
      })
    ).toBe(false);
    expect(
      Value.Check(ModelRouteRequestSchema, {
        ...baseRouteRequest,
        max_output_tokens: 1.5
      })
    ).toBe(false);
  });

  it("enforces route max cost shape", () => {
    expect(
      Value.Check(ModelRouteRequestSchema, {
        ...baseRouteRequest,
        max_cost: { amount: 0, currency: "USD" }
      })
    ).toBe(true);
    expect(
      Value.Check(ModelRouteRequestSchema, {
        ...baseRouteRequest,
        max_cost: { amount: -0.01, currency: "USD" }
      })
    ).toBe(false);
    expect(
      Value.Check(ModelRouteRequestSchema, {
        ...baseRouteRequest,
        max_cost: { amount: 1, currency: "EUR" }
      })
    ).toBe(false);
    expect(
      Value.Check(ModelRouteRequestSchema, {
        ...baseRouteRequest,
        max_cost: { amount: 1, currency: "USD", unexpected: true }
      })
    ).toBe(false);
  });

  it("rejects missing or additional route properties", () => {
    expect(
      Value.Check(ModelRouteRequestSchema, {
        ...baseRouteRequest,
        unexpected: true
      })
    ).toBe(false);

    const candidate: Record<string, unknown> = { ...baseRouteRequest };
    delete candidate.role;
    expect(Value.Check(ModelRouteRequestSchema, candidate)).toBe(false);
  });
});
