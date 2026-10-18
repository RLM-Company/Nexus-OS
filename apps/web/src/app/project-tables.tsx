"use client";

import { useEffect, useRef, useState } from "react";
import type { CanvasArtifact, CanvasRevision } from "@cosmora/contracts/canvas-artifacts";
import { DATA_SERVER_BYTES, parseDataWorkspace } from "@cosmora/contracts/data-workspace";
import { CanvasEditor } from "./canvas-editor/canvas-editor";
import styles from "./studio-data-workbench.module.css";
import { SystemMessage } from "./ui/kosmora-controls";
import { compareDataWorkspaces, type DataComparison } from "./studio-data-comparison";
import { StudioDataComparison } from "./studio-data-comparison-view";

type Full = { artifact: CanvasArtifact; revision: CanvasRevision };
type Revision = Omit<CanvasRevision, "content">;
type Props = {
  projectId: string | null;
  hasTable: boolean;
  blocked: boolean;
  sourceEpoch: number;
  snapshot: () => Promise<string>;
  report: () => string;
  onLoad: (content: string) => void;
  onBusy: (busy: boolean) => void;
  onProjectAvailable?: () => void;
};
async function call<T>(
  url: string,
  signal: AbortSignal,
  method = "GET",
  body?: unknown
): Promise<T> {
  const response = await fetch(url, {
    signal,
    method,
    cache: "no-store",
    credentials: "same-origin",
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { "content-type": "application/json" } })
  });
  if (!response.ok) {
    const result = (await response.json().catch(() => null)) as {
      error?: { code?: string; currentVersion?: number };
    } | null;
    throw Object.assign(new Error(result?.error?.code ?? `HTTP ${response.status}`), {
      status: response.status,
      currentVersion: result?.error?.currentVersion
    });
  }
  const result = (await response.json()) as T;
  signal.throwIfAborted();
  return result;
}
const errorText = (error: unknown) => {
  const problem = error as Error & { currentVersion?: number };
  if (problem.currentVersion)
    return `На сервере уже версия ${problem.currentVersion}. Ваши правки остались в таблице. Откройте серверную версию или сохраните копию.`;
  const message = problem.message ?? "Не удалось выполнить действие.";
  if (message.includes("SIZE_LIMIT"))
    return "Для сохранения в проекте таблица должна быть до 2 МиБ. Более крупную сохраните локально в workspace JSON.";
  if (message.includes("REVISION_LIMIT"))
    return "Достигнут предел 20 версий. Сохраните новую копию таблицы.";
  if (message.includes("QUOTA"))
    return "История таблиц проекта достигла 32 МиБ. Удалите ненужную таблицу или используйте другой проект.";
  if (message.includes("REVISION_CORRUPT"))
    return "Контрольная сумма сохранённой версии не совпала. Данные не загружены.";
  return message;
};

export function ProjectTables(props: Props) {
  const [project, setProject] = useState(props.projectId);
  const [items, setItems] = useState<CanvasArtifact[]>([]);
  const [choice, setChoice] = useState("");
  const [loaded, setLoaded] = useState<Full | null>(null);
  const [history, setHistory] = useState<Revision[]>([]);
  const [historyVersion, setHistoryVersion] = useState("");
  const [review, setReview] = useState<{
    artifactId: string;
    before: CanvasRevision;
    after: CanvasRevision;
    localContent: string;
    comparison: DataComparison;
  } | null>(null);
  const [allowLimitedRestore, setAllowLimitedRestore] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reportArtifact, setReportArtifact] = useState<{ project: string; id: string } | null>(
    null
  );
  const controller = useRef<AbortController | null>(null);
  const projectAttempt = useRef<string | null>(null);
  const saveAttempt = useRef<{ id: string; content: string; title: string } | null>(null);
  const reportAttempt = useRef<{ id: string; content: string; project: string } | null>(null);
  const busyCallback = useRef(props.onBusy);
  busyCallback.current = props.onBusy;
  useEffect(() => {
    setLoaded(null);
    setChoice("");
    setHistory([]);
    setHistoryVersion("");
    setReview(null);
    setAllowLimitedRestore(false);
    saveAttempt.current = null;
  }, [props.sourceEpoch]);
  useEffect(() => {
    const abort = new AbortController();
    controller.current = abort;
    return () => {
      abort.abort();
      busyCallback.current(false);
    };
  }, []);
  const request = <T,>(url: string, method = "GET", body?: unknown) => {
    const signal = controller.current?.signal;
    if (!signal || signal.aborted) throw new DOMException("Project changed", "AbortError");
    return call<T>(url, AbortSignal.any([signal, AbortSignal.timeout(15_000)]), method, body);
  };
  const base = (id: string) => `/api/v1/projects/${encodeURIComponent(id)}/tables`;
  async function refresh(id: string) {
    const list = await request<{ items: CanvasArtifact[] }>(base(id));
    setItems(list.items);
  }
  useEffect(() => {
    if (project)
      void refresh(project).catch((e) => {
        if (!controller.current?.signal.aborted) setError(errorText(e));
      });
  }, [project]);
  async function run(action: () => Promise<void>) {
    if (working || props.blocked) return;
    setWorking(true);
    props.onBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      if (!controller.current?.signal.aborted) setError(errorText(e));
    } finally {
      if (!controller.current?.signal.aborted) {
        setWorking(false);
        props.onBusy(false);
      }
    }
  }
  async function ensureProject() {
    if (project) return project;
    const id = projectAttempt.current ?? crypto.randomUUID();
    projectAttempt.current = id;
    try {
      await request("/api/v1/projects/empty", "POST", {
        client_project_id: id,
        title: "Таблицы Studio"
      });
    } catch (error) {
      try {
        await request(`/api/v1/projects/${id}`);
      } catch {
        throw error;
      }
    }
    setProject(id);
    props.onProjectAvailable?.();
    return id;
  }
  async function accept(value: Full, id: string, load = false) {
    setReview(null);
    setAllowLimitedRestore(false);
    setHistoryVersion("");
    setLoaded(value);
    setChoice(value.artifact.id);
    if (load) props.onLoad(value.revision.content);
    // A failed follow-up read must not turn an accepted save into a new write on retry.
    const reads = await Promise.allSettled([
      refresh(id),
      request<{ items: Revision[] }>(`${base(id)}/${value.artifact.id}/revisions`)
    ]);
    if (reads[1].status === "fulfilled") setHistory(reads[1].value.items);
    else setHistory([]);
    if (reads.some((r) => r.status === "rejected"))
      setNotice("Сохранено. Обновите список для просмотра истории.");
  }
  const save = (copy = false) =>
    void run(async () => {
      const content = await props.snapshot();
      if (new TextEncoder().encode(content).byteLength > DATA_SERVER_BYTES)
        throw new Error("DATA_WORKSPACE_SIZE_LIMIT");
      const workspace = parseDataWorkspace(content);
      const title = Array.from(workspace.name || "Таблица")
        .slice(0, 60)
        .join("");
      const id = await ensureProject();
      let value: Full;
      if (loaded && !copy && !saveAttempt.current) {
        try {
          value = await request<Full>(`${base(id)}/${loaded.artifact.id}`, "PUT", {
            title,
            content,
            baseVersion: loaded.artifact.version
          });
        } catch (error) {
          const canonical = await request<Full>(`${base(id)}/${loaded.artifact.id}`).catch(
            () => null
          );
          if (
            canonical?.artifact.version === loaded.artifact.version + 1 &&
            canonical.revision.content === content &&
            canonical.artifact.title === title
          )
            value = canonical;
          else throw error;
        }
      } else {
        if (!saveAttempt.current) saveAttempt.current = { id: crypto.randomUUID(), content, title };
        const attempt = saveAttempt.current;
        if (attempt.content !== content || attempt.title !== title)
          throw new Error(
            "Предыдущая запись не подтверждена. Обновите список и откройте сохранённую таблицу перед новым сохранением."
          );
        try {
          value = await request<Full>(base(id), "POST", { client_id: attempt.id, title, content });
        } catch (error) {
          const canonical = await request<Full>(`${base(id)}/${attempt.id}`).catch(() => null);
          if (canonical?.revision.content === content && canonical.artifact.title === title)
            value = canonical;
          else throw error;
        }
        saveAttempt.current = null;
      }
      await accept(value, id);
      setNotice(`Сохранено в проекте: ${value.artifact.title}, версия ${value.artifact.version}.`);
    });
  const open = () => {
    if (!project || !choice) return;
    if (
      props.hasTable &&
      !window.confirm(
        "Открыть серверную таблицу вместо текущей? Несохранённые правки сохраните в workspace JSON."
      )
    )
      return;
    void run(async () => {
      const value = await request<Full>(`${base(project)}/${choice}`);
      parseDataWorkspace(value.revision.content);
      await accept(value, project, true);
      saveAttempt.current = null;
      setNotice(`Открыта версия ${value.artifact.version}.`);
    });
  };
  const compare = () => {
    if (!project || !loaded || !historyVersion) return;
    void run(async () => {
      setReview(null);
      setAllowLimitedRestore(false);
      const [current, target, localContent] = await Promise.all([
        request<Full>(`${base(project)}/${loaded.artifact.id}`),
        request<CanvasRevision>(
          `${base(project)}/${loaded.artifact.id}/revisions/${Number(historyVersion)}`
        ),
        props.snapshot()
      ]);
      setReview({
        artifactId: loaded.artifact.id,
        before: current.revision,
        after: target,
        localContent,
        comparison: compareDataWorkspaces(
          parseDataWorkspace(current.revision.content),
          parseDataWorkspace(target.content)
        )
      });
    });
  };
  const restore = () => {
    if (
      !project ||
      !loaded ||
      !review ||
      review.artifactId !== loaded.artifact.id ||
      review.after.version !== Number(historyVersion) ||
      review.after.version === review.before.version ||
      (!review.comparison.complete && !allowLimitedRestore)
    )
      return;
    if (
      !window.confirm(
        "Восстановить выбранную версию как новую и открыть её? Текущие несохранённые правки будут заменены."
      )
    )
      return;
    void run(async () => {
      if ((await props.snapshot()) !== review.localContent) {
        setReview(null);
        throw new Error(
          "Локальная таблица изменилась после просмотра. Сравните выбранную версию заново перед восстановлением."
        );
      }
      const path = `${base(project)}/${loaded.artifact.id}`;
      let value: Full;
      try {
        value = await request<Full>(path + "/restore", "POST", {
          baseVersion: review.before.version,
          sourceVersion: review.after.version
        });
      } catch (error) {
        const canonical = await request<Full>(path).catch(() => null);
        if (
          canonical?.artifact.version === review.before.version + 1 &&
          canonical.revision.source.kind === "data_workspace" &&
          canonical.revision.source.restored_from === review.after.version &&
          canonical.revision.content === review.after.content &&
          canonical.revision.title === review.after.title
        )
          value = canonical;
        else {
          setReview(null);
          throw error;
        }
      }
      await accept(value, project, true);
      setHistoryVersion("");
      setNotice(`Восстановлено новой версией ${value.artifact.version}; история сохранена.`);
    });
  };
  const remove = () => {
    if (
      !project ||
      !loaded ||
      !window.confirm(
        "Удалить сохранённую таблицу со всей историей? Локально открытые данные останутся в окне."
      )
    )
      return;
    void run(async () => {
      const response = await fetch(`${base(project)}/${loaded.artifact.id}`, {
        method: "DELETE",
        signal: controller.current!.signal,
        credentials: "same-origin"
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setLoaded(null);
      setChoice("");
      setHistory([]);
      setReview(null);
      await refresh(project);
      setNotice("Серверная таблица удалена. Открытые данные остались локально.");
    });
  };
  const openReport = () =>
    void run(async () => {
      const content = props.report();
      const id = await ensureProject();
      if (
        !reportAttempt.current ||
        reportAttempt.current.content !== content ||
        reportAttempt.current.project !== id
      )
        reportAttempt.current = { id: crypto.randomUUID(), content, project: id };
      const attempt = reportAttempt.current;
      const path = `/api/v1/projects/${encodeURIComponent(id)}/canvas`;
      let value: Full;
      try {
        value = await request<Full>(path, "POST", {
          title: "Отчёт по таблице",
          format: "markdown",
          content,
          client_request_id: attempt.id
        });
      } catch (error) {
        const existing = await request<Full>(`${path}/${attempt.id}`).catch(() => null);
        if (existing?.revision.content === content) value = existing;
        else if (existing) {
          // Reopening a report must preserve edits made inside Canvas. Its
          // immutable first revision proves this request originally created it.
          const first = await request<CanvasRevision>(`${path}/${attempt.id}/revisions/1`).catch(
            () => null
          );
          if (
            first?.content === content &&
            first.title === "Отчёт по таблице" &&
            first.format === "markdown"
          )
            value = existing;
          else throw error;
        } else throw error;
      }
      setReportArtifact({ project: id, id: value.artifact.id });
      setNotice("Отчёт открыт в Canvas как отдельный документ проекта.");
    });
  return (
    <>
      <section className={styles.box} aria-label="Таблицы проекта">
        <h3>Таблицы проекта</h3>
        <p>
          {project
            ? "Сохранённые версии доступны после перезагрузки и с другого устройства."
            : "Откройте файл и сохраните его в проекте «Таблицы Studio»."}
        </p>
        <small className={styles.muted}>
          До 2 МиБ на таблицу · 20 версий · 32 МиБ истории на проект
        </small>
        {error && <SystemMessage>{error}</SystemMessage>}
        {notice && <SystemMessage kind="success">{notice}</SystemMessage>}
        <div className={styles.controls}>
          <label>
            Сохранённые таблицы
            <select
              aria-label="Сохранённые таблицы"
              value={choice}
              disabled={working}
              onChange={(e) => setChoice(e.target.value)}
            >
              <option value="">Выберите таблицу</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title} · v{item.version}
                </option>
              ))}
            </select>
          </label>
          <button type="button" disabled={working || props.blocked || !choice} onClick={open}>
            Открыть таблицу проекта
          </button>
          <button
            type="button"
            disabled={working || props.blocked || !project}
            onClick={() => void run(() => refresh(project!))}
          >
            Обновить таблицы
          </button>
        </div>
        <div className={styles.controls}>
          <button
            type="button"
            disabled={working || props.blocked || !props.hasTable}
            onClick={() => save(false)}
          >
            Сохранить в проекте
          </button>
          <button
            type="button"
            disabled={working || props.blocked || !props.hasTable}
            onClick={() => save(true)}
          >
            Сохранить таблицу как копию
          </button>
          <button
            type="button"
            disabled={working || props.blocked || !props.hasTable}
            onClick={openReport}
          >
            Редактировать отчёт в Canvas
          </button>
        </div>
        {loaded && (
          <>
            <p>
              Открыта: {loaded.artifact.title} · v{loaded.artifact.version}
            </p>
            <div className={styles.controls}>
              <label>
                История таблицы
                <select
                  aria-label="История таблицы"
                  value={historyVersion}
                  disabled={working}
                  onChange={(e) => {
                    setHistoryVersion(e.target.value);
                    setReview(null);
                    setAllowLimitedRestore(false);
                  }}
                >
                  <option value="">Выберите версию</option>
                  {history.map((item) => (
                    <option key={item.version} value={item.version}>
                      v{item.version}
                      {item.version === loaded.artifact.version ? " · текущая" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={working || props.blocked || !historyVersion}
                onClick={compare}
              >
                Сравнить выбранную версию
              </button>
              <a href={`${base(project!)}/${loaded.artifact.id}/download`} download>
                Скачать серверный workspace
              </a>
              <button type="button" disabled={working || props.blocked} onClick={remove}>
                Удалить сохранённую таблицу
              </button>
            </div>
            {review && (
              <>
                <StudioDataComparison
                  before={review.before}
                  after={review.after}
                  comparison={review.comparison}
                />
                <div className={styles.controls}>
                  <a
                    href={`${base(project!)}/${review.artifactId}/revisions/${review.before.version}/download`}
                    download
                  >
                    Скачать серверную v{review.before.version}
                  </a>
                  <a
                    href={`${base(project!)}/${review.artifactId}/revisions/${review.after.version}/download`}
                    download
                  >
                    Скачать выбранную v{review.after.version}
                  </a>
                </div>
                <p>
                  Восстановление создаст новую версию и заменит локально открытую таблицу. Сохраните
                  несохранённые правки отдельной копией перед подтверждением.
                </p>
                {review.after.version === review.before.version && (
                  <p>
                    Выбрана текущая серверная версия. Её можно скачать; восстановление не требуется.
                  </p>
                )}
                {!review.comparison.complete && (
                  <label>
                    <input
                      type="checkbox"
                      checked={allowLimitedRestore}
                      disabled={working || props.blocked}
                      onChange={(e) => setAllowLimitedRestore(e.target.checked)}
                    />
                    Я проверил полные снимки вне приложения и хочу восстановить выбранную версию
                  </label>
                )}
                <button
                  type="button"
                  disabled={
                    working ||
                    props.blocked ||
                    review.after.version === review.before.version ||
                    (!review.comparison.complete && !allowLimitedRestore)
                  }
                  onClick={restore}
                >
                  Восстановить таблицу новой версией
                </button>
              </>
            )}
          </>
        )}
      </section>
      {reportArtifact && (
        <section className={styles.box} aria-label="Отчёт таблицы в Canvas">
          <button type="button" onClick={() => setReportArtifact(null)}>
            Закрыть редактор отчёта
          </button>
          <CanvasEditor projectId={reportArtifact.project} initialArtifactId={reportArtifact.id} />
        </section>
      )}
    </>
  );
}
