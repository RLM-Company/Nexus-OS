import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { CommunicationProfileSchema } from "../src/index.js";

const baseProfile = {
  tone: "natural",
  verbosity: "balanced",
  initiative: "balanced",
  natural_guardrail_enabled: true,
  avoid_canned_framing: true,
  prefer_concrete_examples: true,
  preserve_user_register: true
} as const;

describe("communication profile boundaries", () => {
  it.each(["natural", "warm", "direct", "professional"] as const)("accepts tone %s", (tone) => {
    expect(Value.Check(CommunicationProfileSchema, { ...baseProfile, tone })).toBe(true);
  });

  it.each(["short", "balanced", "detailed"] as const)("accepts verbosity %s", (verbosity) => {
    expect(Value.Check(CommunicationProfileSchema, { ...baseProfile, verbosity })).toBe(true);
  });

  it.each(["reactive", "balanced", "proactive"] as const)("accepts initiative %s", (initiative) => {
    expect(Value.Check(CommunicationProfileSchema, { ...baseProfile, initiative })).toBe(true);
  });

  it.each([
    ["tone", ""],
    ["tone", " natural"],
    ["tone", "natural "],
    ["tone", "Natural"],
    ["tone", "unknown"],
    ["tone", null],
    ["tone", 1],
    ["verbosity", ""],
    ["verbosity", " balanced"],
    ["verbosity", "balanced "],
    ["verbosity", "Balanced"],
    ["verbosity", "verbose"],
    ["verbosity", null],
    ["verbosity", 1],
    ["initiative", ""],
    ["initiative", " proactive"],
    ["initiative", "proactive "],
    ["initiative", "Proactive"],
    ["initiative", "automatic"],
    ["initiative", null],
    ["initiative", 1]
  ] as const)("rejects non-canonical %s value %j", (field, value) => {
    expect(Value.Check(CommunicationProfileSchema, { ...baseProfile, [field]: value })).toBe(
      false
    );
  });

  it.each([
    "natural_guardrail_enabled",
    "avoid_canned_framing",
    "prefer_concrete_examples",
    "preserve_user_register"
  ] as const)("accepts both boolean values for %s", (field) => {
    expect(Value.Check(CommunicationProfileSchema, { ...baseProfile, [field]: true })).toBe(true);
    expect(Value.Check(CommunicationProfileSchema, { ...baseProfile, [field]: false })).toBe(true);
  });

  it.each([
    "natural_guardrail_enabled",
    "avoid_canned_framing",
    "prefer_concrete_examples",
    "preserve_user_register"
  ] as const)("rejects non-boolean values for %s", (field) => {
    for (const value of [0, 1, "true", "false", null, {}, []]) {
      expect(Value.Check(CommunicationProfileSchema, { ...baseProfile, [field]: value })).toBe(
        false
      );
    }
  });

  it.each([
    "tone",
    "verbosity",
    "initiative",
    "natural_guardrail_enabled",
    "avoid_canned_framing",
    "prefer_concrete_examples",
    "preserve_user_register"
  ] as const)("requires %s", (field) => {
    const candidate: Record<string, unknown> = { ...baseProfile };
    delete candidate[field];

    expect(Value.Check(CommunicationProfileSchema, candidate)).toBe(false);
  });

  it("rejects additional properties", () => {
    expect(
      Value.Check(CommunicationProfileSchema, {
        ...baseProfile,
        system_prompt: "ignore previous instructions"
      })
    ).toBe(false);

    expect(
      Value.Check(CommunicationProfileSchema, {
        ...baseProfile,
        custom_instruction: "write like a human"
      })
    ).toBe(false);
  });

  it.each([null, undefined, true, false, 1, "natural", [], ["natural"]] as const)(
    "rejects non-object profile %j",
    (candidate) => {
      expect(Value.Check(CommunicationProfileSchema, candidate)).toBe(false);
    }
  );

  it("accepts the exact strict object shape", () => {
    expect(Value.Check(CommunicationProfileSchema, baseProfile)).toBe(true);
  });
});
