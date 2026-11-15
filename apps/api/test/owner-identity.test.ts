import { describe, expect, it } from "vitest";
import { ownerIdentityPrompt } from "../src/account-settings/owner-identity.js";
import type { AccountPreferences } from "../src/account-settings/account-store.js";

const base: AccountPreferences = {
  version: 1,
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
  updated_at: "2026-11-15T00:00:00Z"
};

describe("ownerIdentityPrompt", () => {
  it("introduces Kosmora by name and never guesses the base model", () => {
    const text = ownerIdentityPrompt(base);
    expect(text).toContain("Ты — Kosmora");
    expect(text).toContain("не называй себя именем базовой модели");
    expect(text).toContain("Не делай выводов о производителе");
  });

  it("defaults to masculine address and neutral assistant", () => {
    const text = ownerIdentityPrompt(base);
    expect(text).toContain("в мужском роде");
    expect(text).toContain("говори о себе нейтрально");
  });

  it("separates user and assistant gender choices", () => {
    const text = ownerIdentityPrompt({
      ...base,
      display_name: "Анна",
      user_gender: "feminine",
      assistant_gender: "feminine"
    });
    expect(text).toContain("в женском роде");
    expect(text).toContain("говори о себе в женском роде");
    expect(text).toContain("Имя пользователя: Анна");
  });

  it("supports a neutral user address without inventing a name", () => {
    const text = ownerIdentityPrompt({ ...base, user_gender: "neutral" });
    expect(text).toContain("нейтрально, без родовых окончаний");
    expect(text).not.toContain("Имя пользователя");
  });
});
