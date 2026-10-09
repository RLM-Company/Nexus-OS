"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./media-panel.module.css";

export type MediaJob = {
  id: string;
  kind: "image" | "speech";
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  error_code: string | null;
  created_at: string;
  asset: { mime: string; extension: string; bytes: number } | null;
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
    REGISTRY_UNAVAILABLE: "Модель не разрешена в media registry",
    STORAGE_UNAVAILABLE: "Не настроено постоянное хранение файлов",
    CREDENTIAL_UNAVAILABLE: "Не подключены медиа-ключи",
    PAID_EXECUTION_DISABLED: "Платные медиа-вызовы отключены",
    EMERGENCY_STOP: "Действует аварийная остановка"
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
  return { job, setJob, error, setError, start, cancel };
}

export function MediaGenerationPanel({ prompt }: { prompt: string }) {
  const caps = useMediaCapabilities();
  const { job, setJob, error, start, cancel } = useMediaJob();
  const [consent, setConsent] = useState(false);
  const [history, setHistory] = useState<MediaJob[]>([]);
  const ready = caps?.image_generation?.ready === true;
  useEffect(() => {
    void fetch("/api/v1/media/jobs", { cache: "no-store" })
      .then(async (response) =>
        response.ok ? ((await response.json()) as { items: MediaJob[] }) : { items: [] }
      )
      .then(({ items }) => setHistory(items.filter((item) => item.kind === "image").slice(0, 8)))
      .catch(() => undefined);
  }, [job?.status]);
  return (
    <section className={styles.panel} aria-label="Генерация изображений">
      <h3>Создать изображение</h3>
      <p>Опишите идею. Готовое изображение можно сохранить и скачать.</p>
      <p role="status" className={styles.status}>
        {ready ? "Генерация подключена" : unavailableName(caps?.image_generation?.reason ?? null)}
      </p>
      {ready && (
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
          />
          Разрешаю этот платный запрос. Цена заранее не подтверждена, автоматических повторов нет.
        </label>
      )}
      {prompt.trim().length > 2000 && (
        <p role="alert">Максимальная длина описания — 2000 символов.</p>
      )}
      <div className={styles.actions}>
        <button
          type="button"
          disabled={
            !ready ||
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
          Сгенерировать изображение
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
              <button
                type="button"
                onClick={() => {
                  void (async () => {
                    const response = await fetch(mediaAssetUrl(job.id), { method: "DELETE" });
                    if (response.ok) {
                      setHistory((previous) => previous.filter((item) => item.id !== job.id));
                      setJob(null);
                    }
                  })();
                }}
              >
                Удалить изображение
              </button>
            </>
          )}
        </div>
      )}
      {history.length > 0 && (
        <div className={styles.history}>
          <h4>Последние изображения</h4>
          {history.map((item) => (
            <button key={item.id} type="button" onClick={() => setJob(item)}>
              {new Date(item.created_at).toLocaleString("ru")} · {statusName[item.status]}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

export { unavailableName, statusName };
