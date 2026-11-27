import { useEffect, useState } from "react";
import { mediaAssetUrl, useMediaJob, type CreativeCapability, type MediaJob } from "./media-panel";
import { parseMediaJobListResponse } from "./media-job-response";
import { mediaBudgetNotice } from "./media-budget-status";
import styles from "./media-workbench.module.css";

export function CreativeAudioPanel({
  kind,
  capability
}: {
  kind: "music" | "sfx";
  capability?: CreativeCapability | undefined;
}) {
  const music = kind === "music";
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
  const [consent, setConsent] = useState(false);

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
  const generate = music ? "Сгенерировать музыку" : "Сгенерировать звуковой эффект";

  return (
    <section
      aria-label={music ? "Генерация музыки" : "Звуковые эффекты"}
      className={styles.controls}
    >
      {!ready && (
        <h3>
          {music
            ? "Генерация музыки не подключена"
            : "Генерация звуковых эффектов (SFX) пока не подключена."}
        </h3>
      )}
      {ready && (
        <>
          <label className={styles.field}>
            {music ? "Описание музыки" : "Описание звукового эффекта"}
            <textarea
              value={prompt}
              maxLength={1800}
              disabled={active || submitting}
              onChange={(event) => {
                setPrompt(event.target.value);
                setConsent(false);
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
                setConsent(false);
              }}
            />
          </label>
          {music && (
            <label>
              <input
                type="checkbox"
                checked={instrumental}
                disabled={active || submitting}
                onChange={(event) => {
                  setInstrumental(event.target.checked);
                  setConsent(false);
                }}
              />
              Только инструментальная композиция
            </label>
          )}
          <label>
            <input
              type="checkbox"
              checked={consent}
              disabled={active || submitting}
              onChange={(event) => setConsent(event.target.checked)}
            />
            Разрешаю платный вызов провайдера
          </label>
        </>
      )}
      <button
        type="button"
        disabled={
          !ready ||
          !prompt.trim() ||
          !consent ||
          active ||
          submitting ||
          recovering ||
          historyUnverified ||
          !Number.isInteger(Number(seconds)) ||
          Number(seconds) < (limits?.minSeconds ?? Infinity) ||
          Number(seconds) > (limits?.maxSeconds ?? -1)
        }
        onClick={() => {
          setConsent(false);
          setSelected(null);
          void start({
            kind,
            value: prompt.trim(),
            options: { duration_seconds: Number(seconds), ...(music ? { instrumental } : {}) }
          });
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
          {job.error_code && ` · ${job.error_code}`}
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
      {items.length > 0 && (
        <div>
          <h4>История записей</h4>
          <ol>
            {items.map((item) => (
              <li key={item.id}>
                <button type="button" onClick={() => setSelected(item)}>
                  {new Date(item.created_at).toLocaleString("ru")} · MP3
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
