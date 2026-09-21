export type CustomAiProfile = {
  id: string;
  name: string;
  instructions: string;
  avatar: string | null;
  starter_prompts: string[];
  version: number;
  created_at: string;
  updated_at: string;
};

export type CustomAiTemplate = Pick<
  CustomAiProfile,
  "name" | "instructions" | "avatar" | "starter_prompts"
> & {
  description: string;
};

export type CustomAiProfileDraft = Pick<
  CustomAiProfile,
  "name" | "instructions" | "avatar" | "starter_prompts"
>;

export const CUSTOM_AI_PROFILES_STORAGE_KEY = "cosmora:custom-ai-profiles";
export const CUSTOM_AI_DEFAULT_PROFILE_STORAGE_KEY = "cosmora:default-custom-ai-profile";
const CUSTOM_AI_SHARE_FORMAT = "cosmora-mini-ai";
const CUSTOM_AI_IMPORT_MAX_CHARACTERS = 20_000;

export const CUSTOM_AI_TEMPLATES: CustomAiTemplate[] = [
  {
    name: "Эксперт",
    avatar: "🧭",
    starter_prompts: ["Разбери сложную задачу", "Сравни два варианта"],
    description: "Структурирует сложные решения и отмечает допущения.",
    instructions:
      "Отвечай как практичный эксперт. Сначала дай вывод, затем коротко обоснуй его. Явно отмечай допущения и риски."
  },
  {
    name: "Репетитор",
    avatar: "🎓",
    starter_prompts: ["Объясни тему простыми словами", "Проверь мои знания"],
    description: "Объясняет спокойно, по шагам и с примерами.",
    instructions:
      "Объясняй по шагам простым языком. Сначала проверь уровень понимания из контекста, затем приведи небольшой пример и предложи следующий шаг."
  },
  {
    name: "Редактор",
    avatar: "✍️",
    starter_prompts: ["Улучши мой текст", "Сделай текст короче"],
    description: "Улучшает текст, сохраняя авторский смысл.",
    instructions:
      "Работай как внимательный редактор. Сохраняй смысл автора, предлагай ясные формулировки и кратко объясняй существенные правки."
  },
  {
    name: "Аналитик",
    avatar: "📊",
    starter_prompts: ["Сравни варианты", "Выдели риски и допущения"],
    description: "Сравнивает варианты и отделяет факты от выводов.",
    instructions:
      "Работай как аналитик. Отделяй известные факты от предположений, сравнивай варианты по критериям и заканчивай практической рекомендацией."
  }
];

const normalize = (value: unknown): CustomAiProfile | null => {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<CustomAiProfile>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.name !== "string" ||
    typeof candidate.instructions !== "string"
  ) {
    return null;
  }
  const id = candidate.id.trim();
  const name = candidate.name.trim();
  const instructions = candidate.instructions.trim();
  if (!id || !name || !instructions || name.length > 80 || instructions.length > 4_000) return null;
  const avatar =
    typeof candidate.avatar === "string" && candidate.avatar.trim().length <= 16
      ? candidate.avatar.trim() || null
      : null;
  const starterPrompts = Array.isArray(candidate.starter_prompts)
    ? candidate.starter_prompts
        .filter(
          (prompt): prompt is string =>
            typeof prompt === "string" && Boolean(prompt.trim()) && prompt.trim().length <= 160
        )
        .slice(0, 4)
        .map((prompt) => prompt.trim())
    : [];
  const version =
    typeof candidate.version === "number" &&
    Number.isInteger(candidate.version) &&
    candidate.version >= 1
      ? candidate.version
      : 0;
  return {
    id,
    name,
    instructions,
    avatar,
    starter_prompts: starterPrompts,
    version,
    created_at: typeof candidate.created_at === "string" ? candidate.created_at : "",
    updated_at: typeof candidate.updated_at === "string" ? candidate.updated_at : ""
  };
};

const requireProfile = (value: unknown): CustomAiProfile => {
  const profile = normalize(value);
  if (!profile || profile.version < 1 || !profile.created_at || !profile.updated_at) {
    throw new Error("Некорректный ответ библиотеки мини‑ИИ");
  }
  return profile;
};

const checkedJson = async (response: Response): Promise<unknown> => {
  if (!response.ok) {
    if (response.status === 400) {
      throw new Error("Проверьте имя, инструкции и стартовые запросы мини‑ИИ");
    }
    if (response.status === 404) {
      throw new Error("Профиль уже удалён. Обновите страницу");
    }
    if (response.status === 409) {
      throw new Error("Профиль изменился в другой вкладке. Обновите страницу и повторите правку");
    }
    if (response.status >= 500) {
      throw new Error("Локальный API мини‑ИИ временно недоступен. Попробуйте ещё раз");
    }
    throw new Error("Не удалось обратиться к библиотеке мини‑ИИ");
  }
  return response.json() as Promise<unknown>;
};

export const loadAssistantProfiles = async (): Promise<CustomAiProfile[]> => {
  const value = await checkedJson(await fetch("/api/v1/assistant-profiles", { cache: "no-store" }));
  if (!value || typeof value !== "object" || !("items" in value) || !Array.isArray(value.items)) {
    throw new Error("Некорректный ответ библиотеки мини‑ИИ");
  }
  return value.items.map(requireProfile);
};

export const createAssistantProfile = async (
  profile: Pick<CustomAiProfile, "id" | "name" | "instructions" | "avatar" | "starter_prompts">
): Promise<CustomAiProfile> =>
  requireProfile(
    await checkedJson(
      await fetch("/api/v1/assistant-profiles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          profile_id: profile.id,
          name: profile.name,
          instructions: profile.instructions,
          avatar: profile.avatar,
          starter_prompts: profile.starter_prompts
        })
      })
    )
  );

export const updateAssistantProfile = async (
  profile: Pick<
    CustomAiProfile,
    "id" | "name" | "instructions" | "avatar" | "starter_prompts" | "version"
  >
): Promise<CustomAiProfile> =>
  requireProfile(
    await checkedJson(
      await fetch(`/api/v1/assistant-profiles/${encodeURIComponent(profile.id)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: profile.name,
          instructions: profile.instructions,
          avatar: profile.avatar,
          starter_prompts: profile.starter_prompts,
          expected_version: profile.version
        })
      })
    )
  );

export const deleteAssistantProfile = async (profile: CustomAiProfile): Promise<void> => {
  await checkedJson(
    await fetch(`/api/v1/assistant-profiles/${encodeURIComponent(profile.id)}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expected_version: profile.version })
    })
  );
};

export const readCustomAiProfiles = (): CustomAiProfile[] => {
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(CUSTOM_AI_PROFILES_STORAGE_KEY) ?? "[]"
    );
    if (!Array.isArray(value)) return [];
    return value.map(normalize).filter((profile): profile is CustomAiProfile => profile !== null);
  } catch {
    return [];
  }
};

export const writeCustomAiProfiles = (profiles: CustomAiProfile[]): void => {
  window.localStorage.setItem(CUSTOM_AI_PROFILES_STORAGE_KEY, JSON.stringify(profiles));
};

export const readDefaultCustomAiProfileId = (): string | null => {
  try {
    return window.localStorage.getItem(CUSTOM_AI_DEFAULT_PROFILE_STORAGE_KEY)?.trim() || null;
  } catch {
    return null;
  }
};

export const writeDefaultCustomAiProfileId = (profileId: string | null): void => {
  try {
    if (profileId) window.localStorage.setItem(CUSTOM_AI_DEFAULT_PROFILE_STORAGE_KEY, profileId);
    else window.localStorage.removeItem(CUSTOM_AI_DEFAULT_PROFILE_STORAGE_KEY);
  } catch {
    // A blocked browser preference must not stop profile use for the current session.
  }
};

export const serializeCustomAiProfile = (profile: CustomAiProfileDraft): string =>
  JSON.stringify(
    {
      format: CUSTOM_AI_SHARE_FORMAT,
      version: 1,
      profile: {
        name: profile.name,
        instructions: profile.instructions,
        avatar: profile.avatar,
        starter_prompts: profile.starter_prompts
      }
    },
    null,
    2
  );

export const customAiProfileFileName = (name: string): string => {
  const safeName = name
    .trim()
    .replace(/[<>:"/\\|?*]/g, "-")
    .split("")
    .map((character) => (character.charCodeAt(0) < 32 ? "-" : character))
    .join("")
    .replace(/\s+/g, " ")
    .slice(0, 60);
  return `cosmora-${safeName || "mini-ai"}.json`;
};

export const parseCustomAiProfile = (text: string): CustomAiProfileDraft => {
  if (text.length > CUSTOM_AI_IMPORT_MAX_CHARACTERS) {
    throw new Error("Файл мини‑ИИ слишком большой");
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Файл мини‑ИИ содержит некорректный JSON");
  }
  if (!value || typeof value !== "object") throw new Error("Это не файл профиля Cosmora");
  const envelope = value as { format?: unknown; version?: unknown; profile?: unknown };
  if (
    envelope.format !== CUSTOM_AI_SHARE_FORMAT ||
    envelope.version !== 1 ||
    !envelope.profile ||
    typeof envelope.profile !== "object"
  ) {
    throw new Error("Формат профиля мини‑ИИ не поддерживается");
  }
  const profile = envelope.profile as Partial<CustomAiProfileDraft>;
  const name = typeof profile.name === "string" ? profile.name.trim() : "";
  const instructions = typeof profile.instructions === "string" ? profile.instructions.trim() : "";
  const avatar =
    typeof profile.avatar === "string" ? profile.avatar.trim() || null : profile.avatar;
  if (
    !name ||
    name.length > 80 ||
    !instructions ||
    instructions.length > 4_000 ||
    (avatar !== null && (typeof avatar !== "string" || avatar.length > 16)) ||
    !Array.isArray(profile.starter_prompts) ||
    profile.starter_prompts.length > 4 ||
    profile.starter_prompts.some(
      (prompt) => typeof prompt !== "string" || !prompt.trim() || prompt.trim().length > 160
    )
  ) {
    throw new Error("Поля профиля мини‑ИИ заполнены некорректно");
  }
  return {
    name,
    instructions,
    avatar,
    starter_prompts: profile.starter_prompts.map((prompt) => prompt.trim())
  };
};
