"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { ManagerWork, ProjectSummary, WorkArtifactVersion } from "@cosmora/contracts";
import type {
  PresentationWorkPreview,
  PresentationWorkReference
} from "@cosmora/contracts/presentation-package";
import { useExecutionGate, executionGateLabels } from "../use-execution-gate";
import { api, json } from "./client";
import { SlidePreview } from "./slide-preview";
import styles from "./presentations.module.css";

const terminal = (work: ManagerWork) => ["completed", "failed", "cancelled"].includes(work.status);
const labels: Record<string, string> = {
  queued: "В очереди",
  running: "Выполняется",
  paused: "На паузе",
  awaiting_approval: "Нужно подтверждение плана",
  blocked: "Нужно разрешение",
  completed: "Готово",
  failed: "Ошибка",
  cancelled: "Отменено"
};

export function PresentationWork({
  busy: editorBusy,
  onImport
}: {
  busy: boolean;
  onImport: (source: PresentationWorkReference) => Promise<boolean>;
}) {
  const [modelMode, setModelMode] = useState("");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectId, setProjectId] = useState("");
  const [topic, setTopic] = useState("");
  const [slideCount, setSlideCount] = useState(5);
  const [consent, setConsent] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [works, setWorks] = useState<ManagerWork[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [files, setFiles] = useState<WorkArtifactVersion[]>([]);
  const [preview, setPreview] = useState<PresentationWorkPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const epoch = useRef(0);
  const locked = useRef(false);
  const pending = useRef<{ signature: string; id: string } | null>(null);
  const gate = useExecutionGate(projectId || undefined);
  const base = `/api/v1/projects/${encodeURIComponent(projectId)}/work`;
  const selected = works.find((work) => work.id === selectedId);

  useEffect(() => {
    const controller = new AbortController();
    void api<{ items: ProjectSummary[] }>("/api/v1/projects", {
      signal: controller.signal
    })
      .then((result) => {
        if (!controller.signal.aborted) setProjects(result.items);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("Не удалось загрузить проекты.");
      });
    void api<{ mode: string }>("/api/v1/model-runtime", { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setModelMode(result.mode);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!projectId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      const readEpoch = epoch.current;
      try {
        const result = await api<{ items: ManagerWork[] }>(base, { signal: controller.signal });
        if (!controller.signal.aborted && readEpoch === epoch.current && !locked.current) {
          setWorks(result.items);
          setLoaded(true);
        }
      } catch {
        if (!controller.signal.aborted)
          setError(
            "Состояние Work временно недоступно. Перед новым запуском проверьте список задач."
          );
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => void refresh(), 1500);
      }
    };
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [base, projectId]);

  useEffect(() => {
    setFiles([]);
    setPreview(null);
    setReviewed(false);
    if (!selected || selected.status !== "completed") return;
    const controller = new AbortController();
    void api<{ artifacts: WorkArtifactVersion[] }>(
      `${base}/${encodeURIComponent(selected.id)}/runtime`,
      { signal: controller.signal }
    )
      .then((result) => {
        if (!controller.signal.aborted)
          setFiles(
            result.artifacts.filter((file) => file.published && file.name.endsWith(".json"))
          );
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("Не удалось прочитать сохранённые файлы Work.");
      });
    return () => controller.abort();
  }, [base, selected?.id, selected?.status]);

  useEffect(
    () => () => {
      epoch.current++;
    },
    []
  );
  const action = async (run: () => Promise<void>) => {
    if (locked.current || editorBusy) return;
    epoch.current++;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      await run();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Действие не завершено. Проверьте сохранённое состояние."
      );
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  const create = () =>
    action(async () => {
      if (!projectId || !topic.trim() || !consent || gate !== "clear" || !loaded) return;
      const scope = epoch.current;
      const signature = JSON.stringify([projectId, topic, slideCount]);
      if (pending.current?.signature !== signature)
        pending.current = { signature, id: crypto.randomUUID() };
      setConsent(false);
      const work = await api<ManagerWork>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/presentation-work`,
        {
          method: "POST",
          ...json({ client_request_id: pending.current.id, topic, slide_count: slideCount })
        }
      );
      if (scope !== epoch.current) return;
      pending.current = null;
      setSelectedId(work.id);
      setWorks((items) => [work, ...items.filter((item) => item.id !== work.id)]);
    });
  const control = (command: "pause" | "resume" | "approve" | "cancel") =>
    action(async () => {
      if (!selected) return;
      if ((command === "resume" || command === "approve") && gate !== "clear") return;
      const scope = epoch.current;
      const work = await api<ManagerWork>(`${base}/${encodeURIComponent(selected.id)}/control`, {
        method: "POST",
        ...json({ version: selected.version, action: command })
      });
      if (scope === epoch.current)
        setWorks((items) => items.map((item) => (item.id === work.id ? work : item)));
    });
  const inspect = (file: WorkArtifactVersion) =>
    action(async () => {
      const scope = epoch.current;
      setPreview(null);
      setReviewed(false);
      const result = await api<PresentationWorkPreview>("/api/v1/presentations/work-preview", {
        method: "POST",
        ...json({
          project_id: projectId,
          work_id: file.work_id,
          artifact_id: file.id,
          version: file.version,
          sha256: file.sha256
        })
      });
      if (scope === epoch.current) setPreview(result);
    });

  return (
    <details className={styles.aiWork}>
      <summary>Создать презентацию с ИИ</summary>
      <p>
        Задача использует сохранённые материалы и Skills выбранного проекта. План, слайды и проверка
        Критика — до трёх запросов к настроенной модели. Автоматического платного повтора нет.
      </p>
      {modelMode === "mock" && (
        <p role="status">
          Включена тестовая модель. Живой ИИ не вызывается; демонстрационный ответ может не
          содержать слайды.
        </p>
      )}
      <fieldset disabled={busy || editorBusy}>
        <label>
          Проект для презентации
          <select
            value={projectId}
            onChange={(event) => {
              epoch.current++;
              setProjectId(event.target.value);
              setSelectedId("");
              setWorks([]);
              setFiles([]);
              setPreview(null);
              setReviewed(false);
              setConsent(false);
              setLoaded(false);
              pending.current = null;
            }}
          >
            <option value="">Выберите проект…</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </select>
        </label>
        {!projects.length && (
          <p>
            Создайте проект на <Link href="/">главной странице</Link>, затем добавьте в него нужные
            материалы.
          </p>
        )}
        <label>
          Тема и требования
          <textarea
            value={topic}
            maxLength={4000}
            rows={3}
            onChange={(event) => {
              setTopic(event.target.value);
              setConsent(false);
            }}
          />
        </label>
        <label>
          Количество слайдов
          <select
            value={slideCount}
            onChange={(event) => {
              setSlideCount(Number(event.target.value));
              setConsent(false);
            }}
          >
            {[3, 4, 5, 6, 7, 8].map((count) => (
              <option key={count}>{count}</option>
            ))}
          </select>
        </label>
        <label className={styles.checkLabel}>
          <input
            type="checkbox"
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
          />
          Разрешаю до трёх запросов с учётом лимитов проекта и аккаунта.
        </label>
        {projectId && gate !== "clear" && <p role="status">{executionGateLabels[gate]}</p>}
        <button
          type="button"
          disabled={
            !projectId ||
            !loaded ||
            !topic.trim() ||
            !consent ||
            gate !== "clear" ||
            works.some((work) => !terminal(work))
          }
          onClick={() => void create()}
        >
          Создать слайды
        </button>
        {projectId && (
          <label>
            Сохранённая задача Work
            <select
              value={selectedId}
              onChange={(event) => {
                epoch.current++;
                setSelectedId(event.target.value);
                setPreview(null);
                setReviewed(false);
              }}
            >
              <option value="">Выберите задачу…</option>
              {works.map((work) => (
                <option key={work.id} value={work.id}>
                  {new Date(work.created_at).toLocaleString("ru-RU")} ·{" "}
                  {labels[work.status] ?? work.status} · {work.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
        )}
        {selected && (
          <div role="status">
            <p>
              {labels[selected.status] ?? selected.status} · запросов: {selected.model_requests}/
              {selected.request.max_model_requests}
            </p>
            {selected.plan && <p>{selected.plan.summary}</p>}
            {selected.review && (
              <p>
                Критик: {selected.review.verdict}. {selected.review.reason}
              </p>
            )}
            {selected.error_code && (
              <p>
                Причина: {selected.error_code}. Сохранённую задачу можно открыть в Work; новый
                платный запуск требует отдельного действия.
              </p>
            )}
            <Link href={`/?project=${encodeURIComponent(projectId)}&view=plan`}>
              Открыть Work проекта
            </Link>
            {!terminal(selected) && (
              <div className={styles.headerActions}>
                {selected.status === "awaiting_approval" && (
                  <button
                    type="button"
                    disabled={gate !== "clear"}
                    onClick={() => void control("approve")}
                  >
                    Подтвердить план
                  </button>
                )}
                {selected.status === "paused" || selected.status === "blocked" ? (
                  <button
                    type="button"
                    disabled={gate !== "clear"}
                    onClick={() => void control("resume")}
                  >
                    Продолжить
                  </button>
                ) : (
                  <button type="button" onClick={() => void control("pause")}>
                    Приостановить
                  </button>
                )}
                <button type="button" onClick={() => void control("cancel")}>
                  Отменить задачу
                </button>
              </div>
            )}
            {files.map((file) => (
              <button key={file.id} type="button" onClick={() => void inspect(file)}>
                Проверить слайды из {file.name}
              </button>
            ))}
          </div>
        )}
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        {preview && (
          <div className={styles.aiPreview}>
            <h2>
              {preview.package.title} · {preview.package.slides.length} слайдов
            </h2>
            <p>
              Сохранённый файл v{preview.source.version}. SHA-256:{" "}
              <code>{preview.source.sha256}</code>
            </p>
            <p>
              Модель:{" "}
              {preview.source.model_sources
                .map((source) => `${source.provider}/${source.model} (${source.stage})`)
                .join(", ") || "Источник модели не записан"}
            </p>
            {preview.package.slides.map((slide, index) => (
              <div key={slide.id}>
                <SlidePreview slide={slide} theme={preview.package.theme} number={index + 1} />
                <p>Заметки: {slide.notes || "—"}</p>
              </div>
            ))}
            <label className={styles.checkLabel}>
              <input
                type="checkbox"
                checked={reviewed}
                onChange={(event) => setReviewed(event.target.checked)}
              />
              Проверил все слайды и заметки. Добавить в библиотеку отдельной презентацией.
            </label>
            <button
              type="button"
              disabled={!reviewed}
              onClick={() =>
                void action(async () => {
                  if (preview && reviewed) await onImport(preview.source);
                })
              }
            >
              Открыть в редакторе
            </button>
          </div>
        )}
      </fieldset>
    </details>
  );
}
