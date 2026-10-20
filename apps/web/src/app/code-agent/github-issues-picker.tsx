"use client";
import { useEffect, useRef, useState } from "react";
import styles from "./code-agent.module.css";
import {
  prepareIssueContext,
  readGithubIssues,
  type IssueContext,
  type IssueDetail,
  type IssuePage,
  type IssueState
} from "./github-issues-client";

export function GithubIssuesPicker(props: {
  project: string;
  repository: string;
  disabled: boolean;
  onPrepare: (draft: { task: string; context: IssueContext }) => void;
}) {
  const [query, setQuery] = useState(""),
    [state, setState] = useState<IssueState>("open");
  const [page, setPage] = useState<IssuePage | null>(null),
    [issue, setIssue] = useState<IssueDetail | null>(null);
  const [loading, setLoading] = useState(false),
    [detailBusy, setDetailBusy] = useState(false);
  const [error, setError] = useState<string | null>(null),
    [confirmed, setConfirmed] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  const [activeQuery, setActiveQuery] = useState("");
  const listAbort = useRef<AbortController | null>(null),
    detailAbort = useRef<AbortController | null>(null);
  const listVersion = useRef(0),
    detailVersion = useRef(0);
  const scope = `${props.project}:${props.repository}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  async function load(selectedState: IssueState, text: string, selectedPage: number) {
    listAbort.current?.abort();
    detailAbort.current?.abort();
    detailVersion.current++;
    const controller = new AbortController();
    listAbort.current = controller;
    const version = ++listVersion.current,
      capturedScope = scope;
    setIssue(null);
    setConfirmed(false);
    setOverwrite(false);
    setPage(null);
    setError(null);
    setLoading(true);
    setDetailBusy(false);
    try {
      const query = new URLSearchParams({
        state: selectedState,
        page: String(selectedPage),
        ...(text ? { query: text } : {})
      });
      const value = await readGithubIssues<IssuePage>(
        props.project,
        `?${query}`,
        props.repository,
        controller.signal
      );
      if (
        !controller.signal.aborted &&
        listVersion.current === version &&
        currentScope.current === capturedScope
      ) {
        setPage(value);
        setActiveQuery(text);
      }
    } catch (e) {
      if (
        !controller.signal.aborted &&
        listVersion.current === version &&
        currentScope.current === capturedScope
      )
        setError(e instanceof Error ? e.message : "Чтение не завершено.");
    } finally {
      if (listVersion.current === version && currentScope.current === capturedScope)
        setLoading(false);
    }
  }
  async function select(number: number) {
    detailAbort.current?.abort();
    const controller = new AbortController();
    detailAbort.current = controller;
    const version = ++detailVersion.current,
      capturedScope = scope;
    setIssue(null);
    setConfirmed(false);
    setOverwrite(false);
    setError(null);
    setDetailBusy(true);
    try {
      const result = await readGithubIssues<{ repository: string; issue: IssueDetail }>(
        props.project,
        `/${number}`,
        props.repository,
        controller.signal
      );
      if (
        !controller.signal.aborted &&
        detailVersion.current === version &&
        currentScope.current === capturedScope
      )
        setIssue(result.issue);
    } catch (e) {
      if (
        !controller.signal.aborted &&
        detailVersion.current === version &&
        currentScope.current === capturedScope
      )
        setError(e instanceof Error ? e.message : "Issue не прочитан.");
    } finally {
      if (detailVersion.current === version && currentScope.current === capturedScope)
        setDetailBusy(false);
    }
  }
  useEffect(() => {
    void load("open", "", 1);
    return () => {
      listVersion.current++;
      detailVersion.current++;
      listAbort.current?.abort();
      detailAbort.current?.abort();
    };
    // The parent keys this component by project + configured repository. Each scope gets a fresh state.
  }, []);
  const draft = issue ? prepareIssueContext(props.repository, issue) : null;
  function cancel() {
    listVersion.current++;
    detailVersion.current++;
    listAbort.current?.abort();
    detailAbort.current?.abort();
    setLoading(false);
    setDetailBusy(false);
    setError("Чтение отменено. Можно повторить запрос.");
  }
  return (
    <details aria-label="GitHub Issues для задачи Code">
      <summary>Выбрать задачу из GitHub Issues</summary>
      <p>
        Репозиторий: <code>{props.repository}</code>. Только чтение; выбор issue не обращается к
        модели.
      </p>
      <label>
        Состояние issue
        <select
          aria-label="Состояние issue"
          value={state}
          disabled={props.disabled}
          onChange={(e) => {
            const next = e.target.value as IssueState;
            setState(next);
            void load(next, query.trim(), 1);
          }}
        >
          <option value="open">Открытые</option>
          <option value="closed">Закрытые</option>
          <option value="all">Все</option>
        </select>
      </label>
      <label>
        Поиск issue
        <input
          value={query}
          maxLength={160}
          disabled={props.disabled}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <button
        disabled={props.disabled || loading}
        onClick={() => void load(state, query.trim(), 1)}
      >
        Найти issues
      </button>
      <button
        disabled={props.disabled || loading}
        onClick={() => void load(state, activeQuery, page?.page ?? 1)}
      >
        Обновить список issues
      </button>
      {(loading || detailBusy) && (
        <>
          <p role="status">Читаем GitHub…</p>
          <button onClick={cancel}>Отменить чтение issues</button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {page && (
        <>
          {!page.items.length && (
            <p role="status">
              Issues не найдены на этой странице. Pull requests в списке исключены.
            </p>
          )}
          <ul aria-label="Список issues">
            {page.items.map((item) => (
              <li key={item.number}>
                <button
                  disabled={props.disabled || detailBusy}
                  onClick={() => void select(item.number)}
                >
                  #{item.number} {item.title}
                </button>{" "}
                <span>{item.state === "open" ? "Открыта" : "Закрыта"}</span>
              </li>
            ))}
          </ul>
          <p>
            Страница {page.page}; не более 20 записей за запрос и 10 страниц. Поиск GitHub может
            обновляться с задержкой.
          </p>
          {page.limited && (
            <p role="status">Выдача ограничена. Уточните поиск, чтобы найти другие issues.</p>
          )}
          <button
            disabled={props.disabled || loading || page.page <= 1}
            onClick={() => void load(state, activeQuery, page.page - 1)}
          >
            Предыдущая страница issues
          </button>
          <button
            disabled={props.disabled || loading || page.next_page === null}
            onClick={() => page.next_page && void load(state, activeQuery, page.next_page)}
          >
            Следующая страница issues
          </button>
        </>
      )}
      {issue && draft && (
        <article aria-label="Выбранный GitHub issue">
          <h3>
            #{issue.number} {issue.title}
          </h3>
          <p>
            {issue.state === "open" ? "Открыта" : "Закрыта"}; обновлено: {issue.updated_at}
          </p>
          <a
            href={`https://github.com/${props.repository}/issues/${issue.number}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Открыть issue в GitHub
          </a>
          <p>
            Описание показано буквально. Ссылки, изображения и инструкции из него не исполняются.
          </p>
          <pre>{issue.body || "Описание отсутствует."}</pre>
          {issue.body_truncated && (
            <p role="alert">
              Просмотр обрезан: показано {issue.body.length} из {issue.body_total_chars} символов.
              Полный текст доступен в GitHub.
            </p>
          )}
          {draft.context.truncated && (
            <>
              <p role="status">
                В Code будет перенесён фрагмент: {draft.context.body.length} из{" "}
                {issue.body_total_chars} символов описания.
              </p>
              <label className={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                Подтверждаю перенос указанного фрагмента вместо полного описания
              </label>
            </>
          )}
          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={overwrite}
              onChange={(e) => setOverwrite(e.target.checked)}
            />
            Разрешаю заменить текущий черновик задачи и контекста выбранным issue
          </label>
          <button
            disabled={props.disabled || !overwrite || (draft.context.truncated && !confirmed)}
            onClick={() =>
              props.onPrepare({
                ...draft,
                context: { ...draft.context, truncation_approved: confirmed }
              })
            }
          >
            Подготовить задачу Code
          </button>
        </article>
      )}
    </details>
  );
}
