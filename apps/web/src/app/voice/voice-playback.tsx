"use client";

import { useEffect, useRef, useState } from "react";
import { mediaAssetUrl, useMediaCapabilities, useMediaJob, type MediaJob } from "../media-generation/media-panel";
import styles from "./voice.module.css";

function ExpandedPlayback({ text }: { text: string }) {
  const caps = useMediaCapabilities();
  const { job, start, cancel, error } = useMediaJob();
  const [consent, setConsent] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [browserAvailable, setBrowserAvailable] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    setBrowserAvailable("speechSynthesis" in window && "SpeechSynthesisUtterance" in window);
    return () => { if ("speechSynthesis" in window) window.speechSynthesis.cancel(); audioRef.current?.pause(); };
  }, []);
  const play = () => {
    if (!browserAvailable) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "ru-RU";
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance); setSpeaking(true);
  };
  const stop = () => { window.speechSynthesis?.cancel(); setSpeaking(false); audioRef.current?.pause(); };
  return <div className={styles.voice}>
    <div className={styles.row}>
      {browserAvailable && <button type="button" onClick={speaking ? stop : play}>{speaking ? "Остановить" : "Озвучить в браузере"}</button>}
      {caps?.speech.ready && <button type="button" disabled={!consent || text.length > 4096 || Boolean(job && ["queued", "running"].includes(job.status))} onClick={() => { void start("speech", text); setConsent(false); }}>Создать MP3 на сервере</button>}
      {job && ["queued", "running"].includes(job.status) && <button type="button" onClick={() => void cancel()}>Отменить</button>}
    </div>
    {text.length > 4096 && <small role="alert">Для MP3 используйте текст не длиннее 4096 символов.</small>}
    {caps?.speech.ready ? <label className={styles.consent}><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />Разрешаю этот платный вызов. Цена заранее неизвестна.</label> : <small>Серверная озвучка не подключена. Браузерный голос доступен только в совместимых браузерах; он не сохраняет MP3.</small>}
    {job && <small role="status">Статус MP3: {job.status}{job.error_code ? ` · ${job.error_code}` : ""}</small>}
    {job?.status === "done" && job.asset?.mime === "audio/mpeg" && <>
      <audio ref={audioRef} controls preload="none" src={mediaAssetUrl(job.id)}>Браузер не поддерживает аудио.</audio>
      <div className={styles.row}><button type="button" onClick={stop}>Стоп</button><a href={`${mediaAssetUrl(job.id)}?download=1`}>Скачать MP3</a></div>
    </>}
    {error && <small role="alert">{error}</small>}
  </div>;
}
export function VoicePlayback({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  if (!text.trim()) return null;
  return <div className={styles.playback}>
    <button type="button" onClick={() => setExpanded((current) => !current)} aria-expanded={expanded}>Голос {expanded ? "−" : "+"}</button>
    {expanded && <ExpandedPlayback text={text} />}
  </div>;
}

function SavedSpeech() {
  const [items, setItems] = useState<MediaJob[]>([]);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch("/api/v1/media/jobs", { cache: "no-store" });
        if (!response.ok) return;
        const result = await response.json() as { items: MediaJob[] };
        if (active) setItems(result.items.filter((item) => item.kind === "speech").slice(0, 20));
      } catch { /* History remains empty while unavailable. */ }
    };
    void load();
    const interval = window.setInterval(() => void load(), 5000);
    return () => { active = false; window.clearInterval(interval); };
  }, []);
  const remove = async (id: string) => {
    if (!window.confirm("Удалить MP3 и запись истории? Учёт расходов не удаляется.")) return;
    try {
      const response = await fetch(`/api/v1/media/assets/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error();
      setItems((list) => list.filter((entry) => entry.id !== id));
    } catch { window.alert("Не удалось удалить запись."); }
  };
  if (items.length === 0) return <small>Сохранённых записей пока нет.</small>;
  return <div className={styles.saved}><h4>Сохранённые озвучивания</h4>
    {items.map((item) => <div key={item.id} className={styles.voice}>
      <small>{new Date(item.created_at).toLocaleString("ru")} · {item.status}</small>
      {item.status === "done" && item.asset?.mime === "audio/mpeg" && <>
        <audio controls preload="none" src={mediaAssetUrl(item.id)} />
        <a href={`${mediaAssetUrl(item.id)}?download=1`}>Скачать MP3</a>
      </>}
      {["queued", "running"].includes(item.status) && <button type="button" onClick={() => {
        void fetch(`/api/v1/media/jobs/${encodeURIComponent(item.id)}`, { method: "DELETE" })
          .then((response) => { if (response.ok) setItems((list) => list.map((entry) => entry.id === item.id ? { ...entry, status: "cancelled" } : entry)); });
      }}>Отменить</button>}
      <button type="button" onClick={() => void remove(item.id)}>Удалить</button>
    </div>)}
  </div>;
}

export function SpeechStudio() {
  const [text, setText] = useState("");
  return <section className={styles.studio}><h3>Озвучивание текста</h3>
    <p>Проверяйте голос на готовом тексте. Браузер может озвучить бесплатно; сервер может создать сохраняемый MP3 при наличии разрешённой модели.</p>
    <label>Текст для озвучивания<textarea value={text} maxLength={4096} rows={5} onChange={(event) => setText(event.target.value)} /></label>
    {text.trim() && <ExpandedPlayback text={text.trim()} />}
    <SavedSpeech />
  </section>;
}
