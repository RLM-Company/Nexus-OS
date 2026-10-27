export type CodePatchFile = { path: string; before: string | null; content: string };
export type CodePatchPreview = {
  files: CodePatchFile[];
  normalizedDiff: string;
  normalizations: Array<{ path: string; line: number; before: string; after: string }>;
  snapshotDigest: string;
  resultDigest: string;
  baseSha: string;
};
export const codePatchMessages: Record<string, string> = {
  PATCH_LIMIT: "Патч превышает лимит: до 8 файлов, 200 КБ diff и 160 КБ итоговых изменений.",
  PATCH_FORMAT:
    "Формат diff повреждён. Исправляются только счётчики hunk; строки и заголовки не додумываются.",
  PATCH_TRUNCATED:
    "Патч оборван: отсутствует завершающий перевод строки. Автоматический повтор модели не выполняется.",
  PATCH_PATH:
    "Пути diff не совпадают или запрещены. Система не заменяет пути репозитория автоматически.",
  PATCH_UNSUPPORTED:
    "Переименование, удаление файла, смена режима и бинарные патчи здесь не поддерживаются.",
  PATCH_CONTEXT:
    "Старые строки не совпали со снимком. Удалять другой текст или применять патч с fuzz запрещено.",
  PATCH_AMBIGUOUS:
    "Патч неоднозначен: повторяющийся контекст, дубли файлов или недостаточные опорные строки.",
  PATCH_POSITION:
    "Позиции hunk неверны или перекрываются. Нормализуются только количества строк, не позиции.",
  PATCH_BASE: "Базовый commit изменился или не совпал с предложением. Нужен новый снимок.",
  PATCH_SNAPSHOT:
    "Снимок не совпал с тем, для которого создано предложение. Старую проверку использовать нельзя.",
  PATCH_FILE_NOT_READ: "Патч меняет непрочитанный файл либо объявляет существующий путь новым.",
  PATCH_INDEX:
    "Git blob index не совпал с исходным или итоговым содержимым. SHA не исправляется автоматически.",
  PATCH_EMPTY: "В патче нет применимых изменений.",
  CONTEXT_FILES_REQUIRED:
    "Укажите файлы для чтения: безопасно выбрать небольшой контекст без дополнительного платного запроса не удалось.",
  OWNER_BUDGET_LIMIT: "Общий бюджет владельца не разрешает запрос.",
  STALE_REVIEW:
    "Предложение или просмотр изменились. Обновите состояние и подтвердите точные изменения заново.",
  POLICY_DENIED: "Политика проекта запрещает действие.",
  UNAUTHORIZED: "Вход владельца истёк. Войдите в Kosmora заново."
};
export async function codePatchRequest<T>(
  project: string,
  suffix: string,
  body: unknown
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1/projects/${encodeURIComponent(project)}/code-agent${suffix}`, {
      method: "POST",
      redirect: "error",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(65000)
    });
  } catch {
    throw new Error(
      "Связь с API потеряна или истёк лимит ожидания. Обновите состояние; запрос автоматически не повторяется."
    );
  }
  let data: {
    error?: { code?: string; diagnostic?: { path?: string; line?: number } };
  };
  try {
    data = (await response.json()) as typeof data;
  } catch {
    throw new Error(
      "Ответ API не подтверждён. Обновите состояние; запрос автоматически не повторяется."
    );
  }
  if (!response.ok) {
    const code = data.error?.code ?? "UNKNOWN";
    const at = data.error?.diagnostic;
    throw new Error(
      (codePatchMessages[code] ?? "Операция не подтверждена сервером. Обновите состояние.") +
        (at?.path ? ` Файл: ${at.path}${at.line ? `, строка diff ${at.line}` : ""}.` : "")
    );
  }
  return data as T;
}
