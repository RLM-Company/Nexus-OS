export type CustomAiProfile = {
  id: string;
  name: string;
  instructions: string;
};

export type CustomAiTemplate = Omit<CustomAiProfile, "id"> & {
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
  return { id, name, instructions };
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
