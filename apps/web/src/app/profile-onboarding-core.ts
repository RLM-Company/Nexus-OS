/** Chистая логика first-run онбординга (без DOM), чтобы её можно было проверить. */
export type Gender = "masculine" | "feminine" | "neutral";
export type OnboardingSettings = {
  version: number;
  relay_enabled: boolean;
  response_language: "ru" | "en";
  optimize_for: "balanced" | "cost" | "quality" | "latency";
  preferred_provider: string | null;
  preferred_model: string | null;
  chat_style: "standard" | "concise" | "detailed";
  max_total_tokens: number | null;
  display_name: string;
  user_gender: Gender;
  assistant_gender: Gender;
};
export const ONBOARDING_DONE_KEY = "kosmora:profile-onboarding.v1";

/** Показывать онбординг только если имя ещё не задано и метка «пройдено» не стоит.
 * Версию настроек намеренно не проверяем: другие настройки могли поднять её раньше. */
export const shouldShowOnboarding = (
  settings: OnboardingSettings | null | undefined,
  done: string | null
): boolean => done !== "done" && Boolean(settings) && !settings!.display_name.trim();

/** Тело PUT: все обязательные поля настроек + три поля профиля, CAS по версии. */
export const onboardingPayload = (
  settings: OnboardingSettings,
  input: { name: string; userGender: Gender; assistantGender: Gender }
) => ({
  expected_version: settings.version,
  relay_enabled: settings.relay_enabled,
  response_language: settings.response_language,
  optimize_for: settings.optimize_for,
  preferred_provider: settings.preferred_provider,
  preferred_model: settings.preferred_model,
  chat_style: settings.chat_style,
  max_total_tokens: settings.max_total_tokens,
  display_name: input.name.trim(),
  user_gender: input.userGender,
  assistant_gender: input.assistantGender
});
