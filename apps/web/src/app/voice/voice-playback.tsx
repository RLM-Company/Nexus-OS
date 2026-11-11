"use client";

import { useEffect, useRef, useState } from "react";
import {
  mediaAssetUrl,
  useMediaCapabilities,
  useMediaJob,
  type MediaJob
} from "../media-generation/media-panel";
import styles from "./voice.module.css";
import { WorkspaceIcon } from "../workspace-icons";
import { mediaBudgetLabel, mediaBudgetNotice } from "../media-generation/media-budget-status";

export function CompactVoicePlayback({ text }: { text: string }) {
  const [available, setAvailable] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);
  useEffect(() => {
    setAvailable("speechSynthesis" in window && "SpeechSynthesisUtterance" in window);
    return () => {
      if (utterance.current) {
        utterance.current.onend = null;
        utterance.current.onerror = null;
        window.speechSynthesis?.cancel();
      }
    };
  }, []);
  const label = speaking ? "Остановить озвучивание" : "Озвучить ответ";
  return (
    <button
      type="button"
      className="message-action"
      aria-label={label}
      title={available ? label : "Озвучивание недоступно в этом браузере"}
      aria-pressed={speaking}
      disabled={!available}
      onClick={() => {
        window.speechSynthesis.cancel();
        if (speaking) {
          setSpeaking(false);
          return;
        }
        const next = new SpeechSynthesisUtterance(text);
        try {
          const rate = Number(localStorage.getItem("kosmora:voice-rate.v1") ?? 1);
          if (Number.isFinite(rate) && rate >= 0.75 && rate <= 1.5) next.rate = rate;
        } catch {
          /* Browser storage is optional for speech playback. */
        }
        utterance.current = next;
        next.lang = /[а-яё]/i.test(text) ? "ru-RU" : "en-US";
        next.onend = next.onerror = () => setSpeaking(false);
        window.speechSynthesis.speak(next);
        setSpeaking(true);
      }}
    >
      <WorkspaceIcon name={speaking ? "stop" : "sound"} />
    </button>
  );
}

function ExpandedPlayback({
  text,
  recoverServerJob = false
}: {
  text: string;
  recoverServerJob?: boolean;
}) {
  const caps = useMediaCapabilities();
  const { job, start, cancel, error, recovering, unknown, historyUnverified, checkUnknown } =
    useMediaJob(recoverServerJob ? "speech" : undefined);
  const [consent, setConsent] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [browserAvailable, setBrowserAvailable] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    setBrowserAvailable("speechSynthesis" in window && "SpeechSynthesisUtterance" in window);
    return () => {
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      audioRef.current?.pause();
    };
  }, []);
  const play = () => {
    if (!browserAvailable || !text.trim()) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "ru-RU";
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
    setSpeaking(true);
  };
  const stop = () => {
    window.speechSynthesis?.cancel();
    setSpeaking(false);
    audioRef.current?.pause();
  };
  return (
    <div className={styles.voice}>
      <div className={styles.row}>
        {browserAvailable && (
          <button type="button" disabled={!text.trim()} onClick={speaking ? stop : play}>
            {speaking ? "Остановить" : "Озвучить в браузере"}
          </button>
        )}
        {caps?.speech.ready && (
          <button
            type="button"
            disabled={
              !consent ||
              !text.trim() ||
              text.length > 4096 ||
              recovering ||
              historyUnverified ||
              Boolean(job && ["queued", "running"].includes(job.status))
            }
            onClick={() => {
              void start("speech", text);
              setConsent(false);
            }}
          >
            Создать MP3 на сервере
          </button>
        )}
        {job && ["queued", "running"].includes(job.status) && (
          <button type="button" onClick={() => void cancel()}>
            Отменить
          </button>
        )}
        {recoverServerJob && (unknown || historyUnverified) && (
          <button type="button" onClick={() => void checkUnknown()}>
            Проверить историю MP3 без запуска
          </button>
        )}
      </div>
      {text.length > 4096 && (
        <small role="alert">Для MP3 используйте текст не длиннее 4096 символов.</small>
      )}
      {caps?.speech.ready ? (
        <label className={styles.consent}>
          <input
            type="checkbox"
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
          />
          Разрешаю этот платный вызов. Цена заранее неизвестна.
        </label>
      ) : (
        <small>
          Серверная озвучка не подключена. Браузерный голос доступен только в совместимых браузерах;
          он не сохраняет MP3.
        </small>
      )}
      {recoverServerJob && unknown && (
        <small role="alert">
          Предыдущая озвучка могла быть запущена. Новый платный запрос автоматически не
          отправляется: проверьте историю.
        </small>
      )}
      {recoverServerJob && historyUnverified && (
        <small role="alert">
          История MP3 пока недоступна. Платный запуск заблокирован до успешной проверки.
        </small>
      )}
      {recoverServerJob && recovering && <small role="status">Проверяем историю MP3…</small>}
      {job && (
        <small role="status">
          Статус MP3: {job.status}
          {job.error_code ? ` · ${job.error_code}` : ""}
        </small>
      )}
      {mediaBudgetNotice(job?.budget_state) && (
        <small role={job?.budget_state === "uncertain" ? "alert" : "status"}>
          {mediaBudgetNotice(job?.budget_state)}
        </small>
      )}
      {job?.status === "done" && job.asset?.mime === "audio/mpeg" && (
        <>
          <audio ref={audioRef} controls preload="none" src={mediaAssetUrl(job.id)}>
            Браузер не поддерживает аудио.
          </audio>
          <div className={styles.row}>
            <button type="button" onClick={stop}>
              Стоп
            </button>
            <a href={`${mediaAssetUrl(job.id)}?download=1`}>Скачать MP3</a>
          </div>
        </>
      )}
      {error && <small role="alert">{error}</small>}
    </div>
  );
}
export function VoicePlayback({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  if (!text.trim()) return null;
  return (
    <div className={styles.playback}>
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
      >
        Голос {expanded ? "−" : "+"}
      </button>
      {expanded && <ExpandedPlayback text={text} />}
    </div>
  );
}

function SavedSpeech() {
  const [items, setItems] = useState<MediaJob[]>([]);
  const [historyError, setHistoryError] = useState("");
  const [actionError, setActionError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch("/api/v1/media/jobs", { cache: "no-store" });
        if (!response.ok) throw new Error("Failed to fetch owner's speech jobs");
        const result = (await response.json()) as { items?: MediaJob[] };
        if (active) {
          setItems(
            (Array.isArray(result.items) ? result.items : [])
              .filter((item) => item.kind === "speech")
              .slice(0, 20)
          );
          setHistoryError("");
        }
      } catch {
        if (active)
          setHistoryError("Не удалось загрузить историю MP3. Это не значит, что записей нет.");
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    const interval = window.setInterval(() => void load(), 5000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);
  const remove = async (id: string) => {
    if (!window.confirm("Удалить MP3 и запись истории? Учёт расходов не удаляется.")) return;
    try {
      const response = await fetch(`/api/v1/media/assets/${encodeURIComponent(id)}`, {
        method: "DELETE"
      });
      if (!response.ok) throw new Error();
      setItems((list) => list.filter((entry) => entry.id !== id));
    } catch {
      window.alert("Не удалось удалить запись.");
    }
  };
  return (
    <div className={styles.saved}>
      <h4>Сохранённые озвучивания</h4>
      {loading && <small role="status">Загружаем историю MP3…</small>}
      {historyError && <small role="alert">{historyError}</small>}
      {actionError && <small role="alert">{actionError}</small>}
      {!loading && !historyError && items.length === 0 && (
        <small>Сохранённых записей пока нет.</small>
      )}
      {items.map((item) => (
        <div key={item.id} className={styles.voice}>
          <small>
            {new Date(item.created_at).toLocaleString("ru")} · {item.status}
            {mediaBudgetLabel(item.budget_state)
              ? ` · ${mediaBudgetLabel(item.budget_state)}`
              : ""}
          </small>
          {item.status === "done" && item.asset?.mime === "audio/mpeg" && (
            <>
              <audio controls preload="none" src={mediaAssetUrl(item.id)} />
              <a href={`${mediaAssetUrl(item.id)}?download=1`}>Скачать MP3</a>
            </>
          )}
          {["queued", "running"].includes(item.status) && (
            <button
              type="button"
              onClick={() => {
                void fetch(`/api/v1/media/jobs/${encodeURIComponent(item.id)}`, {
                  method: "DELETE"
                })
                  .then((response) => {
                    if (!response.ok) throw new Error("Cancellation failed");
                    setActionError("");
                    setItems((list) =>
                      list.map((entry) =>
                        entry.id === item.id ? { ...entry, status: "cancelled" } : entry
                      )
                    );
                  })
                  .catch(() => {
                    setActionError("Не удалось подтвердить отмену MP3. Проверьте статус задачи.");
                  });
              }}
            >
              Отменить
            </button>
          )}
          <button type="button" onClick={() => void remove(item.id)}>
            Удалить
          </button>
        </div>
      ))}
    </div>
  );
}

export function SpeechStudio() {
  const [text, setText] = useState("");
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("kosmora:media:speech-draft.v1");
      if (saved && saved.length <= 4096) setText(saved);
    } catch {
      /* Local text remains editable when session storage is disabled. */
    }
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    try {
      sessionStorage.setItem("kosmora:media:speech-draft.v1", text);
    } catch {
      /* No paid request is issued by saving a local draft. */
    }
  }, [hydrated, text]);
  return (
    <section className={styles.studio}>
      <h3>Озвучивание текста</h3>
      <p>
        Проверяйте голос на готовом тексте. Браузер может озвучить бесплатно; сервер может создать
        сохраняемый MP3 при наличии разрешённой модели.
      </p>
      <label>
        Текст для озвучивания
        <textarea
          value={text}
          disabled={!hydrated}
          maxLength={4096}
          rows={5}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <ExpandedPlayback text={text.trim()} recoverServerJob />
      <SavedSpeech />
    </section>
  );
}
