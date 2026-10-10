/** Bounded source-grounded research, with optional accounted model synthesis. */
export const RESEARCH_LIMITS = {
  maxSources: 4,
  maxCandidates: 5,
  maxExtractCharacters: 12_000,
  maxPageBytes: 160_000,
  maxRobotsBytes: 32_000,
  maxRunMilliseconds: 45_000,
  maxRequestMilliseconds: 9_000,
  maxAttempts: 3,
  maxSynthesisInputChars: 11_000,
  maxSynthesisOutputChars: 12_000,
  maxSynthesisOutputTokens: 900
} as const;

export type ResearchStatus =
  | "queued"
  | "searching"
  | "reading"
  | "synthesizing"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";
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
export interface ResearchCitation {
  source_id: string;
  excerpt_id: string;
}
export interface ResearchClaim {
  text: string;
  citations: ResearchCitation[];
}
export interface ResearchAnswer {
  summary: ResearchClaim[];
  disagreements: ResearchClaim[];
  gaps: string[];
}
export type ResearchModelPhase = "pending" | "dispatching" | "settled" | "uncertain" | "failed";
export interface ResearchModelState {
  phase: ResearchModelPhase;
  run_id: string | null;
  usage_state: "none" | "reserved" | "committed" | "uncertain";
  error_code: string | null;
  revision: number;
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
  model_requested?: boolean;
  answer?: ResearchAnswer | null;
  model?: ResearchModelState;
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

/** The only source IDs a model is allowed to cite are provided here, not URLs from its output. */
export function researchEvidence(run: ResearchRun) {
  return run.sources.flatMap((source, index) =>
    source.status === "read"
      ? source.passages.map((excerpt, passageIndex) => ({
          source_id: `S${index + 1}`,
          excerpt_id: `E${passageIndex + 1}`,
          title: source.title,
          url: source.url,
          excerpt
        }))
      : []
  );
}

/** Validate the model's *references* against real excerpts; semantic truth still needs human review. */
export function parseResearchAnswer(raw: string, run: ResearchRun): ResearchAnswer {
  if (raw.length > RESEARCH_LIMITS.maxSynthesisOutputChars) throw Error("SYNTHESIS_TOO_LONG");
  let data: unknown;
  try {
    data = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, "").trim());
  } catch {
    throw Error("SYNTHESIS_INVALID_JSON");
  }
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw Error("SYNTHESIS_INVALID_SCHEMA");
  const object = data as Record<string, unknown>;
  if (Object.keys(object).some((key) => !["summary", "disagreements", "gaps"].includes(key)))
    throw Error("SYNTHESIS_INVALID_SCHEMA");
  const evidence = new Set(
    researchEvidence(run).map((item) => `${item.source_id}:${item.excerpt_id}`)
  );
  const validateText = (value: unknown, maxLength: number): value is string =>
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maxLength &&
    !/https?:\/\/|www\.|\[S\d+\]|\bS\d+[:.]E\d+\b/iu.test(value);
  const claims = (value: unknown, max: number, allowEmpty: boolean): ResearchClaim[] => {
    if (!Array.isArray(value) || value.length > max || (!allowEmpty && value.length === 0))
      throw Error("SYNTHESIS_INVALID_SCHEMA");
    return value.map((item: unknown) => {
      if (!item || typeof item !== "object" || Array.isArray(item))
        throw Error("SYNTHESIS_INVALID_SCHEMA");
      const claim = item as Record<string, unknown>;
      if (
        Object.keys(claim).some((key) => !["text", "citations"].includes(key)) ||
        !validateText(claim.text, 1100) ||
        !Array.isArray(claim.citations) ||
        !claim.citations.length ||
        claim.citations.length > 4
      )
        throw Error("SYNTHESIS_INVALID_CITATION");
      const citations = claim.citations.map((item: unknown) => {
        if (!item || typeof item !== "object" || Array.isArray(item))
          throw Error("SYNTHESIS_INVALID_CITATION");
        const cite = item as Record<string, unknown>;
        if (
          Object.keys(cite).some((key) => !["source_id", "excerpt_id"].includes(key)) ||
          typeof cite.source_id !== "string" ||
          typeof cite.excerpt_id !== "string" ||
          !evidence.has(`${cite.source_id}:${cite.excerpt_id}`)
        )
          throw Error("SYNTHESIS_INVALID_CITATION");
        return { source_id: cite.source_id, excerpt_id: cite.excerpt_id };
      });
      return { text: claim.text, citations };
    });
  };
  const summary = claims(object.summary, 8, false);
  const disagreements = claims(object.disagreements, 5, true);
  if (
    !Array.isArray(object.gaps) ||
    object.gaps.length > 8 ||
    !object.gaps.every((text) => validateText(text, 500))
  )
    throw Error("SYNTHESIS_INVALID_SCHEMA");
  return { summary, disagreements, gaps: object.gaps };
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
  if (run.answer) {
    const linked = (claim: ResearchClaim) =>
      `${safeMarkdown(claim.text)} ${claim.citations
        .map((cite) => {
          const evidence = researchEvidence(run).find(
            (item) => item.source_id === cite.source_id && item.excerpt_id === cite.excerpt_id
          );
          return evidence
            ? `[${cite.source_id}:${cite.excerpt_id}](${evidence.url})`
            : "[недействительная ссылка]";
        })
        .join(" ")}`;
    lines.splice(
      lines.indexOf("## Ответ по проверенным выдержкам"),
      3,
      "## Синтез модели по прочитанным источникам",
      "",
      ...run.answer.summary.map((claim) => `- ${linked(claim)}`),
      "",
      "## Расхождения",
      "",
      ...(run.answer.disagreements.length
        ? run.answer.disagreements.map((claim) => `- ${linked(claim)}`)
        : [
            "Существенных расхождений в доступных фрагментах не обнаружено (не означает их отсутствия)."
          ]),
      "",
      "## Недостаточно данных",
      "",
      ...(run.answer.gaps.length
        ? run.answer.gaps.map((gap) => `- ${safeMarkdown(gap)}`)
        : ["Модель не перечислила пробелы; полнота исследования не гарантируется."]),
      ""
    );
  }
  if (!included.length)
    lines.push("Не удалось получить пригодный текст ни одной разрешённой страницы.", "");
  else {
    lines.push("## Краткая сводка с указанием источников", "");
    for (const source of included) {
      const id = `S${run.sources.indexOf(source) + 1}`;
      lines.push(
        `${id}. ${safeMarkdown(source.passages[0]!.slice(0, 260))} [${id}:E1](${source.url})`
      );
    }
    lines.push("");
  }
  lines.push("## Подтверждающие фрагменты", "");
  for (const source of included) {
    const id = `S${run.sources.indexOf(source) + 1}`;
    lines.push(`### ${id}. ${safeMarkdown(source.title)}`, "");
    lines.push(...source.passages.map((passage) => `> ${safeMarkdown(passage)}`), "");
    lines.push(`Источник ${id}: ${source.url}`, "");
  }
  lines.push("## Реестр источников", "");
  for (const [index, source] of run.sources.entries()) {
    lines.push(
      `S${index + 1}. ${safeMarkdown(source.title)} — ${source.url} (${source.status}; ${source.checked_at})`
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
  const claimHtml = (claim: ResearchClaim) =>
    `<li>${h(claim.text)} ${claim.citations
      .map((cite) => {
        const excerpt = researchEvidence(run).find(
          (item) => item.source_id === cite.source_id && item.excerpt_id === cite.excerpt_id
        );
        return excerpt
          ? `<a href="${h(excerpt.url)}" rel="noopener noreferrer">[${h(cite.source_id)}:${h(cite.excerpt_id)}]</a>`
          : "";
      })
      .join(" ")}</li>`;
  const answerHtml = run.answer
    ? `<h2>Синтез модели по прочитанным источникам</h2><ul>${run.answer.summary.map(claimHtml).join("")}</ul><h2>Расхождения</h2>${run.answer.disagreements.length ? `<ul>${run.answer.disagreements.map(claimHtml).join("")}</ul>` : "<p>Не выявлены в полученных выдержках.</p>"}<h2>Недостаточно данных</h2><ul>${run.answer.gaps.map((gap) => `<li>${h(gap)}</li>`).join("")}</ul>`
    : "";
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Исследование — Kosmora</title><style>body{font:16px/1.65 system-ui,sans-serif;max-width:860px;margin:3rem auto;padding:0 1.5rem;color:#181818}blockquote{border-left:3px solid #999;padding-left:1rem;margin-left:0}small{color:#555}a{color:inherit;overflow-wrap:anywhere}hr{border:0;border-top:1px solid #bbb}</style></head><body><h1>${h(run.question)}</h1><small>${h(run.updated_at)} · ${h(run.status)}</small>${answerHtml}<h2>Ответ по проверенным выдержкам</h2><p>Фрагменты прочитанных страниц. Модельный синтез не является независимой проверкой фактов.</p>${sources.length ? `<h2>Краткая сводка по источникам</h2><ol>${sources.map((source) => `<li>${h(source.passages[0]!.slice(0, 260))} <a href="${h(source.url)}" rel="noopener noreferrer">[S${run.sources.indexOf(source) + 1}:E1]</a></li>`).join("")}</ol><h2>Подтверждающие фрагменты</h2>` + sources.map((source) => `<section><h3>S${run.sources.indexOf(source) + 1}. ${h(source.title)}</h3>${source.passages.map((p) => `<blockquote>${h(p)}</blockquote>`).join("")}<p><a rel="noopener noreferrer" href="${h(source.url)}">Источник S${run.sources.indexOf(source) + 1}</a></p></section>`).join("") : "<p>Пригодных выдержек не найдено.</p>"}<hr><h2>Реестр источников</h2><ol>${run.sources.map((source, index) => `<li>S${index + 1}: <a rel="noopener noreferrer" href="${h(source.url)}">${h(source.title)}</a> — ${h(source.status)} (${h(source.checked_at)})</li>`).join("")}</ol><p>Лимит: до ${RESEARCH_LIMITS.maxSources} прочитанных страниц. Вход на сайты и обход ограничений не выполнялись.</p></body></html>`;
}
