"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import styles from "./research-workspace.module.css";

type Project = { id: string; title: string };
type Source = { title: string; url: string; snippet: string; status: "read" | "robots_denied" | "network_denied" | "unavailable"; passages: string[]; checked_at: string };
type Citation = { source_id: string; excerpt_id: string };
type Claim = { text: string; citations: Citation[] };
type Answer = { summary: Claim[]; disagreements: Claim[]; gaps: string[] };
type Run = {
  id: string; project_id: string; question: string;
  status: "queued" | "searching" | "reading" | "synthesizing" | "paused" | "completed" | "failed" | "cancelled";
  stage: string; next_index: number; candidates: Array<{ url: string }>;
  sources: Source[]; attempts: number; error_code: string | null;
  model_requested?: boolean; answer?: Answer | null;
  model?: { phase: string; usage_state: string; revision: number };
  created_at: string; updated_at: string;
};
type ResearchStatus = { available: boolean; limits: { maxSources: number; maxRunMilliseconds: number }; model_usage: "accounted_gateway" | "unavailable" };

const statuses: Record<Run["status"], string> = {
  queued: "В очереди", searching: "Поиск", reading: "Чтение страниц", synthesizing: "Синтез модели", paused: "Приостановлено",
  completed: "Готово", failed: "Не удалось завершить", cancelled: "Отменено"
};
const sourceStatuses: Record<Source["status"], string> = {
  read: "Прочитан", robots_denied: "Запрещено robots.txt", network_denied: "Заблокирован сетевой границей", unavailable: "Недоступен"
};

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, cache: "no-store" });
  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as { error?: { code?: string; message?: string } };
    if (response.status === 403) throw new Error("Политика проекта запрещает веб-доступ. Проверьте уровень автономности (A1 или выше).");
    if (response.status === 423) throw new Error("Исследование остановлено настройками безопасности.");
    if (response.status === 429) throw new Error("Достигнут лимит исследований или одновременно работающих заданий.");
    throw new Error(error.error?.message ?? "Запрос не выполнен. Проверьте подключение и повторите.");
  }
  return await response.json() as T;
}

export default function ResearchWorkspace() {
  const [availability, setAvailability] = useState<ResearchStatus | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [question, setQuestion] = useState("");
  const [synthesize, setSynthesize] = useState(false);
  const [runs, setRuns] = useState<Run[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const current = runs.find((run) => run.id === selected) ?? null;
  const sync = useCallback(async () => {
    try {
      const list = await api<{ items: Run[] }>("/api/v1/research");
      setRuns(list.items);
      setNotice(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Нет связи с API");
    }
  }, []);
  useEffect(() => {
    void Promise.all([
      api<ResearchStatus>("/api/v1/research/status"),
      api<{ items: Project[] }>("/api/v1/projects"),
      api<{ items: Run[] }>("/api/v1/research")
    ]).then(([status, projectList, researchList]) => {
      setAvailability(status);
      setProjects(projectList.items);
      setProjectId((old) => old || projectList.items[0]?.id || "");
      setRuns(researchList.items);
      setSelected((old) => old || researchList.items[0]?.id || null);
    }).catch(() => setNotice("Не удалось загрузить исследования. Проверьте вход и доступность сервера."));
  }, []);
  useEffect(() => {
    if (!current || !["queued", "searching", "reading", "synthesizing"].includes(current.status)) return;
    const interval = window.setInterval(() => { void sync(); }, 1500);
    return () => window.clearInterval(interval);
  }, [current?.id, current?.status, sync]);
  const invoke = async (action: "pause" | "resume" | "cancel" | "synthesize" | "retry") => {
    if (!current || busy) return;
    setBusy(true);
    setNotice(null);
    try { await api(`/api/v1/research/${current.id}/${action}`, { method: "POST" }); await sync(); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Не удалось выполнить действие"); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!current || busy) return;
    if (!["completed", "failed", "cancelled", "paused"].includes(current.status)) return;
    setBusy(true); setNotice(null);
    try {
      await api(`/api/v1/research/${current.id}`, { method: "DELETE" });
      setSelected(null);
      await sync();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Не удалось удалить отчёт"); }
    finally { setBusy(false); }
  };
  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !projectId || question.trim().length < 8) return;
    setBusy(true); setNotice(null);
    try {
      const run = await api<Run>("/api/v1/research", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ project_id: projectId, question: question.trim(), synthesize })
      });
      setSelected(run.id); setQuestion(""); setSynthesize(false); await sync();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Не удалось запустить исследование"); }
    finally { setBusy(false); }
  };
  const citationUrl = (citation: Citation) => {
    const index = Number(citation.source_id.slice(1)) - 1;
    const excerpt = Number(citation.excerpt_id.slice(1)) - 1;
    const source = current?.sources[index];
    return source?.status === "read" && source.passages[excerpt] ? source.url : null;
  };
  const claims = (items: Claim[]) => <ul className={styles.summary}>{items.map((claim, index) =>
    <li key={index}>{claim.text} {claim.citations.map((cite, position) => {
      const url = citationUrl(cite);
      return url ? <a key={position} href={url} target="_blank" rel="noopener noreferrer">[{cite.source_id}:{cite.excerpt_id}] ↗</a> :
        <span key={position}>[недействительный источник]</span>;
    })}</li>)}</ul>;
  const sourceCount = current?.sources.filter((source) => source.status === "read").length ?? 0;
  return (
    <main className={styles.root}>
      <header className={styles.header}>
        <Link href="/" className={styles.back}>← Назад в Kosmora</Link>
        <p className={styles.label}>RESEARCH WORKSPACE / 23–24</p>
        <h1>Глубокий поиск</h1>
        <p>Ограниченный поиск, проверяемые выдержки и модельный анализ с цитатами. Запуск платного синтеза — только по вашему выбору с учётом бюджета проекта.</p>
      </header>
      <div className={styles.columns}>
        <aside className={styles.sidebar}>
          <form onSubmit={(event) => void create(event)} className={styles.form}>
            <h2>Новое исследование</h2>
            <label>Проект
              <select value={projectId} onChange={(event) => setProjectId(event.target.value)} required>
                {projects.map((project) => <option value={project.id} key={project.id}>{project.title}</option>)}
              </select>
            </label>
            <label>Вопрос
              <textarea value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={240} minLength={8} rows={5} placeholder="Как менялась технология…?" required />
            </label>
            <label className={styles.modelOption}><input type="checkbox" checked={synthesize}
              disabled={availability?.model_usage !== "accounted_gateway"}
              onChange={(event) => setSynthesize(event.target.checked)} /> Синтезировать ответ моделью (учитываются расходы)</label>
            <button type="submit" disabled={busy || !availability?.available || !projectId || question.trim().length < 8} className={styles.primary}>Исследовать</button>
            {availability && !availability.available && <p role="alert">SearxNG сейчас не подключён. Новые исследования недоступны, сохранённые отчёты можно читать.</p>}
            {availability?.model_usage !== "accounted_gateway" && <p className={styles.muted}>Модельный синтез недоступен без общего учёта расходов. Выдержки можно получать бесплатно.</p>}
            {!projects.length && <p>Создайте проект в главном чате, чтобы использовать его настройки веб-доступа.</p>}
            <small>До {availability?.limits.maxSources ?? 4} прочитанных страниц; до {(availability?.limits.maxRunMilliseconds ?? 45000) / 1000} секунд за попытку. Для проекта требуется разрешение на веб-чтение.</small>
          </form>
          <div className={styles.history}>
            <div className={styles.line}><h2>История</h2><button type="button" onClick={() => void sync()}>Обновить</button></div>
            {runs.length === 0 && <p>Пока исследований нет.</p>}
            {runs.map((run) => <button type="button" key={run.id} className={run.id === selected ? styles.active : styles.historyItem} onClick={() => setSelected(run.id)}>
              <strong>{run.question}</strong><small>{statuses[run.status]} · {new Date(run.updated_at).toLocaleString("ru")}</small>
            </button>)}
          </div>
        </aside>
        <section className={styles.result} aria-live="polite">
          {notice && <p className={styles.notice} role="alert">{notice}</p>}
          {!current && <div className={styles.blank}><h2>Исследования и отчёты</h2><p>Введите вопрос слева. Читатель проверит найденные страницы и подготовит цитируемые выдержки.</p></div>}
          {current && <>
            <p className={styles.label}>ИССЛЕДОВАНИЕ · {statuses[current.status]}</p>
            <h2>{current.question}</h2>
            <p>{current.stage}</p>
            <div className={styles.meter} role="progressbar" aria-label="Прочитанные кандидаты" aria-valuemin={0} aria-valuemax={Math.max(current.candidates.length, 1)} aria-valuenow={current.next_index}><span style={{ width: `${current.candidates.length ? 100 * current.next_index / current.candidates.length : 0}%` }} /></div>
            <small>{current.next_index} из {current.candidates.length} адресов проверено · {sourceCount} страниц прочитано · попытка {current.attempts} из 3</small>
            <div className={styles.actions}>
              {["queued", "searching", "reading", "synthesizing"].includes(current.status) && <button disabled={busy} onClick={() => void invoke("pause")}>Пауза</button>}
              {current.status === "paused" && <button disabled={busy || current.attempts >= 3 || ["uncertain", "dispatching"].includes(current.model?.phase ?? "pending")} onClick={() => void invoke("resume")}>Продолжить</button>}
              {["queued", "searching", "reading", "synthesizing", "paused"].includes(current.status) && <button disabled={busy} onClick={() => void invoke("cancel")}>Отменить</button>}
              {current.status === "completed" && !current.answer && sourceCount > 0 && availability?.model_usage === "accounted_gateway" && <button disabled={busy} onClick={() => void invoke("synthesize")}>Синтезировать моделью (расходы)</button>}
              {current.status === "failed" && current.model?.phase === "failed" && current.model.usage_state !== "uncertain" && <button disabled={busy} onClick={() => void invoke("retry")}>Повторить модель (новый расход)</button>}
              {["completed", "failed", "cancelled", "paused"].includes(current.status) && <button disabled={busy} onClick={() => void remove()}>Удалить</button>}
              <a download href={`/api/v1/research/${current.id}/export/md`}>Markdown ↓</a>
              <a download href={`/api/v1/research/${current.id}/export/html`}>HTML ↓</a>
            </div>
            {current.error_code && <p className={styles.notice}>Причина: {current.error_code}</p>}
            {current.model && <p className={styles.muted}>Расходы модели: {current.model.usage_state === "committed" ? "подтверждены в ledger" : current.model.usage_state === "uncertain" ? "не определены; резерв удерживается, автоматический повтор запрещён" : current.model.usage_state === "reserved" ? "зарезервированы" : "вызова модели пока не было"}</p>}
            {current.answer && <section>
              <h3>Исследовательский ответ</h3>
              {claims(current.answer.summary)}
              <h3>Расхождения между источниками</h3>
              {current.answer.disagreements.length ? claims(current.answer.disagreements) : <p>По доступным выдержкам существенных расхождений не отмечено.</p>}
              <h3>Недостаточно данных</h3>
              {current.answer.gaps.length ? <ul>{current.answer.gaps.map((gap, index) => <li key={index}>{gap}</li>)}</ul> : <p>Модель не выделила пробелы; полнота не гарантируется.</p>}
            </section>}
            <h3>Краткий ответ по источникам</h3>
            <p className={styles.muted}>Извлечённые утверждения с указанием страниц, не независимо проверенная генерация модели.</p>
            {sourceCount === 0 && <p>Релевантные выдержки пока отсутствуют.</p>}
            <ol className={styles.summary}>
              {current.sources.filter((source) => source.status === "read").map((source) => <li key={source.url}>
                {source.passages[0]?.slice(0, 260)} <a href={source.url} rel="noopener noreferrer" target="_blank">[источник] ↗</a>
              </li>)}
            </ol>
            <h3>Подтверждающие фрагменты</h3>
            <p className={styles.muted}>Веб-контент рассматривается только как данные, не как инструкции.</p>
            <ol className={styles.evidence}>
              {current.sources.map((source, sourceIndex) => source.status === "read" ? <li key={source.url}>
                <h4>{source.title} · S{sourceIndex + 1}</h4>
                {source.passages.map((passage, index) => <blockquote key={index}><small>S{sourceIndex + 1}:E{index + 1}</small> {passage}</blockquote>)}
                <a href={source.url} rel="noopener noreferrer" target="_blank">Открыть первоисточник ↗</a>
              </li> : null)}
            </ol>
            <h3>Реестр источников</h3>
            <ul className={styles.sources}>
              {current.sources.map((source, index) => <li key={source.url}><strong>S{index + 1}</strong><a href={source.url} rel="noopener noreferrer" target="_blank">{source.title}</a><small>{sourceStatuses[source.status]} · {new Date(source.checked_at).toLocaleString("ru")}</small></li>)}
            </ul>
            <p className={styles.muted}>Ссылки позволяют проверить сведения. Доступные только после входа страницы и CAPTCHA не обходятся. Не все публичные сайты разрешают автоматическое чтение.</p>
          </>}
        </section>
      </div>
    </main>
  );
}
