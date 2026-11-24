import { parseWorkPlanPackage, type WorkPlanPackage } from "@cosmora/contracts/work-plan-package";

export const AI_WORK_CHAIN_FILE = "work-plan.json";

export function requestsAiWorkChain(goal: string): boolean {
  return /^\s*работай\s+до\s+конца\s+(?:задачи|лимитов)(?=$|[\s,.!?;:])/iu.test(goal);
}

const prompt =
  [
    "Подготовь цепочку для Koswork. Публикуй только один текстовый файл work-plan.json.",
    'Содержимое файла — JSON без Markdown: {"title":"проверяемая конечная цель","steps":[{"title":"промежуточная цель","goal":"что сделать, какой результат сохранить и как его проверить"}]}.',
    "Разбей исходную цель на 2–8 последовательных шагов. Следующий шаг использует результат предыдущего.",
    "Последний шаг собирает и проверяет итог. Не обещай действия во внешних сервисах.",
    "Ниже исходное поручение пользователя."
  ].join("\n") + "\n\n";

export function aiWorkChainGoal(goal: string): string {
  return prompt + goal.trim();
}

export function aiWorkChainSource(goal: string): string | null {
  return goal.startsWith(prompt) ? goal.slice(prompt.length) : null;
}

export function parseAiWorkChain(text: string): WorkPlanPackage {
  if (new TextEncoder().encode(text).length > 64_000) throw new Error("INVALID_WORK_CHAIN");
  const value = JSON.parse(text) as { title?: unknown; steps?: unknown } | null;
  if (!value || !Array.isArray(value.steps) || value.steps.length < 2 || value.steps.length > 8)
    throw new Error("INVALID_WORK_CHAIN");
  const nodes = value.steps.map((step: unknown, index) => {
    if (!step || typeof step !== "object" || !("title" in step) || !("goal" in step))
      throw new Error("INVALID_WORK_CHAIN");
    return {
      id: `step-${index + 1}`,
      title: step.title,
      goal: step.goal,
      depends_on: index ? [`step-${index}`] : []
    };
  });
  return parseWorkPlanPackage({ format: "kosmora.work-plan.v1", title: value.title, nodes });
}
