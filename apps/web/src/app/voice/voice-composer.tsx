"use client";

import { useEffect, useRef, useState } from "react";
import { useMediaCapabilities, type MediaJob } from "../media-generation/media-panel";
import styles from "./voice.module.css";

type SpeechResult = { results: ArrayLike<ArrayLike<{ transcript: string }>> };
type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((event: SpeechResult) => void) | null;
  onerror: (() => void) | null; onend: (() => void) | null;
  start(): void; stop(): void;
};
type BrowserSpeech = Window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };

/** Microphone and vendor speech APIs are accessed ONLY from user button clicks. */
export function VoiceComposer({ onInsert, disabled = false }: { onInsert: (text: string) => void; disabled?: boolean }) {
  const caps = useMediaCapabilities();
  const [browserAvailable, setBrowserAvailable] = useState(false);
  const [recorderAvailable, setRecorderAvailable] = useState(false);
  const [recording, setRecording] = useState<"idle" | "browser" | "server" | "uploading" | "running">("idle");
  const [transcript, setTranscript] = useState("");
  const [notice, setNotice] = useState("");
  const [consent, setConsent] = useState(false);
  const [job, setJob] = useState<MediaJob | null>(null);
  const [history, setHistory] = useState<MediaJob[]>([]);
  const recognition = useRef<Recognition | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const seconds = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelled = useRef(false);
  const turn = useRef<{ cancelled: boolean }>({ cancelled: false });
  const jobId = useRef<string | null>(null);
  const mounted = useRef(true);
  const refresh = async () => {
    try {
      const response = await fetch("/api/v1/media/jobs", { cache: "no-store" });
      if (!response.ok) return;
      const result = await response.json() as { items: MediaJob[] };
      if (mounted.current) setHistory(result.items.filter((item) => item.kind === "transcription").slice(0, 20));
    } catch { /* Offline: preserve previous history in memory. */ }
  };
  useEffect(() => {
    mounted.current = true;
    const browser = window as BrowserSpeech;
    setBrowserAvailable(Boolean(browser.SpeechRecognition || browser.webkitSpeechRecognition));
    setRecorderAvailable(Boolean(window.MediaRecorder && navigator.mediaDevices?.getUserMedia && MediaRecorder.isTypeSupported("audio/webm")));
    void refresh();
    return () => {
      mounted.current = false; cancelled.current = true;
      recognition.current?.stop();
      if (seconds.current) clearTimeout(seconds.current);
      if (recorder.current?.state === "recording") recorder.current.stop();
      stream.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);
  useEffect(() => {
    if (!job || !["queued", "running"].includes(job.status)) return;
    let active = true;
    const fetchStatus = async () => {
      try {
        const response = await fetch(`/api/v1/media/jobs/${encodeURIComponent(job.id)}`, { cache: "no-store" });
        if (!response.ok) throw new Error();
        const result = await response.json() as MediaJob;
        if (!active) return;
        setJob(result);
        if (result.status === "done" && typeof result.transcript === "string") {
          setTranscript(result.transcript);
          setNotice("Текст распознан. Проверьте его перед вставкой; сообщение не отправлено.");
          setRecording("idle"); void refresh();
        } else if (["failed", "cancelled"].includes(result.status)) {
          setNotice(result.status === "cancelled" ? "Распознавание отменено." : `Ошибка распознавания: ${result.error_code ?? "unknown"}`);
          setRecording("idle"); void refresh();
        }
      } catch { if (active) setNotice("Связь прервана. Результат сохранится в истории, если сервер закончит задачу."); }
    };
    void fetchStatus();
    const timer = window.setInterval(() => void fetchStatus(), 1300);
    return () => { active = false; window.clearInterval(timer); };
  }, [job?.id, job?.status]);

  const startBrowser = () => {
    const browser = window as BrowserSpeech;
    const Constructor = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
    if (!Constructor) return;
    const instance = new Constructor();
    instance.lang = "ru-RU"; instance.continuous = false; instance.interimResults = false;
    instance.onresult = (event) => {
      const text = event.results[event.results.length - 1]?.[0]?.transcript?.trim();
      if (text && !cancelled.current) setTranscript(text);
    };
    instance.onerror = () => { setNotice("Браузер отказал в доступе к микрофону или распознавании."); setRecording("idle"); };
    instance.onend = () => setRecording("idle");
    recognition.current = instance; cancelled.current = false;
    try { instance.start(); setRecording("browser"); setNotice("Браузерное распознавание; результат нужно проверить."); }
    catch { setNotice("Браузерное распознавание не удалось запустить."); }
  };
  const endServer = async (audio: Blob, currentTurn: { cancelled: boolean }) => {
    stream.current?.getTracks().forEach((track) => track.stop()); stream.current = null;
    if (currentTurn.cancelled || !mounted.current) { if (turn.current === currentTurn) setRecording("idle"); return; }
    if (!audio.size || audio.size > 1_500_000) {
      setNotice("Запись пустая или превышает 1,5 МБ. Повторите запись."); setRecording("idle"); return;
    }
    setRecording("uploading");
    try {
      const url = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("READ_ERROR"));
        reader.readAsDataURL(audio);
      });
      if (currentTurn.cancelled) return;
      const response = await fetch("/api/v1/media/transcriptions", {
        method: "POST", headers: { "Content-Type": "application/json", "X-Kosmora-Media-Consent": "explicit" },
        body: JSON.stringify({ mime: "audio/webm", audio_base64: url.split(",")[1], explicit_paid_consent: true })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const next = await response.json() as MediaJob;
      if (currentTurn.cancelled || !mounted.current || turn.current !== currentTurn) {
        await fetch(`/api/v1/media/jobs/${encodeURIComponent(next.id)}`, { method: "DELETE" });
        return;
      }
      jobId.current = next.id;
      setJob(next); setRecording("running"); setNotice("Задача создана; можно отменить или открыть историю позднее.");
      void refresh();
    } catch { if (mounted.current) setNotice("Серверное распознавание недоступно. Сообщение не отправлено."); }
    finally { if (currentTurn.cancelled && mounted.current && turn.current === currentTurn) setRecording("idle"); setConsent(false); }
  };
  const startServer = async () => {
    try {
      cancelled.current = false; turn.current = { cancelled: false }; jobId.current = null;
      const currentTurn = turn.current;
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (currentTurn.cancelled) { media.getTracks().forEach((t) => t.stop()); return; }
      stream.current = media; chunks.current = [];
      const instance = new MediaRecorder(media, { mimeType: "audio/webm" });
      instance.ondataavailable = (event) => {
        if (event.data.size) chunks.current.push(event.data);
        if (chunks.current.reduce((sum, part) => sum + part.size, 0) > 1_500_000 && instance.state === "recording") {
          currentTurn.cancelled = true; instance.stop(); setNotice("Превышены 1,5 МБ. Запись отменена.");
        }
      };
      instance.onstop = () => { if (seconds.current) clearTimeout(seconds.current); void endServer(new Blob(chunks.current, { type: "audio/webm" }), currentTurn); };
      instance.start(1000); recorder.current = instance;
      // Sixty seconds is a hard client recording bound, not a timer initiating recording.
      seconds.current = setTimeout(() => { if (instance.state === "recording") instance.stop(); }, 60_000);
      setRecording("server"); setNotice("Запись до 60 секунд / 1,5 МБ. Остановите для распознавания.");
    } catch { stream.current?.getTracks().forEach((track) => track.stop()); setNotice("Нет доступа к микрофону."); }
  };
  const cancel = async () => {
    cancelled.current = true; turn.current.cancelled = true;
    recognition.current?.stop();
    if (seconds.current) clearTimeout(seconds.current);
    if (recorder.current?.state === "recording") recorder.current.stop();
    stream.current?.getTracks().forEach((track) => track.stop());
    if (job?.id || jobId.current) {
      const id = job?.id ?? jobId.current!;
      try { await fetch(`/api/v1/media/jobs/${encodeURIComponent(id)}`, { method: "DELETE" }); }
      catch { setNotice("Сеть недоступна: проверьте статус задачи в истории."); }
    }
    setRecording("idle"); setNotice("Отмена запрошена. Неизвестные расходы остаются зарезервированными."); void refresh();
  };
  const remove = async (id: string) => {
    if (!window.confirm("Удалить текст и историю распознавания? Учёт расходов останется.")) return;
    const response = await fetch(`/api/v1/media/assets/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (response.ok) { if (job?.id === id) setJob(null); void refresh(); }
    else setNotice("Не удалось удалить результат.");
  };
  return <div className={styles.voice} aria-label="Голосовой ввод">
    <div className={styles.row}>
      {recording === "idle" ? <>
        {browserAvailable && <button type="button" disabled={disabled} onClick={startBrowser}>Диктовать в браузере</button>}
        {recorderAvailable && caps?.transcription.ready && <button type="button" disabled={disabled || !consent} onClick={() => void startServer()}>Записать через сервер</button>}
      </> : <>
        {recording === "server" && <button type="button" onClick={() => recorder.current?.stop()}>Остановить и распознать</button>}
        <button type="button" onClick={() => void cancel()}>Отменить</button>
        {recording === "uploading" && <small>Передаём запись…</small>}
        {recording === "running" && <small>Распознаём…</small>}
      </>}
    </div>
    {recorderAvailable && caps?.transcription.ready && <label className={styles.consent}><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />Разрешаю один платный запрос на распознавание</label>}
    {browserAvailable && <small>Браузерная диктовка зависит от браузера и может передавать голос его сервисам.</small>}
    {!caps?.transcription.ready && <small>Серверная транскрипция недоступна. Возможность не имитируется.</small>}
    {transcript && <label className={styles.review}>Проверьте текст перед отправкой<textarea rows={2} value={transcript} onChange={(event) => setTranscript(event.target.value)} />
      <button type="button" disabled={disabled || !transcript.trim()} onClick={() => { onInsert(transcript.trim()); setTranscript(""); setNotice("Текст добавлен в черновик, не отправлен."); }}>Вставить в сообщение</button></label>}
    {history.length > 0 && <div className={styles.saved}><small>История распознавания</small>
      {history.map((item) => <div key={item.id} className={styles.row}>
        <button type="button" onClick={() => { setJob(item); if (item.status === "done" && item.transcript) setTranscript(item.transcript); }}>{new Date(item.created_at).toLocaleString("ru")} · {item.status}</button>
        {["queued", "running"].includes(item.status) && <button type="button" onClick={() => { void fetch(`/api/v1/media/jobs/${encodeURIComponent(item.id)}`, { method: "DELETE" }).then(() => void refresh()); }}>Отменить</button>}
        {item.status === "done" && <button type="button" onClick={() => void remove(item.id)}>Удалить</button>}
      </div>)}
    </div>}
    {notice && <small role="status">{notice}</small>}
  </div>;
}
