import { describe, expect, it } from "vitest";
import {
  ONBOARDING_DONE_KEY,
  onboardingPayload,
  shouldShowOnboarding,
  type OnboardingSettings
} from "./profile-onboarding-core";

const fresh = (extra: Partial<OnboardingSettings> = {}): OnboardingSettings => ({
  version: 0,
  relay_enabled: false,
  response_language: "ru",
  optimize_for: "balanced",
  preferred_provider: null,
  preferred_model: null,
  chat_style: "standard",
  max_total_tokens: null,
  display_name: "",
  user_gender: "masculine",
  assistant_gender: "neutral",
  ...extra
});

describe("first-run onboarding rules", () => {
  it("shows only for a nameless profile without the done marker", () => {
    expect(shouldShowOnboarding(fresh(), null)).toBe(true);
    expect(shouldShowOnboarding(fresh(), "done")).toBe(false);
    expect(shouldShowOnboarding(fresh({ display_name: "Анна" }), null)).toBe(false);
    expect(shouldShowOnboarding(null, null)).toBe(false);
  });

  it("does not depend on the settings version (other settings may bump it)", () => {
    expect(shouldShowOnboarding(fresh({ version: 7 }), null)).toBe(true);
    expect(shouldShowOnboarding(fresh({ version: 7, display_name: "  " }), null)).toBe(true);
  });

  it("builds a complete CAS payload with trimmed name and both genders", () => {
    const payload = onboardingPayload(fresh({ version: 3 }), {
      name: "  Анна  ",
      userGender: "feminine",
      assistantGender: "neutral"
    });
    expect(payload).toMatchObject({
      expected_version: 3,
      display_name: "Анна",
      user_gender: "feminine",
      assistant_gender: "neutral",
      response_language: "ru",
      max_total_tokens: null
    });
    expect(Object.keys(payload)).toHaveLength(11);
  });

  it("uses a namespaced storage key", () => {
    expect(ONBOARDING_DONE_KEY).toBe("kosmora:profile-onboarding.v1");
  });
});
