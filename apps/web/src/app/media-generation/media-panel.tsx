"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./media-panel.module.css";
import { WorkspaceIcon } from "../workspace-icons";
import type { ChatImageAttachment } from "@cosmora/contracts";
import {
  parseImageConstraints,
  resolveImageOptions,
  type ImageConstraints,
  type ImageRequestOptions
} from "./media-image-options";

export type MediaJob = {
  id: string;
  kind: "image" | "speech" | "transcription";
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  error_code: string | null;
  created_at: string;
  asset: { mime: string; extension: string; bytes: number; sha256?: string } | null;
  transcript?: string | null;
  budget_state?: "none" | "reserved" | "reconciled" | "uncertain";
  client_request_id?: string | null;
  parameters?: Record<string, unknown> | null;
};
type Capability = { ready: boolean; model: string | null; reason: string | null };
export type MediaCapabilities = {
  capabilities: {
    image_editing?: Capability;
    image_generation: Capability & { constraints: ImageConstraints | null };
    speech: Capability;
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
          setCapabilities({
            image_generation: {
              ...normalize(value.capabilities?.image_generation),
              constraints: parseImageConstraints(value.capabilities?.image_generation?.constraints)
            },
            image_editing: normalize(value.capabilities?.image_editing),
            speech: normalize(value.capabilities?.speech),
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

export function useMediaJob(recoveryKind?: "image") {
  const starting = useRef(false);
  const pendingId = useRef<string | null>(null);
  const storageKey = recoveryKind ? "kosmora:media:pending:" + recoveryKind : null;
  const [submitting, setSubmitting] = useState(false);
  const [recovering, setRecovering] = useState(Boolean(recoveryKind));
  const [unknown, setUnknown] = useState(false);
  const [job, setJob] = useState<MediaJob | null>(null);
  const [error, setError] = useState<string | null>(null);

  // GET never dispatches or spends. Recover an already accepted request after a reload.
  const refresh = useCallback(async () => {
    const response = await fetch("/api/v1/media/jobs", { cache: "no-store" });
    if (!response.ok) throw new Error("Не удалось получить историю задач.");
    const data = (await response.json()) as { items?: MediaJob[] };
    const items = Array.isArray(data.items) ? data.items : [];
    const found = pendingId.current
      ? items.find(
          (item) => item.kind === recoveryKind && item.client_request_id === pendingId.current
        )
      : items.find((item) => item.kind === recoveryKind);
    if (found) {
      setJob(found);
      setUnknown(false);
      setError(null);
    } else if (pendingId.current) {
      setUnknown(true);
      setError(
        "Не удалось подтвердить исход предыдущего запуска. Повтор автоматически не выполняется."
      );
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
        if (alive && pendingId.current) {
          setUnknown(true);
          setError(
            "Историю пока не удалось проверить. Предыдущий запрос нельзя считать отменённым."
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

  useEffect(() => {
    if (!job || (job.status !== "queued" && job.status !== "running")) return;
    let active = true;
    const timer = window.setInterval(() => {
      void fetch(`/api/v1/media/jobs/${encodeURIComponent(job.id)}`, { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) throw new Error();
          return (await response.json()) as MediaJob;
        })
        .then((next) => {
          if (active) {
            setJob(next);
            setError(null);
          }
        })
        .catch(() => {
          if (active)
            setError("Не удалось проверить статус задачи. Это не повод запускать её снова.");
        });
    }, 1200);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [job]);

  const start = useCallback(
    async (
      kind: "image" | "speech",
      value: string,
      references: readonly ChatImageAttachment[] = [],
      options?: ImageRequestOptions
    ) => {
      if (starting.current || recovering || (job && ["queued", "running"].includes(job.status)))
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
                  ...(references.length ? { references } : {})
                }
              : { text: value, explicit_paid_consent: true, client_request_id: requestId }
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
    [job, recovering, refresh, storageKey]
  );

  const cancel = useCallback(async () => {
    if (!job) return;
    try {
      const response = await fetch(`/api/v1/media/jobs/${encodeURIComponent(job.id)}`, {
        method: "DELETE"
      });
      if (!response.ok) throw new Error();
      setJob((await response.json()) as MediaJob);
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
    checkUnknown
  };
}

export function MediaGenerationPanel({
  prompt,
  blockedReason,
  references = [],
  onUseResult,
  onRestoreParameters,
  capabilities,
  options
}: {
  prompt: string;
  blockedReason?: string | undefined;
  references?: readonly ChatImageAttachment[];
  onUseResult?: (file: File) => Promise<void>;
  onRestoreParameters?: (options: ImageRequestOptions) => void;
  capabilities: MediaCapabilities["capabilities"] | null;
  options: ImageRequestOptions | null;
}) {
  const caps = capabilities;
  const { job, setJob, error, start, cancel, submitting, recovering, unknown, checkUnknown } =
    useMediaJob("image");
  const [history, setHistory] = useState<MediaJob[]>([]);
  const [revision, setRevision] = useState(0);
  const [referenceLoading, setReferenceLoading] = useState(false);
  const [referenceError, setReferenceError] = useState("");
  const referenceController = useRef<AbortController | null>(null);
  useEffect(() => () => referenceController.current?.abort(), []);
  const constraints = caps?.image_generation.constraints;
  const ready =
    (references.length ? caps?.image_editing : caps?.image_generation)?.ready === true &&
    Boolean(constraints) &&
    Boolean(options);
  const canReuse = (item: MediaJob) =>
    caps?.image_editing?.ready === true &&
    item.status === "done" &&
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
  async function reuseResult(id: string) {
    if (!onUseResult || referenceLoading || caps?.image_editing?.ready !== true) return;
    const controller = new AbortController();
    referenceController.current = controller;
    setReferenceLoading(true);
    setReferenceError("");
    try {
      const response = await fetch(mediaAssetUrl(id), { signal: controller.signal });
      const mime = response.headers.get("content-type")?.split(";")[0]?.trim();
      if (!response.ok || (mime !== "image/png" && mime !== "image/jpeg")) throw Error();
      const blob = await response.blob();
      if (!controller.signal.aborted)
        await onUseResult(
          new File([blob], `kosmora-${id}.${mime === "image/png" ? "png" : "jpg"}`, { type: mime })
        );
    } catch {
      if (!controller.signal.aborted)
        setReferenceError("Не удалось подготовить изображение для редактирования.");
    } finally {
      if (!controller.signal.aborted) setReferenceLoading(false);
    }
  }
  useEffect(() => {
    void fetch("/api/v1/media/jobs", { cache: "no-store" })
      .then(async (response) =>
        response.ok ? ((await response.json()) as { items: MediaJob[] }) : { items: [] }
      )
      .then(({ items }) => setHistory(items.filter((item) => item.kind === "image").slice(0, 8)))
      .catch(() => undefined);
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
      {unknown && (
        <button type="button" onClick={() => void checkUnknown()}>
          Проверить историю без запуска
        </button>
      )}
      <p role="status" className={styles.status}>
        {ready
          ? "Kosmora Studio · готово к генерации"
          : references.length
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
            referenceLoading ||
            !prompt.trim() ||
            prompt.trim().length > (constraints?.maxPromptLength ?? 2000) ||
            Boolean(job && ["queued", "running"].includes(job.status))
          }
          onClick={() => {
            void start("image", prompt.trim(), references, options ?? undefined);
          }}
        >
          <WorkspaceIcon name="images" />{" "}
          {submitting
            ? "Запускаем…"
            : recovering
              ? "Проверяем задачи…"
              : unknown
                ? "Повторить с тем же ID"
                : references.length
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
      {referenceError && <p role="alert">{referenceError}</p>}
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
          {showImage(job) && (
            <>
              {/* Authenticated same-origin asset; never use the prompt as an image source. */}
              <img src={mediaAssetUrl(job.id)} alt="Сгенерированное изображение" />
              <a href={`${mediaAssetUrl(job.id)}?download=1`}>
                Скачать {job.asset?.extension.toUpperCase()}
              </a>
              {onUseResult && canReuse(job) && (
                <button
                  type="button"
                  disabled={referenceLoading}
                  onClick={() => void reuseResult(job.id)}
                >
                  <WorkspaceIcon name="edit" />{" "}
                  {referenceLoading ? "Готовим…" : "Продолжить редактирование"}
                </button>
              )}
              {onUseResult && !canReuse(job) && (
                <p>
                  {caps?.image_editing?.ready === true
                    ? "Для редактирования результата выберите PNG или JPEG при генерации."
                    : "Редактирование результата пока не подключено."}
                </p>
              )}
              <button type="button" onClick={() => void remove(job.id)}>
                Удалить
              </button>
            </>
          )}
        </div>
      )}
      {history.length > 0 && (
        <div className={styles.history}>
          <h4>История изображений</h4>
          {history.map((item) => (
            <div key={item.id} className={styles.actions}>
              <button
                type="button"
                onClick={() => {
                  setJob(item);
                  restoreParameters(item);
                }}
              >
                {showImage(item) && <img src={mediaAssetUrl(item.id)} alt="" loading="lazy" />}
                {new Date(item.created_at).toLocaleString("ru")} · {statusName[item.status]}
                {typeof item.parameters?.size === "string" ? ` · ${item.parameters.size}` : ""}
              </button>
              {item.status === "done" && (
                <a href={`${mediaAssetUrl(item.id)}?download=1`}>Скачать</a>
              )}
              <button type="button" onClick={() => void remove(item.id)}>
                Удалить
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export { unavailableName, statusName };
