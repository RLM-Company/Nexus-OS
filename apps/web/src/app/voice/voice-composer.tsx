"use client";

import { useEffect, useRef, useState } from "react";
import { useMediaCapabilities } from "../media-generation/media-panel";
import styles from "./voice.module.css";

type SpeechResult = { results: ArrayLike<ArrayLike<{ transcript: string }>> };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechResult) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};
type BrowserSpeech = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};

/** Transcript stays in a reviewable field; this component NEVER sends a chat message. */
export function VoiceComposer({
  onInsert,
  disabled = false
}: {
  onInsert: (text: string) => void;
  disabled?: boolean;
}) {
  const caps = useMediaCapabilities();
  const [browserAvailable, setBrowserAvailable] = useState(false);
  const [recorderAvailable, setRecorderAvailable] = useState(false);
  const [recording, setRecording] = useState<"idle" | "browser" | "server" | "uploading">("idle");
  const [transcript, setTranscript] = useState("");
  const [notice, setNotice] = useState("");
  const [consent, setConsent] = useState(false);
  const recognition = useRef<Recognition | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const mounted = useRef(false);
  const upload = useRef<AbortController | null>(null);
  const recordTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    mounted.current = true;
    const browser = window as BrowserSpeech;
    setBrowserAvailable(Boolean(browser.SpeechRecognition || browser.webkitSpeechRecognition));
    setRecorderAvailable(
      Boolean(
        window.MediaRecorder &&
        typeof navigator.mediaDevices?.getUserMedia === "function" &&
        MediaRecorder.isTypeSupported("audio/webm")
      )
    );
    return () => {
      mounted.current = false;
      upload.current?.abort();
      if (recordTimer.current) clearTimeout(recordTimer.current);
      recognition.current?.stop();
      if (recorder.current) recorder.current.onstop = null;
      recorder.current?.stop();
      stream.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);
  const startBrowser = () => {
    const browser = window as BrowserSpeech;
    const Constructor = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
    if (!Constructor) return;
    const instance = new Constructor();
    instance.lang = "ru-RU";
    instance.continuous = false;
    instance.interimResults = false;
    instance.onresult = (event) => {
      const latest = event.results[event.results.length - 1];
      const text = latest?.[0]?.transcript?.trim();
      if (text) setTranscript(text);
    };
    instance.onerror = () => {
      setNotice("Браузер не распознал речь или отклонил доступ к микрофону.");
      setRecording("idle");
    };
    instance.onend = () => setRecording("idle");
    recognition.current = instance;
    try {
      instance.start();
      setNotice("Распознавание браузером. Результат появится для проверки.");
      setRecording("browser");
    } catch {
      setNotice("Не удалось включить распознавание браузером.");
    }
  };
  const endServer = async (audio: Blob) => {
    if (recordTimer.current) clearTimeout(recordTimer.current);
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (!mounted.current) return;
    if (!audio.size || audio.size > 1_500_000) {
      setNotice("Аудио слишком большое или пустое (максимум 1,5 МБ).");
      setRecording("idle");
      return;
    }
    setRecording("uploading");
    const controller = new AbortController();
    upload.current = controller;
    try {
      const url = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () =>
          typeof reader.result === "string"
            ? resolve(reader.result)
            : reject(new Error("Invalid audio buffer"));
        reader.onerror = () => reject(new Error());
        reader.readAsDataURL(audio);
      });
      if (!mounted.current || controller.signal.aborted) return;
      const response = await fetch("/api/v1/media/transcriptions", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json", "X-Kosmora-Media-Consent": "explicit" },
        body: JSON.stringify({
          mime: "audio/webm",
          audio_base64: url.split(",")[1],
          explicit_paid_consent: true
        })
      });
      if (!response.ok) throw new Error();
      const payload = (await response.json()) as { text?: string };
      if (typeof payload.text !== "string") throw new Error();
      setTranscript(payload.text);
      setNotice("Текст распознан сервером. Проверьте его перед вставкой.");
    } catch {
      setNotice("Серверное распознавание не удалось. Сообщение не отправлено.");
    } finally {
      upload.current = null;
      setRecording("idle");
      setConsent(false);
    }
  };
  const startServer = async () => {
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = media;
      chunks.current = [];
      const instance = new MediaRecorder(media, { mimeType: "audio/webm" });
      instance.ondataavailable = (event) => {
        if (event.data.size) chunks.current.push(event.data);
        if (
          chunks.current.reduce((size, chunk) => size + chunk.size, 0) > 1_500_000 &&
          instance.state === "recording"
        )
          instance.stop();
      };
      instance.onstop = () => {
        void endServer(new Blob(chunks.current, { type: "audio/webm" }));
      };
      instance.start(1000);
      recordTimer.current = setTimeout(() => {
        if (instance.state === "recording") instance.stop();
      }, 60_000);
      recorder.current = instance;
      setRecording("server");
      setNotice("Идёт запись. Остановите её, чтобы распознать речь на сервере.");
    } catch {
      stream.current?.getTracks().forEach((track) => track.stop());
      setNotice("Не удалось получить доступ к микрофону.");
    }
  };
  return (
    <div className={styles.voice} aria-label="Голосовой ввод">
      <div className={styles.row}>
        {recording === "browser" ? (
          <button type="button" onClick={() => recognition.current?.stop()}>
            Остановить диктовку
          </button>
        ) : recording === "server" ? (
          <button type="button" onClick={() => recorder.current?.stop()}>
            Остановить и распознать
          </button>
        ) : (
          <>
            {browserAvailable && (
              <button
                type="button"
                disabled={disabled || recording !== "idle"}
                onClick={startBrowser}
              >
                Диктовать
              </button>
            )}
            {recorderAvailable && caps?.transcription.ready && (
              <button
                type="button"
                disabled={disabled || !consent || recording !== "idle"}
                onClick={() => void startServer()}
              >
                Записать через сервер
              </button>
            )}
          </>
        )}
        {recording === "uploading" && (
          <>
            <span>Распознаём…</span>
            <button type="button" onClick={() => upload.current?.abort()}>
              Отменить
            </button>
          </>
        )}
      </div>
      {recorderAvailable && caps?.transcription.ready && (
        <label className={styles.consent}>
          <input
            type="checkbox"
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
          />
          Разрешаю платное серверное распознавание этой записи
        </label>
      )}
      {browserAvailable && (
        <small>
          Браузерная диктовка зависит от браузера и может использовать его внешний сервис.
        </small>
      )}
      {!browserAvailable && !caps?.transcription.ready && (
        <small>В этом браузере диктовка недоступна. Серверное распознавание не подключено.</small>
      )}
      {transcript && (
        <label className={styles.review}>
          Проверьте текст перед отправкой
          <textarea
            rows={2}
            value={transcript}
            onChange={(event) => setTranscript(event.target.value)}
          />
          <button
            type="button"
            disabled={disabled || !transcript.trim()}
            onClick={() => {
              onInsert(transcript.trim());
              setTranscript("");
              setNotice("Текст добавлен в черновик, но не отправлен.");
            }}
          >
            Вставить в сообщение
          </button>
        </label>
      )}
      {notice && <small role="status">{notice}</small>}
    </div>
  );
}
