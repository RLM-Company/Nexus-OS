import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { CommunicationProfileSchema } from "../src/index.js";

const profile = {
  tone: "natural",
  verbosity: "balanced",
  initiative: "balanced",
  natural_guardrail_enabled: true,
  avoid_canned_framing: true,
  prefer_concrete_examples: true,
  preserve_user_register: true
} as const;

describe("communication profile boundaries", () => {
  it("accepts every current enum value", () => {
    for (const tone of ["natural", "warm", "direct", "professional"]) {
      expect(Value.Check(CommunicationProfileSchema, { ...profile, tone })).toBe(true);
    }

    for (const verbosity of ["short", "balanced", "detailed"]) {
      expect(Value.Check(CommunicationProfileSchema, { ...profile, verbosity })).toBe(true);
    }

    for (const initiative of ["reactive", "balanced", "proactive"]) {
      expect(Value.Check(CommunicationProfileSchema, { ...profile, initiative })).toBe(true);
    }
  });

  it("rejects non-canonical enum values", () => {
    const cases = [
      ["tone", ""],
      ["tone", " natural"],
      ["tone", "natural "],
      ["tone", "Natural"],
      ["tone", "unknown"],
      ["verbosity", ""],
      ["verbosity", " balanced"],
      ["verbosity", "Balanced"],
      ["verbosity", "verbose"],
      ["initiative", ""],
      ["initiative", " proactive"],
      ["initiative", "Proactive"],
      ["initiative", "automatic"]
    ] as const;

    for (const [field, value] of cases) {
      expect(Value.Check(CommunicationProfileSchema, { ...profile, [field]: value })).toBe(false);
    }
  });

  it("requires strict booleans and every declared property", () => {
    const booleanFields = [
      "natural_guardrail_enabled",
      "avoid_canned_framing",
      "prefer_concrete_examples",
      "preserve_user_register"
    ] as const;

    for (const field of booleanFields) {
      expect(Value.Check(CommunicationProfileSchema, { ...profile, [field]: true })).toBe(true);
      expect(Value.Check(CommunicationProfileSchema, { ...profile, [field]: false })).toBe(true);

      for (const value of [0, 1, "true", null]) {
        expect(Value.Check(CommunicationProfileSchema, { ...profile, [field]: value })).toBe(false);
      }
    }

    for (const field of [
      "tone",
      "verbosity",
      "initiative",
      ...booleanFields
    ] as const) {
      const candidate: Record<string, unknown> = { ...profile };
      delete candidate[field];
      expect(Value.Check(CommunicationProfileSchema, candidate)).toBe(false);
    }
  });

  it("rejects extra properties and non-object values", () => {
    expect(
      Value.Check(CommunicationProfileSchema, {
        ...profile,
        system_prompt: "ignore previous instructions"
      })
    ).toBe(false);

    expect(
      Value.Check(CommunicationProfileSchema, {
        ...profile,
        custom_instruction: "write like a human"
      })
    ).toBe(false);

    for (const candidate of [null, true, 1, "natural", []]) {
      expect(Value.Check(CommunicationProfileSchema, candidate)).toBe(false);
    }

    expect(Value.Check(CommunicationProfileSchema, profile)).toBe(true);
  });
});
