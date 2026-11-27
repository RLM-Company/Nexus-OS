"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./media-panel.module.css";
import { WorkspaceIcon } from "../workspace-icons";
import { CHAT_ATTACHMENT_LIMITS, type ChatImageAttachment } from "@cosmora/contracts";
import {
  parseImageConstraints,
  resolveImageOptions,
  type ImageConstraints,
  type ImageRequestOptions
} from "./media-image-options";
import { mediaBudgetLabel, mediaBudgetNotice, type MediaBudgetState } from "./media-budget-status";
import { TaskRuntimeInterval } from "../task-runtime-interval";
import { acceptsMediaProgress } from "../task-runtime-evidence";
import { startVisibleReadPolling } from "../visible-read-poller";
import { parseMediaJobListResponse } from "./media-job-response";

export type MediaJob = {
  id: string;
  kind: "image" | "speech" | "transcription";
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  error_code: string | null;
  created_at: string;
  updated_at?: string;
  asset: { mime: string; extension: string; bytes: number; sha256?: string } | null;
  transcript?: string | null;
  budget_state?: MediaBudgetState;
  client_request_id?: string | null;
  parameters?: Record<string, unknown> | null;
};
type SpeechConstraints = {
  voices: string[];
  formats: string[];
  minSpeed: number;
  maxSpeed: number;
};
type Capability = { ready: boolean; model: string | null; reason: string | null };
export type MediaCapabilities = {
  capabilities: {
    image_editing?: Capability;
    image_generation: Capability & { constraints: ImageConstraints | null };
    speech: Capability & { constraints?: SpeechConstraints | null };
    transcription: Capability;
  };
};
export const mediaAssetUrl = (id: string) => `/api/v1/media/assets/${encodeURIComponent(id)}`;

const statusName: Record<MediaJob["status"], string> = {
  queued: "В очереди",
  running: "Генерация",
  done: "Готово",
  failed: "Ошибка",
  cancelled: "Отменено"
};
const mediaErrorName = (code: string | null) =>
  (
    ({
      timeout:
        "Истекло время ожидания провайдера. Исход операции может быть неизвестен: повтор автоматически не выполняется.",
      INTERRUPTED: "Сервис был перезапущен. Задача прервана и не запускается повторно.",
      invalid_key: "Провайдер не принял учётные данные.",
      insufficient_funds: "У провайдера недостаточно средств или квоты.",
      rate_limit: "Провайдер ограничил частоту запросов.",
      invalid_mime: "Провайдер вернул файл неподходящего формата.",
      corrupt_response: "Провайдер вернул повреждённый результат.",
      provider_error: "Провайдер не выполнил запрос.",
      capability_unavailable: "Провайдер не поддерживает выбранную операцию.",
      MEDIA_BUSY: "Другая задача ещё выполняется. Проверьте историю.",
      MEDIA_LIMIT: "Достигнут лимит операций.",
      IDEMPOTENCY_CONFLICT:
        "Для этого идентификатора запуска изменены описание или параметры. Новый платный запрос не выполнен.",
      MEDIA_SOURCE_NOT_FOUND: "Исходное изображение удалено или недоступно.",
      IMAGE_REFERENCES_INVALID: "Референс не соответствует формату или ограничениям размера.",
      IMAGE_EDITING_UNAVAILABLE: "Редактирование по референсу не подключено.",
      MEDIA_UNAVAILABLE: "Генерация сейчас недоступна.",
      CONSENT_REQUIRED: "Не подтверждён платный запуск.",
      EXPLICIT_HEADER_REQUIRED: "Не подтверждён платный запуск."
    }) as Record<string, string>
  )[code ?? ""] ?? (code ? `Ошибка: ${code}` : "");

const unavailableName = (reason: string | null) =>
  ({
    REGISTRY_UNAVAILABLE: "Модель генерации пока не подключена",
    STORAGE_UNAVAILABLE: "Хранилище результатов пока недоступно",
    CREDENTIAL_UNAVAILABLE: "Провайдер генерации пока не подключён",
    PAID_EXECUTION_DISABLED: "Генерация пока не включена",
    EMERGENCY_STOP: "Действует аварийная остановка",
    BUDGET_UNAVAILABLE: "Генерация временно недоступна",
    MEDIA_STOPPED: "Работа медиа временно остановлена",
    EDITING_UNAVAILABLE: "Редактирование по референсу не подключено"
  })[reason ?? ""] ?? "Возможность недоступна";

export function useMediaCapabilities() {
  const [capabilities, setCapabilities] = useState<MediaCapabilities["capabilities"] | null>(null);
  useEffect(() => {
    let mounted = true;
    fetch("/api/v1/media/capabilities", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unavailable");
        return (await response.json()) as MediaCapabilities;
      })
      .then((value) => {
        if (mounted) {
          const normalize = (
            entry: { ready?: boolean; model?: string | null; reason?: string | null } | undefined
          ) => ({
            ready: entry?.ready === true,
            model: typeof entry?.model === "string" ? entry.model : null,
            reason: typeof entry?.reason === "string" ? entry.reason : null
          });
          const speech = value.capabilities?.speech?.constraints;
          const speechConstraints =
            speech &&
            Array.isArray(speech.voices) &&
            speech.voices.length &&
            speech.voices.every((voice) => typeof voice === "string") &&
            Array.isArray(speech.formats) &&
            speech.formats.length &&
            speech.formats.every((format) => ["mp3", "wav", "opus"].includes(format)) &&
            Number.isFinite(speech.minSpeed) &&
            Number.isFinite(speech.maxSpeed) &&
            speech.minSpeed > 0 &&
            speech.maxSpeed >= speech.minSpeed
              ? speech
              : null;
          setCapabilities({
            image_generation: {
              ...normalize(value.capabilities?.image_generation),
              constraints: parseImageConstraints(value.capabilities?.image_generation?.constraints)
            },
            image_editing: normalize(value.capabilities?.image_editing),
            speech: { ...normalize(value.capabilities?.speech), constraints: speechConstraints },
            transcription: normalize(value.capabilities?.transcription)
          });
        }
      })
      .catch(() => {
        if (mounted) setCapabilities(null);
      });
    return () => {
      mounted = false;
    };
  }, []);
  return capabilities;
}

type MediaStart =
  | {
      kind: "image";
      value: string;
      references: readonly ChatImageAttachment[];
      options?: ImageRequestOptions | undefined;
      sourceId?: string | undefined;
    }
  | {
      kind: "speech";
      value: string;
      options?: { voice?: string; speed: number; format: string } | undefined;
    };

export function useMediaJob(recoveryKind?: "image" | "speech") {
  const starting = useRef(false);
  const pendingId = useRef<string | null>(null);
  const storageKey = recoveryKind ? "kosmora:media:pending:" + recoveryKind : null;
  const [submitting, setSubmitting] = useState(false);
  const [recovering, setRecovering] = useState(Boolean(recoveryKind));
  const [unknown, setUnknown] = useState(false);
  const [historyUnverified, setHistoryUnverified] = useState(false);
  const [job, setJob] = useState<MediaJob | null>(null);
  const [error, setError] = useState<string | null>(null);

  // GET never dispatches or spends. Recover an already accepted request after a reload.
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/media/jobs", { cache: "no-store" });
      if (!response.ok) throw new Error("Не удалось получить историю задач.");
      const items = parseMediaJobListResponse(await response.json());
      const found = pendingId.current
        ? items.find(
            (item) => item.kind === recoveryKind && item.client_request_id === pendingId.current
          )
        : items.find((item) => item.kind === recoveryKind);
      setHistoryUnverified(false);
      if (found) {
        setJob(found);
        setUnknown(false);
        setError(null);
      } else if (pendingId.current) {
        setUnknown(true);
        setError(
          "Не удалось подтвердить исход предыдущего запуска. Повтор автоматически не выполняется."
        );
      } else {
        setUnknown(false);
        setError(null);
      }
    } catch (cause) {
      // An unreadable history cannot establish that no paid request is still running.
      setHistoryUnverified(true);
      throw cause;
    }
  }, [recoveryKind]);

  useEffect(() => {
    if (!storageKey) return;
    let alive = true;
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(saved))
        pendingId.current = saved;
    } catch {
      /* Storage may be disabled; the server job list still belongs to the owner. */
    }
    void refresh()
      .catch(() => {
        if (alive) {
          if (pendingId.current) setUnknown(true);
          setError(
            "Историю пока не удалось проверить. Новый платный запуск заблокирован до проверки."
          );
        }
      })
      .finally(() => {
        if (alive) setRecovering(false);
      });
    return () => {
      alive = false;
    };
  }, [refresh, storageKey]);

  useEffect(() => {
    if (!storageKey || !job || !["done", "failed", "cancelled"].includes(job.status)) return;
    if (job.client_request_id !== pendingId.current) return;
    pendingId.current = null;
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      /* Terminal state is still shown if storage fails. */
    }
    setUnknown(false);
  }, [job, storageKey]);

  const activeJobId = job && ["queued", "running"].includes(job.status) ? job.id : null;
  useEffect(() => {
    if (!activeJobId) return;
    return startVisibleReadPolling(
      async (signal) => {
        const response = await fetch(`/api/v1/media/jobs/${encodeURIComponent(activeJobId)}`, {
          cache: "no-store",
          signal: AbortSignal.any([signal, AbortSignal.timeout(6000)])
        });
        if (signal.aborted) return;
        if ([401, 403, 404, 410].includes(response.status)) {
          setJob((current) => (current?.id === activeJobId ? null : current));
          throw new Error("MEDIA_JOB_UNAVAILABLE");
        }
        if (!response.ok) throw new Error("MEDIA_READ_FAILED");
        const next = (await response.json()) as MediaJob;
        if (signal.aborted) return;
        if (next.id !== activeJobId) throw new Error("MEDIA_READ_MISMATCH");
        setJob((current) => (current && acceptsMediaProgress(current, next) ? next : current));
        setError(null);
      },
      {
        intervalMs: 1200,
        onError: (cause) =>
          setError(
            cause instanceof Error && cause.message === "MEDIA_JOB_UNAVAILABLE"
              ? "Задача недоступна. Проверьте историю перед новым запуском."
              : "Не удалось проверить статус задачи. Это не повод запускать её снова."
          )
      }
    );
  }, [activeJobId]);

  const start = useCallback(
    async (operation: MediaStart) => {
      const { kind, value, options } = operation;
      if (
        starting.current ||
        recovering ||
        historyUnverified ||
        (job && ["queued", "running"].includes(job.status))
      )
        return;
      if (
        kind === "image" &&
        !window.confirm(
          "Запустить генерацию через провайдера? Операция может расходовать оплачиваемый лимит."
        )
      )
        return;
      starting.current = true;
      setSubmitting(true);
      setError(null);
      const previousId = pendingId.current;
      const requestId = previousId ?? crypto.randomUUID();
      if (storageKey) {
        pendingId.current = requestId;
        try {
          sessionStorage.setItem(storageKey, requestId);
        } catch {
          /* A single click still has a unique server-side idempotency key. */
        }
      }
      try {
        const response = await fetch(`/api/v1/media/${kind === "image" ? "images" : "speech"}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Kosmora-Media-Consent": "explicit",
            "Idempotency-Key": requestId
          },
          body: JSON.stringify(
            kind === "image"
              ? {
                  prompt: value,
                  explicit_paid_consent: true,
                  client_request_id: requestId,
                  ...(options ?? {}),
                  ...(operation.sourceId ? { source_job_id: operation.sourceId } : {}),
                  ...(operation.references.length ? { references: operation.references } : {})
                }
              : {
                  text: value,
                  explicit_paid_consent: true,
                  client_request_id: requestId,
                  ...options
                }
          )
        });
        if (!response.ok) {
          let code: string | null = null;
          try {
            const body = (await response.json()) as {
              error?: { code?: unknown; reason?: unknown };
            };
            code =
              typeof body.error?.reason === "string"
                ? body.error.reason
                : typeof body.error?.code === "string"
                  ? body.error.code
                  : null;
          } catch {
            /* A non-JSON server error is still a rejected request. */
          }
          if (response.status >= 500)
            throw new Error(
              "Исход запуска неизвестен: сервер сообщил об ошибке. Проверьте историю."
            );
          if (!previousId && storageKey) {
            pendingId.current = null;
            try {
              sessionStorage.removeItem(storageKey);
            } catch {
              /* Optional storage. */
            }
          }
          setUnknown(Boolean(previousId));
          setError(mediaErrorName(code) || `Сервер отказал в запуске (${response.status}).`);
          return;
        }
        const next = (await response.json()) as MediaJob;
        if (!next.id || !next.status || next.kind !== kind)
          throw new Error("Сервер не подтвердил идентификатор задачи.");
        setJob(next);
        setUnknown(false);
      } catch (err) {
        setUnknown(Boolean(storageKey));
        setError(
          err instanceof Error
            ? `${err.message} Не повторяйте автоматически: проверьте статус задачи.`
            : "Неизвестен исход запуска. Проверьте историю перед повтором."
        );
        // No automatic second POST: retry is allowed only by another explicit click with the SAME request ID.
        if (storageKey) void refresh().catch(() => undefined);
      } finally {
        starting.current = false;
        setSubmitting(false);
      }
    },
    [historyUnverified, job, recovering, refresh, storageKey]
  );

  const cancel = useCallback(async () => {
    if (!job) return;
    try {
      const response = await fetch(`/api/v1/media/jobs/${encodeURIComponent(job.id)}`, {
        method: "DELETE"
      });
      if (!response.ok) throw new Error();
      const cancelled = (await response.json()) as MediaJob;
      if (cancelled.id !== job.id) throw new Error();
      setJob((current) =>
        current && acceptsMediaProgress(current, cancelled) ? cancelled : current
      );
    } catch {
      setError("Не удалось подтвердить отмену. Проверьте статус; новый запуск не выполнен.");
    }
  }, [job]);

  const checkUnknown = useCallback(async () => {
    try {
      await refresh();
    } catch {
      setError("Не удалось проверить предыдущую задачу.");
    }
  }, [refresh]);

  return {
    job,
    setJob,
    error,
    setError,
    start,
    cancel,
    submitting,
    recovering,
    unknown,
    historyUnverified,
    checkUnknown
  };
}

export function MediaGenerationPanel({
  prompt,
  blockedReason,
  references = [],
  onUseResult,
  sourceId,
  onRestoreParameters,
  capabilities,
  options
}: {
  prompt: string;
  blockedReason?: string | undefined;
  references?: readonly ChatImageAttachment[];
  onUseResult?: (item: MediaJob) => void;
  sourceId?: string | undefined;
  onRestoreParameters?: (options: ImageRequestOptions) => void;
  capabilities: MediaCapabilities["capabilities"] | null;
  options: ImageRequestOptions | null;
}) {
  const caps = capabilities;
  const {
    job,
    setJob,
    error,
    start,
    cancel,
    submitting,
    recovering,
    unknown,
    historyUnverified,
    checkUnknown
  } = useMediaJob("image");
  const [history, setHistory] = useState<MediaJob[]>([]);
  const [historyError, setHistoryError] = useState("");
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyLimit, setHistoryLimit] = useState(8);
  const [revision, setRevision] = useState(0);
  const [compare, setCompare] = useState(false);
  const editing = Boolean(sourceId || references.length);
  const parent =
    typeof job?.parameters?.source_job_id === "string"
      ? history.find(
          (candidate) =>
            candidate.id === job.parameters?.source_job_id && candidate.status === "done"
        )
      : undefined;
  const constraints = caps?.image_generation.constraints;
  const ready =
    (editing ? caps?.image_editing : caps?.image_generation)?.ready === true &&
    Boolean(constraints) &&
    Boolean(options);
  const canReuse = (item: MediaJob) =>
    caps?.image_editing?.ready === true &&
    item.status === "done" &&
    (item.asset?.bytes ?? Infinity) <= CHAT_ATTACHMENT_LIMITS.imageBytes &&
    (item.asset?.mime === "image/png" || item.asset?.mime === "image/jpeg");
  const showImage = (item: MediaJob) =>
    item.status === "done" && item.asset?.mime?.startsWith("image/") === true;
  const restoreParameters = (item: MediaJob) => {
    if (!item.parameters || !onRestoreParameters) return;
    const values = item.parameters;
    const selected = resolveImageOptions(constraints, {
      aspect_ratio: typeof values.aspect_ratio === "string" ? values.aspect_ratio : undefined,
      quality: typeof values.quality === "string" ? values.quality : undefined,
      format: typeof values.format === "string" ? values.format : undefined
    });
    if (selected) onRestoreParameters(selected);
  };
  useEffect(() => {
    let active = true;
    setHistoryLoading(true);
    void fetch("/api/v1/media/jobs", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("History unavailable");
        return parseMediaJobListResponse(await response.json());
      })
      .then((items) => {
        if (!active) return;
        setHistory(items.filter((item) => item.kind === "image"));
        setHistoryError("");
      })
      .catch(() => {
        if (!active) return;
        // Do not show stale history when the owner context or server history is unavailable.
        setHistory([]);
        setHistoryError("Не удалось загрузить историю изображений. Это не значит, что задач нет.");
      })
      .finally(() => {
        if (active) setHistoryLoading(false);
      });
    return () => {
      active = false;
    };
  }, [job?.status, revision]);
  const remove = async (id: string) => {
    if (!window.confirm("Удалить этот результат и историю задания? Учёт расходов сохранится."))
      return;
    try {
      const response = await fetch(`/api/v1/media/assets/${encodeURIComponent(id)}`, {
        method: "DELETE"
      });
      if (!response.ok) throw new Error();
      if (job?.id === id) setJob(null);
      setRevision((value) => value + 1);
    } catch {
      window.alert("Не удалось удалить результат.");
    }
  };
  return (
    <section className={styles.panel} aria-label="Генерация изображений">
      <h3>Результат</h3>
      <p>Созданное изображение появится здесь. Его можно скачать и открыть из истории.</p>
      {unknown && (
        <p role="alert">
          Предыдущий запуск мог дойти до провайдера. Автоматического повтора нет. При повторном
          нажатии используется прежний идентификатор (изменённые параметры сервер отклонит).
        </p>
      )}
      {historyUnverified && (
        <p role="alert">
          Историю заданий проверить не удалось. Новый платный запуск заблокирован до подтверждения
          состояния задач.
        </p>
      )}
      {(unknown || historyUnverified) && (
        <button type="button" onClick={() => void checkUnknown()}>
          Проверить историю без запуска
        </button>
      )}
      <p role="status" className={styles.status}>
        {ready
          ? "Kosmora Studio · готово к генерации"
          : editing
            ? "Редактирование изображений пока недоступно"
            : unavailableName(caps?.image_generation?.reason ?? null)}
      </p>
      {blockedReason && <p role="status">{blockedReason}</p>}
      {prompt.trim().length > (constraints?.maxPromptLength ?? 2000) && (
        <p role="alert">
          Максимальная длина описания — {constraints?.maxPromptLength ?? 2000} символов. Текст не
          обрезается незаметно.
        </p>
      )}
      <div className={styles.actions}>
        <button
          type="button"
          disabled={
            !ready ||
            Boolean(blockedReason) ||
            submitting ||
            recovering ||
            historyUnverified ||
            !prompt.trim() ||
            prompt.trim().length > (constraints?.maxPromptLength ?? 2000) ||
            Boolean(job && ["queued", "running"].includes(job.status))
          }
          onClick={() => {
            void start({
              kind: "image",
              value: prompt.trim(),
              references,
              options: options ?? undefined,
              sourceId
            });
          }}
        >
          <WorkspaceIcon name="images" />{" "}
          {submitting
            ? "Запускаем…"
            : recovering
              ? "Проверяем задачи…"
              : unknown
                ? "Повторить с тем же ID"
                : editing
                  ? "Изменить изображение"
                  : "Сгенерировать изображение"}
        </button>
        {job && ["queued", "running"].includes(job.status) && (
          <button type="button" onClick={() => void cancel()}>
            Отменить
          </button>
        )}
      </div>
      {error && <p role="alert">{error}</p>}

      {!job && (
        <div className={styles.emptyPreview}>
          <WorkspaceIcon name="images" />
          <strong>От идеи — к изображению</strong>
          <span>Опишите сцену и нажмите «Сгенерировать изображение».</span>
          <small>
            {options
              ? `${options.format.toUpperCase()} · ${options.aspect_ratio}`
              : "Параметры недоступны"}
          </small>
        </div>
      )}
      {job && (
        <div className={styles.asset} role="status">
          <p>
            {statusName[job.status]}
            {job.error_code ? ` · ${mediaErrorName(job.error_code)}` : ""}
          </p>
          {["done", "failed", "cancelled"].includes(job.status) && (
            <TaskRuntimeInterval
              start={job.created_at}
              end={job.updated_at}
              label="От постановки до последнего обновления"
            />
          )}
          {mediaBudgetNotice(job.budget_state) && (
            <p role={job.budget_state === "uncertain" ? "alert" : "status"}>
              {mediaBudgetNotice(job.budget_state)}
            </p>
          )}
          {showImage(job) && (
            <>
              {/* Authenticated same-origin asset; never use the prompt as an image source. */}
              <img src={mediaAssetUrl(job.id)} alt="Сгенерированное изображение" />
              <a href={`${mediaAssetUrl(job.id)}?download=1`}>
                Скачать {job.asset?.extension.toUpperCase()}
              </a>
              {onUseResult && canReuse(job) && (
                <button type="button" onClick={() => onUseResult(job)}>
                  <WorkspaceIcon name="edit" /> Продолжить редактирование
                </button>
              )}
              {onUseResult && !canReuse(job) && (
                <p>
                  {caps?.image_editing?.ready === true
                    ? job.asset?.mime === "image/png" || job.asset?.mime === "image/jpeg"
                      ? "Для правки исходник должен быть не больше 1 МБ."
                      : "Для редактирования результата выберите PNG или JPEG при генерации."
                    : "Редактирование результата пока не подключено."}
                </p>
              )}
              {parent && (
                <>
                  <button
                    type="button"
                    aria-expanded={compare}
                    onClick={() => setCompare(!compare)}
                  >
                    Сравнить с исходником
                  </button>
                  {compare && (
                    <figure>
                      <img src={mediaAssetUrl(parent.id)} alt="Исходное изображение" />
                      <figcaption>Версия до правки</figcaption>
                      <button
                        type="button"
                        onClick={() => {
                          setCompare(false);
                          setJob(parent);
                          restoreParameters(parent);
                        }}
                      >
                        Открыть исходную версию
                      </button>
                    </figure>
                  )}
                </>
              )}
              <button type="button" onClick={() => void remove(job.id)}>
                Удалить
              </button>
            </>
          )}
        </div>
      )}
      <div className={styles.history}>
        <h4>История изображений</h4>
        {historyLoading && <p role="status">Загружаем историю изображений…</p>}
        {historyError && (
          <>
            <p role="alert">{historyError}</p>
            <button type="button" onClick={() => setRevision((value) => value + 1)}>
              Повторить загрузку истории
            </button>
          </>
        )}
        {!historyLoading && !historyError && history.length === 0 && (
          <p>Сохранённых изображений пока нет.</p>
        )}
        {history.slice(0, historyLimit).map((item) => (
          <div key={item.id} className={styles.actions}>
            <button
              type="button"
              onClick={() => {
                setCompare(false);
                setJob(item);
                restoreParameters(item);
              }}
            >
              {showImage(item) && <img src={mediaAssetUrl(item.id)} alt="" loading="lazy" />}
              {new Date(item.created_at).toLocaleString("ru")} · {statusName[item.status]}
              {typeof item.parameters?.size === "string" ? ` · ${item.parameters.size}` : ""}
              {mediaBudgetLabel(item.budget_state)
                ? ` · ${mediaBudgetLabel(item.budget_state)}`
                : ""}
            </button>
            {item.status === "done" && <a href={`${mediaAssetUrl(item.id)}?download=1`}>Скачать</a>}
            <button type="button" onClick={() => void remove(item.id)}>
              Удалить
            </button>
          </div>
        ))}
        {history.length > historyLimit && (
          <button type="button" onClick={() => setHistoryLimit((value) => value + 8)}>
            Показать ещё изображения
          </button>
        )}
      </div>
    </section>
  );
}

export { unavailableName, statusName };
