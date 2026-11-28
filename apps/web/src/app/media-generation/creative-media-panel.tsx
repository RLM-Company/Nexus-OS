import { useEffect, useState } from "react";
import {
  mediaAssetUrl,
  mediaErrorName,
  useMediaJob,
  type CreativeCapability,
  type MediaJob
} from "./media-panel";
import { parseMediaJobListResponse } from "./media-job-response";
import { mediaBudgetNotice } from "./media-budget-status";
import styles from "./media-workbench.module.css";

export function CreativeMediaPanel({
  kind,
  capability,
  clip
}: {
  kind: "music" | "sfx" | "video";
  capability?: CreativeCapability | undefined;
  clip?: { prompt: string; seconds: number; scene?: { id: string; version: number } | undefined };
}) {
  const music = kind === "music";
  const video = kind === "video";
  const {
    job,
    start,
    cancel,
    error,
    submitting,
    recovering,
    historyUnverified,
    unknown,
    checkUnknown
  } = useMediaJob(kind);
  const [items, setItems] = useState<MediaJob[]>([]);
  const [selected, setSelected] = useState<MediaJob | null>(null);
  const [prompt, setPrompt] = useState("");
  const [seconds, setSeconds] = useState(music ? "12" : "5");
  const [instrumental, setInstrumental] = useState(true);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = useState<"16:9" | "9:16">("16:9");
  const inputPrompt = clip?.prompt ?? prompt;
  const duration = clip?.seconds ?? Number(seconds);
  const confirmationKey = JSON.stringify([
    inputPrompt,
    duration,
    instrumental,
    aspectRatio,
    clip?.scene
  ]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/v1/media/jobs", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw Error();
        const rows = parseMediaJobListResponse(await response.json());
        setItems(rows.filter((item) => item.kind === kind && item.status === "done"));
      })
      .catch(() => {
        if (!controller.signal.aborted) setItems([]);
      });
    return () => controller.abort();
  }, [kind, job?.id, job?.status]);

  const limits = capability?.constraints;
  const ready = capability?.ready === true && limits !== null && limits !== undefined;
  const active = job?.status === "queued" || job?.status === "running";
  const displayed = selected ?? job;
  const generate = video
    ? "Сгенерировать видео"
    : music
      ? "Сгенерировать музыку"
      : "Сгенерировать звуковой эффект";

  return (
    <section
      aria-label={video ? "Генерация видео" : music ? "Генерация музыки" : "Звуковые эффекты"}
      className={styles.controls}
    >
      {!ready && (
        <h3>
          {video
            ? "Видеогенерация не подключена"
            : music
              ? "Генерация музыки не подключена"
              : "Генерация звуковых эффектов (SFX) пока не подключена."}
        </h3>
      )}
      {ready && (
        <p className={styles.hint}>
          Команда в чате:{" "}
          <code>
            {video
              ? "/studio video 5 16:9 --paid: описание"
              : music
                ? "/studio music 12 instrumental --paid: описание"
                : "/studio sfx 5 --paid: описание"}
          </code>
        </p>
      )}
      {ready && (
        <>
          {!video && (
            <>
              <label className={styles.field}>
                {music ? "Описание музыки" : "Описание звукового эффекта"}
                <textarea
                  value={prompt}
                  maxLength={1800}
                  disabled={active || submitting}
                  onChange={(event) => {
                    setPrompt(event.target.value);
                    setConfirmation(null);
                  }}
                />
              </label>
              <label className={styles.field}>
                Длительность (секунд)
                <input
                  type="number"
                  min={limits.minSeconds}
                  max={limits.maxSeconds}
                  step={1}
                  value={seconds}
                  disabled={active || submitting}
                  onChange={(event) => {
                    setSeconds(event.target.value);
                    setConfirmation(null);
                  }}
                />
              </label>
            </>
          )}
          {video && (
            <>
              <p>
                {clip?.scene ? `Клип для версии сцены ${clip.scene.version}` : "Отдельный клип"} ·
                MP4 360p
              </p>
              <label className={styles.field}>
                Формат кадра
                <select
                  value={aspectRatio}
                  disabled={active || submitting}
                  onChange={(event) => {
                    setAspectRatio(event.target.value === "9:16" ? "9:16" : "16:9");
                    setConfirmation(null);
                  }}
                >
                  <option value="16:9">16:9</option>
                  <option value="9:16">9:16</option>
                </select>
              </label>
            </>
          )}
          {music && (
            <label>
              <input
                type="checkbox"
                checked={instrumental}
                disabled={active || submitting}
                onChange={(event) => {
                  setInstrumental(event.target.checked);
                  setConfirmation(null);
                }}
              />
              Только инструментальная композиция
            </label>
          )}
          <label>
            <input
              type="checkbox"
              checked={confirmation === confirmationKey}
              disabled={active || submitting}
              onChange={(event) => setConfirmation(event.target.checked ? confirmationKey : null)}
            />
            Разрешаю платный вызов провайдера
          </label>
        </>
      )}
      <button
        type="button"
        disabled={
          !ready ||
          !inputPrompt.trim() ||
          confirmation !== confirmationKey ||
          active ||
          submitting ||
          recovering ||
          historyUnverified ||
          !Number.isInteger(duration) ||
          duration < (limits?.minSeconds ?? Infinity) ||
          duration > (limits?.maxSeconds ?? -1)
        }
        onClick={() => {
          setConfirmation(null);
          setSelected(null);
          const value = inputPrompt.trim();
          if (video) {
            void start({
              kind,
              value,
              options: {
                duration_seconds: duration,
                aspect_ratio: aspectRatio,
                ...(clip?.scene ? { scene: clip.scene } : {})
              }
            });
          } else {
            void start({
              kind,
              value,
              options: { duration_seconds: duration, ...(music ? { instrumental } : {}) }
            });
          }
        }}
      >
        {unknown ? "Повторить с прежним ID" : generate}
      </button>
      {(unknown || historyUnverified) && (
        <button type="button" onClick={() => void checkUnknown()}>
          Проверить историю без запуска
        </button>
      )}
      {active && (
        <button type="button" onClick={() => void cancel()}>
          Отменить
        </button>
      )}
      {error && <p role="alert">{error}</p>}
      {job && (
        <p role="status">
          {
            {
              queued: "В очереди",
              running: "Генерация",
              done: "Готово",
              failed: "Ошибка генерации",
              cancelled: "Отменено"
            }[job.status]
          }
          {job.error_code && ` · ${mediaErrorName(job.error_code)}`}
        </p>
      )}
      {mediaBudgetNotice(job?.budget_state) && <p>{mediaBudgetNotice(job?.budget_state)}</p>}
      {displayed?.status === "done" && displayed.asset?.mime === "audio/mpeg" && (
        <div>
          <audio
            key={displayed.id}
            aria-label={music ? "Музыка MP3" : "Звуковой эффект MP3"}
            controls
            preload="none"
            src={mediaAssetUrl(displayed.id)}
          />
          <a href={mediaAssetUrl(displayed.id) + "?download=1"}>Скачать MP3</a>
        </div>
      )}
      {video && displayed?.status === "done" && displayed.asset?.mime === "video/mp4" && (
        <div>
          {typeof displayed.parameters?.scene_version === "number" && (
            <p>Клип для версии сцены {displayed.parameters.scene_version}</p>
          )}
          <video
            key={displayed.id}
            aria-label="Видео MP4"
            controls
            playsInline
            preload="metadata"
            src={mediaAssetUrl(displayed.id)}
          />
          <a href={mediaAssetUrl(displayed.id) + "?download=1"}>Скачать MP4</a>
        </div>
      )}
      {items.length > 0 && (
        <div>
          <h4>История записей</h4>
          <ol>
            {items.map((item) => (
              <li key={item.id}>
                <button type="button" onClick={() => setSelected(item)}>
                  {new Date(item.created_at).toLocaleString("ru")} · {video ? "MP4" : "MP3"}
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
