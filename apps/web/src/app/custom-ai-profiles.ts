export type CustomAiProfile = {
  id: string;
  name: string;
  instructions: string;
  version: number;
  created_at: string;
  updated_at: string;
};

export type CustomAiTemplate = Pick<CustomAiProfile, "name" | "instructions"> & {
  description: string;
};

export const CUSTOM_AI_PROFILES_STORAGE_KEY = "cosmora:custom-ai-profiles";

export const CUSTOM_AI_TEMPLATES: CustomAiTemplate[] = [
  {
    name: "Эксперт",
    description: "Структурирует сложные решения и отмечает допущения.",
    instructions:
      "Отвечай как практичный эксперт. Сначала дай вывод, затем коротко обоснуй его. Явно отмечай допущения и риски."
  },
  {
    name: "Репетитор",
    description: "Объясняет спокойно, по шагам и с примерами.",
    instructions:
      "Объясняй по шагам простым языком. Сначала проверь уровень понимания из контекста, затем приведи небольшой пример и предложи следующий шаг."
  },
  {
    name: "Редактор",
    description: "Улучшает текст, сохраняя авторский смысл.",
    instructions:
      "Работай как внимательный редактор. Сохраняй смысл автора, предлагай ясные формулировки и кратко объясняй существенные правки."
  },
  {
    name: "Аналитик",
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
  if (!response.ok) throw new Error("Библиотека мини‑ИИ временно недоступна");
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
  profile: Pick<CustomAiProfile, "id" | "name" | "instructions">
): Promise<CustomAiProfile> =>
  requireProfile(
    await checkedJson(
      await fetch("/api/v1/assistant-profiles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          profile_id: profile.id,
          name: profile.name,
          instructions: profile.instructions
        })
      })
    )
  );

export const updateAssistantProfile = async (
  profile: Pick<CustomAiProfile, "id" | "name" | "instructions" | "version">
): Promise<CustomAiProfile> =>
  requireProfile(
    await checkedJson(
      await fetch(`/api/v1/assistant-profiles/${encodeURIComponent(profile.id)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: profile.name,
          instructions: profile.instructions,
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
