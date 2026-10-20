export type IssueState = "open" | "closed" | "all";
export type IssueSummary = {
  number: number;
  title: string;
  state: "open" | "closed";
  url: string;
  updated_at: string;
};
export type IssueDetail = IssueSummary & {
  body: string;
  body_total_chars: number;
  body_truncated: boolean;
};
export type IssuePage = {
  repository: string;
  items: IssueSummary[];
  page: number;
  next_page: number | null;
  limited: boolean;
};
export type IssueContext = {
  repository: string;
  number: number;
  title: string;
  body: string;
  source_body_chars: number;
  source_updated_at: string;
  truncated: boolean;
  truncation_approved: boolean;
};
export const issueMessages: Record<string, string> = {
  GITHUB_ISSUES_NOT_CONFIGURED: "GitHub не подключён на сервере.",
  GITHUB_ISSUES_DENIED: "Текущее подключение не разрешает чтение Issues. Доступ не расширялся.",
  GITHUB_ISSUES_NOT_FOUND:
    "Issue не найден, Issues отключены или текущему подключению недоступен этот ресурс.",
  GITHUB_ISSUES_RATE_LIMITED: "GitHub ограничил частоту запросов. Повторите чтение позднее.",
  GITHUB_ISSUES_TIMEOUT: "GitHub не ответил в срок. Можно повторить чтение.",
  GITHUB_ISSUES_CANCELLED: "Чтение отменено.",
  GITHUB_ISSUES_UNAVAILABLE: "Ответ GitHub не подтверждён. Можно повторить чтение.",
  GITHUB_ISSUES_LIMIT: "Ответ GitHub превышает допустимый объём. Уточните поиск.",
  GITHUB_ISSUES_INPUT:
    "Поиск: до 160 символов, без кавычек, обратной косой черты и управляющих символов.",
  GITHUB_ISSUES_BUSY: "Выполняется слишком много чтений. Дождитесь завершения или отмените их.",
  PROJECT_NOT_FOUND: "Выбранный проект недоступен.",
  UNAUTHORIZED: "Вход истёк. Войдите снова."
};
export async function readGithubIssues<T>(
  project: string,
  suffix: string,
  repository: string,
  signal: AbortSignal
): Promise<T> {
  const response = await fetch(
    `/api/v1/projects/${encodeURIComponent(project)}/github-issues${suffix}`,
    {
      method: "GET",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)])
    }
  ).catch(() => {
    throw new Error(
      signal.aborted ? "Чтение отменено." : "Нет ответа API. Повторите чтение вручную."
    );
  });
  const value = (await response.json()) as {
    repository?: string;
    error?: { code?: string };
  } | null;
  if (!response.ok)
    throw new Error(issueMessages[value?.error?.code ?? ""] ?? "Не удалось прочитать Issues.");
  if (!value || value.repository !== repository)
    throw new Error("Репозиторий изменился. Обновите подключение перед чтением Issues.");
  return value as T;
}
/** Bounds include JSON framing and metadata, matching the server's 8,000-character Code input. */
export const issueInputSize = (task: string, context: IssueContext | null) =>
  task.length + (context ? JSON.stringify(context).length : 0);
export function prepareIssueContext(
  repository: string,
  issue: IssueDetail
): { task: string; context: IssueContext } {
  const task =
    "Исправь проблему из выбранного GitHub issue. Проверь воспроизведение и предложи минимальное исправление.";
  let body = issue.body.slice(0, 6500);
  if (/[\uD800-\uDBFF]/u.test(body.at(-1) ?? "")) body = body.slice(0, -1);
  const context: IssueContext = {
    repository,
    number: issue.number,
    title: issue.title,
    body,
    source_body_chars: issue.body_total_chars,
    source_updated_at: issue.updated_at,
    truncated: issue.body_truncated || body.length < issue.body_total_chars,
    truncation_approved: false
  };
  // Count JSON escapes too; a bounded binary search avoids quadratic serialization of hostile text.
  if (issueInputSize(task, context) > 8000) {
    const original = context.body;
    context.truncated = true;
    let low = 0,
      high = original.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      context.body = original.slice(0, middle);
      if (issueInputSize(task, context) <= 8000) low = middle;
      else high = middle - 1;
    }
    context.body = original.slice(0, low);
    if (/[\uD800-\uDBFF]/u.test(context.body.at(-1) ?? ""))
      context.body = context.body.slice(0, -1);
  }
  return { task, context };
}
