"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./media-panel.module.css";

export type MediaJob = {
  id: string;
  kind: "image" | "speech" | "transcription";
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  error_code: string | null;
  created_at: string;
  asset: { mime: string; extension: string; bytes: number; sha256?: string } | null;
  transcript?: string | null;
  budget_state?: "none" | "reserved" | "reconciled" | "uncertain";
};
export type MediaCapabilities = {
  capabilities: {
    image_generation: { ready: boolean; model: string | null; reason: string | null };
    speech: { ready: boolean; model: string | null; reason: string | null };
    transcription: { ready: boolean; model: string | null; reason: string | null };
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
const unavailableName = (reason: string | null) =>
  ({
    REGISTRY_UNAVAILABLE: "Модель генерации пока не подключена",
    STORAGE_UNAVAILABLE: "Хранилище результатов пока недоступно",
    CREDENTIAL_UNAVAILABLE: "Провайдер генерации пока не подключён",
    PAID_EXECUTION_DISABLED: "Генерация пока не включена",
    EMERGENCY_STOP: "Действует аварийная остановка",
    BUDGET_UNAVAILABLE: "Генерация временно недоступна",
    MEDIA_STOPPED: "Работа медиа временно остановлена"
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
        if (mounted) setCapabilities(value.capabilities);
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

export function useMediaJob() {
  const starting = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [job, setJob] = useState<MediaJob | null>(null);
  const [error, setError] = useState<string | null>(null);
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
          if (active) setJob(next);
        })
        .catch(() => {
          if (active) setError("Не удалось проверить статус задачи.");
        });
    }, 1200);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [job]);
  const start = useCallback(async (kind: "image" | "speech", value: string) => {
    if (starting.current) return;
    starting.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/media/${kind === "image" ? "images" : "speech"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Kosmora-Media-Consent": "explicit" },
        body: JSON.stringify(
          kind === "image"
            ? { prompt: value, explicit_paid_consent: true }
            : { text: value, explicit_paid_consent: true }
        )
      });
      if (!response.ok) throw new Error(`Сервер отказал в запуске (${response.status}).`);
      setJob((await response.json()) as MediaJob);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось запустить задачу.");
    } finally {
      starting.current = false;
      setSubmitting(false);
    }
  }, []);
  const cancel = useCallback(async () => {
    if (!job) return;
    try {
      const response = await fetch(`/api/v1/media/jobs/${encodeURIComponent(job.id)}`, {
        method: "DELETE"
      });
      if (!response.ok) throw new Error();
      setJob((await response.json()) as MediaJob);
    } catch {
      setError("Не удалось отменить задачу.");
    }
  }, [job]);
  return { job, setJob, error, setError, start, cancel, submitting };
}

export function MediaGenerationPanel({
  prompt,
  blockedReason
}: {
  prompt: string;
  blockedReason?: string | undefined;
}) {
  const caps = useMediaCapabilities();
  const { job, setJob, error, start, cancel, submitting } = useMediaJob();
  const [consent, setConsent] = useState(false);
  const [history, setHistory] = useState<MediaJob[]>([]);
  const [revision, setRevision] = useState(0);
  const ready = caps?.image_generation?.ready === true;
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
      <p role="status" className={styles.status}>
        {ready
          ? `Модель: ${caps?.image_generation.model}`
          : unavailableName(caps?.image_generation?.reason ?? null)}
      </p>
      {blockedReason && <p role="status">{blockedReason}</p>}
      {ready && !blockedReason && (
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
          />
          Подтверждаю генерацию с расходом баланса.
        </label>
      )}
      {prompt.trim().length > 2000 && (
        <p role="alert">
          Максимальная длина описания для генерации — 2000 символов. Текст не обрезается незаметно.
        </p>
      )}
      <div className={styles.actions}>
        <button
          type="button"
          disabled={
            !ready ||
            Boolean(blockedReason) ||
            submitting ||
            !consent ||
            !prompt.trim() ||
            prompt.trim().length > 2000 ||
            Boolean(job && ["queued", "running"].includes(job.status))
          }
          onClick={() => {
            void start("image", prompt.trim());
            setConsent(false);
          }}
        >
          {submitting ? "Запускаем…" : "Сгенерировать изображение"}
        </button>
        {job && ["queued", "running"].includes(job.status) && (
          <button type="button" onClick={() => void cancel()}>
            Отменить
          </button>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {job && (
        <div className={styles.asset} role="status">
          <p>
            {statusName[job.status]}
            {job.error_code ? ` · ${job.error_code}` : ""}
          </p>
          {job.status === "done" && job.asset?.mime === "image/png" && (
            <>
              {/* Authenticated same-origin asset; never use the prompt as an image source. */}
              <img src={mediaAssetUrl(job.id)} alt="Сгенерированное изображение" />
              <a href={`${mediaAssetUrl(job.id)}?download=1`}>Скачать PNG</a>
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
              <button type="button" onClick={() => setJob(item)}>
                {new Date(item.created_at).toLocaleString("ru")} · {statusName[item.status]}
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
