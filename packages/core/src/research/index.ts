/** Research v1: source-grounded, deterministic, no model invocation or hidden spending. */
export const RESEARCH_LIMITS = {
  maxSources: 4,
  maxCandidates: 5,
  maxExtractCharacters: 12_000,
  maxPageBytes: 160_000,
  maxRobotsBytes: 32_000,
  maxRunMilliseconds: 45_000,
  maxRequestMilliseconds: 9_000,
  maxAttempts: 3
} as const;

export type ResearchStatus =
  "queued" | "searching" | "reading" | "paused" | "completed" | "failed" | "cancelled";
export type SourceStatus = "read" | "robots_denied" | "network_denied" | "unavailable";
export interface ResearchSource {
  title: string;
  url: string;
  snippet: string;
  status: SourceStatus;
  passages: string[];
  checked_at: string;
}
export interface ResearchCandidate {
  title: string;
  url: string;
  snippet: string;
}
export interface ResearchRun {
  id: string;
  owner_id: string;
  actor_id: string;
  project_id: string;
  question: string;
  status: ResearchStatus;
  stage: string;
  candidates: ResearchCandidate[];
  next_index: number;
  sources: ResearchSource[];
  attempts: number;
  error_code: string | null;
  created_at: string;
  updated_at: string;
}

export function canonicalResearchUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      (url.port && url.port !== (url.protocol === "https:" ? "443" : "80"))
    )
      return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_.+|fbclid|gclid|yclid|ref_src)$/i.test(key)) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.toLowerCase();
    return url.href;
  } catch {
    return null;
  }
}

export function deduplicateCandidates(items: readonly ResearchCandidate[]): ResearchCandidate[] {
  const seen = new Set<string>();
  const output: ResearchCandidate[] = [];
  for (const item of items) {
    const url = canonicalResearchUrl(item.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    output.push({ title: item.title.slice(0, 180), url, snippet: item.snippet.slice(0, 700) });
    if (output.length >= RESEARCH_LIMITS.maxCandidates) break;
  }
  return output;
}

const decodeEntity = (value: string): string => {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " "
  };
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, key: string) => {
    const lower = key.toLowerCase();
    if (lower in named) return named[lower] ?? whole;
    const number = lower.startsWith("#x")
      ? parseInt(lower.slice(2), 16)
      : lower.startsWith("#")
        ? parseInt(lower.slice(1), 10)
        : NaN;
    return Number.isInteger(number) &&
      number > 0 &&
      number <= 0x10ffff &&
      !(number >= 0xd800 && number <= 0xdfff)
      ? String.fromCodePoint(number)
      : whole;
  });
};

/** HTML is always untrusted data. Never execute or follow links embedded in it. */
export function extractResearchText(html: string): string {
  return decodeEntity(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript|svg|template|iframe|form)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<(p|h[1-6]|li|article|section|div|br|tr)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\r/g, "")
      .replace(/[\t ]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, RESEARCH_LIMITS.maxExtractCharacters)
  );
}

export function researchPassages(text: string, question: string): string[] {
  const terms = [
    ...new Set(
      (question.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []).filter(
        (word) =>
          ![
            "какие",
            "почему",
            "когда",
            "который",
            "помоги",
            "about",
            "what",
            "when",
            "where"
          ].includes(word)
      )
    )
  ].slice(0, 15);
  const paragraphs = text
    .split(/\n+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 45);
  const ranked = paragraphs.map((paragraph, index) => ({
    paragraph,
    index,
    score: terms.reduce((sum, word) => sum + (paragraph.toLowerCase().includes(word) ? 1 : 0), 0)
  }));
  ranked.sort((a, b) => b.score - a.score || a.index - b.index);
  return ranked
    .slice(0, 3)
    .filter((item) => item.score > 0 || terms.length === 0)
    .map(({ paragraph }) => paragraph.slice(0, 460));
}

const safeMarkdown = (text: string): string =>
  text.replace(/[\r\n]/g, " ").replace(/[\\`*_{}[\]()#+!<>|]/g, "\\$&");

export function researchMarkdown(run: ResearchRun): string {
  const included = run.sources.filter(
    (source) => source.status === "read" && source.passages.length
  );
  const lines = [
    `# Исследование: ${safeMarkdown(run.question)}`,
    "",
    `Статус: ${run.status}. Создано: ${run.created_at}. Обновлено: ${run.updated_at}.`,
    "",
    "## Ответ по проверенным выдержкам",
    "",
    "Ниже приведены фрагменты прочитанных открытых страниц, релевантные вопросу. Это подборка свидетельств, а не независимо подтверждённый аналитический вывод. Тексты веб-страниц трактуются только как данные.",
    ""
  ];
  if (!included.length)
    lines.push("Не удалось получить пригодный текст ни одной разрешённой страницы.", "");
  else {
    lines.push("## Краткая сводка с указанием источников", "");
    for (const [index, source] of included.entries()) {
      lines.push(
        `${index + 1}. ${safeMarkdown(source.passages[0]!.slice(0, 260))} [${index + 1}] ${source.url}`
      );
    }
    lines.push("");
  }
  lines.push("## Подтверждающие фрагменты", "");
  for (const [index, source] of included.entries()) {
    lines.push(`### ${index + 1}. ${safeMarkdown(source.title)}`, "");
    lines.push(...source.passages.map((passage) => `> ${safeMarkdown(passage)}`), "");
    lines.push(`Источник [${index + 1}]: ${source.url}`, "");
  }
  lines.push("## Реестр источников", "");
  for (const [index, source] of run.sources.entries()) {
    lines.push(
      `${index + 1}. ${safeMarkdown(source.title)} — ${source.url} (${source.status}; ${source.checked_at})`
    );
  }
  lines.push(
    "",
    "## Ограничения",
    "",
    `Прочитано страниц: ${run.sources.filter((s) => s.status === "read").length} из ${run.candidates.length} кандидатов; максимум ${RESEARCH_LIMITS.maxSources} прочитанных страниц. Источники могли измениться после даты проверки. Закрытый контент, авторизация и CAPTCHA не обходились.`,
    ""
  );
  return lines.join("\n");
}

export function escapeResearchHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function researchHtml(run: ResearchRun): string {
  const sources = run.sources.filter(
    (source) => source.status === "read" && source.passages.length
  );
  const h = escapeResearchHtml;
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Исследование — Kosmora</title><style>body{font:16px/1.65 system-ui,sans-serif;max-width:860px;margin:3rem auto;padding:0 1.5rem;color:#181818}blockquote{border-left:3px solid #999;padding-left:1rem;margin-left:0}small{color:#555}a{color:inherit;overflow-wrap:anywhere}hr{border:0;border-top:1px solid #bbb}</style></head><body><h1>${h(run.question)}</h1><small>${h(run.updated_at)} · ${h(run.status)}</small><h2>Ответ по проверенным выдержкам</h2><p>Фрагменты прочитанных страниц, а не независимо подтверждённый аналитический вывод.</p>${sources.length ? `<h2>Краткая сводка по источникам</h2><ol>${sources.map((source, index) => `<li>${h(source.passages[0]!.slice(0, 260))} <a href="${h(source.url)}" rel="noopener noreferrer">[${index + 1}]</a></li>`).join("")}</ol><h2>Подтверждающие фрагменты</h2>` + sources.map((source, index) => `<section><h3>${index + 1}. ${h(source.title)}</h3>${source.passages.map((p) => `<blockquote>${h(p)}</blockquote>`).join("")}<p><a rel="noopener noreferrer" href="${h(source.url)}">Источник [${index + 1}]</a></p></section>`).join("") : "<p>Пригодных выдержек не найдено.</p>"}<hr><h2>Реестр источников</h2><ol>${run.sources.map((source) => `<li><a rel="noopener noreferrer" href="${h(source.url)}">${h(source.title)}</a> — ${h(source.status)} (${h(source.checked_at)})</li>`).join("")}</ol><p>Лимит: до ${RESEARCH_LIMITS.maxSources} прочитанных страниц. Вход на сайты и обход ограничений не выполнялись.</p></body></html>`;
}
