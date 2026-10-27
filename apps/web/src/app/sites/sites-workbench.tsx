"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { CreateManagerWork, ManagerWork } from "@cosmora/contracts";
import type { GameGenre } from "@cosmora/contracts/game-package";
import { CanvasEditor, type CanvasSeed } from "../canvas-editor/canvas-editor";
import { SystemMessage } from "../ui/kosmora-controls";
import { executionGateLabels, useExecutionGate } from "../use-execution-gate";
import styles from "./sites.module.css";

const labels: Record<string, string> = {
  queued: "В очереди",
  running: "Создаём сайт",
  paused: "На паузе",
  awaiting_approval: "Проверьте план",
  blocked: "Нужно разрешение",
  completed: "Сайт подготовлен",
  failed: "Создание остановлено",
  cancelled: "Отменено"
};
const errors: Record<string, string> = {
  INVALID_GAME_PROJECT_RESULT:
    "Модель вернула неполный игровой проект. Проверьте задачу; автоматического платного повтора не было.",
  INVALID_GAME_RESULT:
    "Модель не вернула корректные данные выбранной игры. Платного повтора не было.",
  INVALID_WEBSITE_RESULT:
    "Модель не вернула полную HTML-страницу. Повторного платного запроса не было.",
  INVALID_MODEL_OUTPUT: "Модель вернула неподходящий формат. Автоматического повтора нет.",
  RECOVERY_REQUIRED: "Запуск был прерван. Проверьте результат перед новой генерацией.",
  EXECUTION_BUDGET_EXCEEDED: "Достигнут лимит этого запуска.",
  CRITIC_REJECTED: "Проверка результата не пройдена. Файлы не опубликованы.",
  USAGE_LIMIT_EXCEEDED: "Достигнут лимит аккаунта.",
  ROUTE_UNAVAILABLE: "Модель сейчас недоступна. Сохранённые сайты можно редактировать."
};
const active = (work: ManagerWork) => !["completed", "failed", "cancelled"].includes(work.status);
class BuildRequestProblem extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}
async function api<T>(url: string, signal: AbortSignal, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
    ...(body
      ? {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body)
        }
      : {})
  });
  if (!response.ok)
    throw new BuildRequestProblem(
      response.status,
      response.status === 401
        ? "Сеанс завершён. Войдите снова."
        : response.status === 400
          ? "Параметры запуска не приняты сервером. Проверьте выбранный режим или обновите страницу."
          : response.status === 403
            ? "Для этого действия не хватает разрешения."
            : response.status === 409
              ? "Состояние изменилось. Обновите список задач."
              : "Не удалось выполнить запрос. Проверьте соединение."
    );
  return response.json() as Promise<T>;
}

export function SitesWorkbench({
  projects,
  initialProjectId,
  kind = "website"
}: {
  projects: { id: string; title: string; status: string }[];
  initialProjectId: string | null;
  kind?: "website" | "game" | "game_project";
}) {
  const [projectId, setProjectId] = useState(initialProjectId ?? "");
  const game = kind !== "website";
  useEffect(() => {
    if (initialProjectId) setProjectId((current) => current || initialProjectId);
  }, [initialProjectId]);
  return (
    <section className={styles.root} aria-label={game ? "Игровая студия" : "Студия сайтов"}>
      <header className={styles.header}>
        <small>Kosmora Studio</small>
        <h2>{game ? "Games" : "Сайты"}</h2>
        <p>
          {game
            ? kind === "game_project"
              ? "Разрабатывайте браузерные игры: собственная механика, исходники, запуск, консоль и версии проекта."
              : "Быстрые прототипы на готовых механиках: настройте правила и скачайте игру."
            : "Создайте страницу с ИИ, отредактируйте код и сохраните готовый HTML."}
        </p>
      </header>
      <label>
        {game ? "Проект игры" : "Проект сайта"}
        <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
          <option value="">Выберите проект</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.title}
            </option>
          ))}
        </select>
      </label>
      {projectId ? (
        <SiteProject
          key={`${kind}:${projectId}`}
          projectId={projectId}
          kind={kind}
          canGenerate={projects.some(
            (project) => project.id === projectId && project.status === "ACTIVE"
          )}
        />
      ) : (
        <p className={styles.caption}>
          Выберите проект: в нём будут храниться задачи, исходники и версии{" "}
          {game ? "игры" : "сайта"}.
        </p>
      )}
    </section>
  );
}

function SiteProject({
  projectId,
  canGenerate,
  kind
}: {
  projectId: string;
  canGenerate: boolean;
  kind: "website" | "game" | "game_project";
}) {
  const game = kind !== "website";
  const sourceProject = kind === "game_project";
  const statusLabels = game
    ? { ...labels, running: "Создаём игру", completed: "Прототип готов" }
    : labels;
  const [genre, setGenre] = useState<GameGenre>("arcade");
  const [brief, setBrief] = useState("");
  const [works, setWorks] = useState<ManagerWork[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [seed, setSeed] = useState<CanvasSeed | undefined>();
  const life = useRef<AbortController | null>(null);
  const lock = useRef(false);
  const mutation = useRef(0);
  const pending = useRef<CreateManagerWork | null>(null);
  const gate = useExecutionGate(projectId);
  const base = `/api/v1/projects/${encodeURIComponent(projectId)}/work`;
  const selected = works.find((work) => work.id === selectedId) ?? works[0];
  const running = works.some(active);
  useEffect(() => {
    const controller = new AbortController();
    life.current = controller;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      const version = mutation.current;
      try {
        const result = await api<{ items: ManagerWork[] }>(base, controller.signal);
        if (!controller.signal.aborted && version === mutation.current && !lock.current) {
          setWorks(result.items.filter((work) => work.request.output_contract?.kind === kind));
          setLoaded(true);
          setHistoryError("");
        }
      } catch {
        if (!controller.signal.aborted) {
          setLoaded(false);
          setHistoryError(
            "Не удалось обновить задачи. Новый запуск пока заблокирован; обновите страницу, чтобы проверить принятые запросы."
          );
        }
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => void refresh(), 1800);
      }
    };
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [base, kind]);

  const action = async (callback: (signal: AbortSignal) => Promise<void>) => {
    const signal = life.current?.signal;
    if (lock.current || !signal || signal.aborted) return;
    lock.current = true;
    mutation.current++;
    setBusy(true);
    setError("");
    try {
      await callback(signal);
    } catch (cause) {
      if (!signal.aborted)
        setError(cause instanceof Error ? cause.message : "Действие не завершено.");
    } finally {
      lock.current = false;
      if (!signal.aborted) setBusy(false);
    }
  };
  const remember = (work: ManagerWork) => {
    setWorks((items) => [work, ...items.filter((item) => item.id !== work.id)]);
    setSelectedId(work.id);
  };
  const create = () =>
    action(async (signal) => {
      if (!canGenerate || !loaded || gate !== "clear" || running) return;
      if (!pending.current)
        pending.current = {
          client_request_id: crypto.randomUUID(),
          goal: brief.trim(),
          worker_role: "analyst",
          output_contract: sourceProject
            ? { kind: "game_project" }
            : game
              ? { kind: "game", genre }
              : { kind: "website" },
          require_critic: false,
          max_model_requests: 3,
          max_input_tokens: 32000,
          max_output_tokens: 8000
        };
      try {
        const work = await api<ManagerWork>(base, signal, pending.current);
        if (signal.aborted) return;
        remember(work);
        pending.current = null;
        setUncertain(false);
      } catch (cause) {
        if (!signal.aborted) {
          const rejected =
            cause instanceof BuildRequestProblem &&
            [400, 401, 403, 404, 413, 422, 423].includes(cause.status);
          if (rejected) pending.current = null;
          setUncertain(!rejected);
        }
        throw cause;
      }
    });
  const recover = () =>
    action(async (signal) => {
      const result = await api<{ items: ManagerWork[] }>(base, signal);
      if (signal.aborted) return;
      const work = result.items.find(
        (item) => item.request.client_request_id === pending.current?.client_request_id
      );
      if (work) {
        remember(work);
        pending.current = null;
        setUncertain(false);
      } else
        setError(
          "Задача пока не найдена. Можно повторить отправку с тем же ключом — второй экземпляр не создастся."
        );
    });
  const control = (command: "approve" | "resume" | "cancel") =>
    action(async (signal) => {
      if (!selected || (command !== "cancel" && gate !== "clear")) return;
      const work = await api<ManagerWork>(
        `${base}/${encodeURIComponent(selected.id)}/control`,
        signal,
        { version: selected.version, action: command }
      );
      if (!signal.aborted) remember(work);
    });
  return (
    <>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        {kind === "game" && (
          <label>
            Механика игры
            <select
              value={genre}
              disabled={busy || uncertain}
              onChange={(event) => setGenre(event.target.value as GameGenre)}
            >
              <option value="arcade">Сбор предметов и препятствия</option>
              <option value="memory">Найди пары</option>
              <option value="quiz">Викторина</option>
            </select>
          </label>
        )}
        <label>
          Что создаём?
          <textarea
            value={brief}
            onChange={(event) => setBrief(event.target.value)}
            maxLength={7000}
            disabled={busy || uncertain}
            rows={4}
            placeholder={
              sourceProject
                ? "Опишите игру: механика, управление, уровни, условия победы и визуальный стиль. Например: платформер про лунного робота с гравитацией, прыжками, препятствиями и перезапуском…"
                : game
                  ? "Тема, названия предметов, сложность или содержание вопросов. Например: космическая аркада — собрать звёзды и избегать астероидов…"
                  : "Например, страница студии архитектуры: проекты, услуги, команда и контакты. Спокойная типографика, адаптация для телефона…"
            }
          />
        </label>
        <div className={styles.row}>
          <button
            type="submit"
            className={styles.primary}
            disabled={
              !brief.trim() || !loaded || !canGenerate || busy || running || gate !== "clear"
            }
          >
            {uncertain
              ? "Повторить отправку с тем же ключом"
              : game
                ? "Создать игру"
                : "Создать сайт"}
          </button>
          {uncertain && (
            <button type="button" disabled={busy} onClick={() => void recover()}>
              Проверить запуск
            </button>
          )}
        </div>
        <p className={styles.caption}>
          {sourceProject
            ? "ИИ создаст scene.html, styles.css и game.js. Исходники можно менять, запускать в браузере, сохранять версиями и экспортировать целым проектом. Пока поддерживается Canvas 2D без внешних библиотек."
            : game
              ? "До трёх обращений к ИИ: план, данные игры и проверка по сложности. После создания можно играть без новых запросов к модели."
              : "До трёх обращений к ИИ: план, HTML/CSS и проверка по сложности. Результат сохраняется в проекте; публикация в интернете выполняется отдельно."}
        </p>
        {!canGenerate && (
          <p>Генерация доступна в активном проекте. Сохранённые файлы можно открыть в редакторе.</p>
        )}
        {gate !== "clear" && <p role="status">{executionGateLabels[gate]}</p>}
      </form>
      {error && <SystemMessage>{error}</SystemMessage>}
      {historyError && <SystemMessage>{historyError}</SystemMessage>}
      {!!works.length && (
        <section
          className={styles.task}
          aria-label={game ? "Задачи создания игр" : "Задачи создания сайтов"}
        >
          <label>
            Сохранённые задачи
            <select
              value={selected?.id ?? ""}
              onChange={(event) => setSelectedId(event.target.value)}
              disabled={busy}
            >
              {works.map((work) => (
                <option key={work.id} value={work.id}>
                  {work.request.goal.slice(0, 65)} · {statusLabels[work.status]}
                </option>
              ))}
            </select>
          </label>
          {selected && (
            <>
              <strong role="status">{statusLabels[selected.status]}</strong>
              {selected.plan && <p>{selected.plan.summary}</p>}
              <ol>
                {selected.events.slice(-4).map((event) => (
                  <li key={event.sequence}>{event.message}</li>
                ))}
              </ol>
              {selected.error_code && (
                <p role="alert">
                  {errors[selected.error_code] ?? "Задача остановлена: " + selected.error_code}
                </p>
              )}
              <div className={styles.row}>
                {selected.status === "awaiting_approval" && (
                  <button
                    type="button"
                    disabled={busy || gate !== "clear"}
                    onClick={() => void control("approve")}
                  >
                    Подтвердить план
                  </button>
                )}
                {selected.status === "paused" && (
                  <button
                    type="button"
                    disabled={busy || gate !== "clear"}
                    onClick={() => void control("resume")}
                  >
                    Продолжить
                  </button>
                )}
                {selected.status === "blocked" && (
                  <Link href={`/control-center?project=${encodeURIComponent(projectId)}`}>
                    Проверить разрешение
                  </Link>
                )}
                {active(selected) && (
                  <button type="button" disabled={busy} onClick={() => void control("cancel")}>
                    Отменить создание
                  </button>
                )}
                {selected.status === "completed" &&
                  (sourceProject ||
                    selected.draft?.files[0]?.name === (game ? "game.json" : "index.html")) && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        setSeed({
                          storageId: `${kind}:${selected.id}`,
                          title: selected.plan?.summary.slice(0, 60) || (game ? "Игра" : "Сайт"),
                          format: game ? "code" : "html",
                          content: sourceProject
                            ? JSON.stringify(
                                { format: "kosmora.game-project.v1", files: selected.draft!.files },
                                null,
                                2
                              )
                            : selected.draft!.files[0]!.content
                        })
                      }
                    >
                      {game ? "Открыть игру в редакторе" : "Открыть сайт в редакторе"}
                    </button>
                  )}
              </div>
            </>
          )}
        </section>
      )}
      <CanvasEditor
        key={seed?.storageId ?? `${kind}-library`}
        projectId={projectId}
        sitePreview={!game}
        gamePreview={kind === "game"}
        gameSource={sourceProject}
        {...(seed ? { initialDraft: seed } : {})}
      />
    </>
  );
}
