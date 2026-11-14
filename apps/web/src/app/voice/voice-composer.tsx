"use client";

import { useEffect, useRef, useState } from "react";
import { WorkspaceIcon } from "../workspace-icons";
import styles from "./voice.module.css";

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult:
    | ((event: {
        resultIndex: number;
        results: ArrayLike<ArrayLike<{ transcript: string }>>;
      }) => void)
    | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type BrowserSpeech = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};

function browserRecognition() {
  const browser = window as BrowserSpeech;
  return browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
}

const errors = {
  "not-allowed": "Разрешите доступ к микрофону в настройках сайта и повторите.",
  "service-not-allowed":
    "Этот браузер не разрешает распознавание речи. Откройте Kosmora в Chrome или Edge.",
  "audio-capture": "Микрофон недоступен. Проверьте, подключён ли он.",
  network: "Сервис распознавания браузера недоступен. Проверьте соединение и повторите.",
  "no-speech": "Речь не распознана. Попробуйте ещё раз."
};

export function VoiceComposer({
  onInsert,
  disabled = false
}: {
  onInsert: (text: string) => void;
  disabled?: boolean;
}) {
  const [recording, setRecording] = useState(false);
  const [notice, setNotice] = useState("");
  const recognition = useRef<Recognition | null>(null);

  useEffect(
    () => () => {
      const active = recognition.current;
      recognition.current = null;
      active?.abort();
    },
    []
  );

  async function start() {
    if (recognition.current) return;
    const Constructor = browserRecognition();
    if (!Constructor || !navigator.mediaDevices?.getUserMedia) {
      setNotice("Диктовка недоступна в этом браузере. Откройте Kosmora в Chrome или Edge.");
      return;
    }
    const instance = new Constructor();
    instance.lang = "ru-RU";
    instance.continuous = true;
    instance.interimResults = false;
    recognition.current = instance;
    setRecording(true);
    setNotice("Ожидаю разрешения на доступ к микрофону…");
    let receivedSpeech = false;
    let lastResultIndex = -1;
    instance.onresult = (event) => {
      if (recognition.current !== instance) return;
      const fragments: string[] = [];
      for (
        let index = Math.max(event.resultIndex, lastResultIndex + 1);
        index < event.results.length;
        index++
      ) {
        const transcript = event.results[index]?.[0]?.transcript?.trim();
        if (transcript) fragments.push(transcript);
        lastResultIndex = index;
      }
      if (!fragments.length) return;
      receivedSpeech = true;
      onInsert(fragments.join(" "));
    };
    instance.onerror = ({ error }) => {
      if (recognition.current !== instance) return;
      recognition.current = null;
      setRecording(false);
      setNotice(
        errors[error as keyof typeof errors] ?? "Распознавание прервалось. Попробуйте ещё раз."
      );
    };
    instance.onend = () => {
      if (recognition.current !== instance) return;
      recognition.current = null;
      setRecording(false);
      setNotice(receivedSpeech ? "Текст добавлен в черновик." : errors["no-speech"]);
    };
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      if (recognition.current !== instance) return;
      instance.start();
      setNotice("Слушаю…");
    } catch (error) {
      if (recognition.current !== instance) return;
      recognition.current = null;
      setRecording(false);
      setNotice(
        error instanceof DOMException && error.name === "NotAllowedError"
          ? errors["not-allowed"]
          : "Не удалось запустить диктовку. Проверьте микрофон и повторите."
      );
    }
  }

  function stop() {
    const active = recognition.current;
    if (!active) return;
    try {
      active.stop();
    } catch {
      recognition.current = null;
      setRecording(false);
      setNotice("Диктовка остановлена.");
    }
  }

  return (
    <details
      className={styles.voiceMenu}
      data-active={recording || undefined}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        stop();
        event.currentTarget.open = false;
        event.currentTarget.querySelector("summary")?.focus();
      }}
    >
      <summary aria-label="Голосовой ввод" title="Голосовой ввод">
        <WorkspaceIcon name="microphone" />
        {recording && <span className={styles.recordingDot} aria-hidden="true" />}
      </summary>
      <div className={styles.voice} data-voice-panel>
        <strong>Голосовой ввод</strong>
        <div className={styles.row}>
          {recording ? (
            <button type="button" onClick={stop}>
              Остановить диктовку
            </button>
          ) : (
            <button type="button" disabled={disabled} onClick={() => void start()}>
              Диктовать в браузере
            </button>
          )}
        </div>
        {notice && <small role="status">{notice}</small>}
      </div>
    </details>
  );
}
