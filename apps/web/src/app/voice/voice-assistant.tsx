"use client";

import { useEffect, useRef, useState } from "react";
import { VoiceOrb } from "../ui/kosmora-controls";
import { WorkspaceIcon } from "../workspace-icons";
import styles from "./voice-assistant.module.css";

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};
type SpeechWindow = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};

/** One explicitly started speech turn uses the existing chat, then browser synthesis. */
export function VoiceAssistant({
  onClose,
  onSend,
  busy,
  canSend,
  reply,
  error
}: {
  onClose: () => void;
  onSend: (text: string) => Promise<void>;
  busy: boolean;
  canSend: boolean;
  reply: { id: string; text: string } | null;
  error: string | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const recognition = useRef<Recognition | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  const turn = useRef(0);
  const pending = useRef(false);
  const previousReply = useRef(reply?.id);
  const latest = useRef({ onSend, canSend, busy });
  latest.current = { onSend, canSend, busy };
  const [available, setAvailable] = useState(false);
  const [listening, setListening] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [text, setText] = useState("");
  const [notice, setNotice] = useState("");

  const stop = () => {
    turn.current++;
    recognition.current?.stop();
    if (timer.current) clearTimeout(timer.current);
    window.speechSynthesis?.cancel();
    setListening(false);
    setSpeaking(false);
  };
  useEffect(() => {
    alive.current = true;
    const browser = window as SpeechWindow;
    setAvailable(Boolean(browser.SpeechRecognition || browser.webkitSpeechRecognition));
    dialog.current?.showModal();
    return () => {
      alive.current = false;
      turn.current++;
      recognition.current?.stop();
      if (timer.current) clearTimeout(timer.current);
      window.speechSynthesis?.cancel();
    };
  }, []);
  useEffect(() => {
    if (!pending.current || !reply || reply.id === previousReply.current) return;
    previousReply.current = reply.id;
    pending.current = false;
    setWaiting(false);
    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) {
      setNotice("Ответ готов в чате. Озвучивание в этом браузере недоступно.");
      return;
    }
    const spoken = new SpeechSynthesisUtterance(
      reply.text.replace(/```[\s\S]*?```/g, " Код приведён в чате. ").slice(0, 12000)
    );
    const speechTurn = turn.current;
    spoken.lang = "ru-RU";
    spoken.onend = () => {
      if (alive.current && turn.current === speechTurn) setSpeaking(false);
    };
    spoken.onerror = () => {
      if (alive.current && turn.current === speechTurn) {
        setSpeaking(false);
        setNotice("Не удалось озвучить ответ. Он сохранён в чате.");
      }
    };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(spoken);
    setSpeaking(true);
  }, [reply]);
  useEffect(() => {
    if (error && pending.current) {
      pending.current = false;
      setWaiting(false);
    }
  }, [error]);

  const listen = () => {
    if (pending.current || latest.current.busy || !latest.current.canSend) return;
    const browser = window as SpeechWindow;
    const Constructor = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
    if (!Constructor) return;
    stop();
    setNotice("");
    const token = ++turn.current;
    const instance = new Constructor();
    recognition.current = instance;
    instance.lang = "ru-RU";
    instance.continuous = false;
    instance.interimResults = false;
    let delivered = false;
    instance.onresult = (event) => {
      if (!alive.current || token !== turn.current || delivered) return;
      const content = event.results[event.results.length - 1]?.[0]?.transcript?.trim();
      if (!content) return;
      delivered = true;
      instance.stop();
      setText(content);
      setListening(false);
      if (timer.current) clearTimeout(timer.current);
      if (!latest.current.canSend || latest.current.busy) {
        setNotice("Фраза распознана, но чат занят. Повторите после завершения ответа.");
        return;
      }
      previousReply.current = reply?.id;
      pending.current = true;
      setWaiting(true);
      void latest.current.onSend(content).catch(() => {
        pending.current = false;
        if (alive.current) {
          setWaiting(false);
          setNotice("Не удалось отправить фразу. Проверьте историю перед повтором.");
        }
      });
    };
    instance.onerror = () => {
      if (alive.current && token === turn.current) {
        setListening(false);
        setNotice("Не удалось распознать речь. Проверьте доступ к микрофону.");
      }
    };
    instance.onend = () => {
      if (alive.current && token === turn.current) setListening(false);
    };
    try {
      instance.start();
      setListening(true);
      timer.current = setTimeout(() => {
        if (alive.current && token === turn.current) {
          stop();
          setNotice("Запись остановлена через 60 секунд. Нажмите «Говорить» для следующей фразы.");
        }
      }, 60000);
    } catch {
      setListening(false);
      setNotice("Распознавание не удалось запустить.");
    }
  };

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby="voice-assistant-title"
      onCancel={onClose}
    >
      <header>
        <h2 id="voice-assistant-title">Голосовой помощник</h2>
        <button type="button" aria-label="Закрыть голосового помощника" onClick={onClose}>
          <WorkspaceIcon name="close" />
        </button>
      </header>
      <div className={styles.stage}>
        <VoiceOrb
          active={listening || speaking}
          label={
            listening
              ? "Слушаю…"
              : waiting || busy
                ? "Подготавливаю ответ…"
                : speaking
                  ? "Отвечаю…"
                  : "Готов к разговору"
          }
        />
      </div>
      <p>Нажмите «Говорить». Фраза отправится в текущий чат, ответ прозвучит голосом.</p>
      {!available && (
        <p role="status">
          В этом браузере распознавание речи недоступно. Используйте текстовый чат.
        </p>
      )}
      {!canSend && !busy && <p role="status">Отправьте или очистите черновик перед разговором.</p>}
      {text && <blockquote>{text}</blockquote>}
      {(notice || error) && <p role="status">{notice || error}</p>}
      <div className={styles.actions}>
        {listening || speaking ? (
          <button type="button" onClick={stop}>
            Остановить
          </button>
        ) : (
          <button
            type="button"
            disabled={!available || !canSend || busy || waiting}
            onClick={listen}
          >
            <WorkspaceIcon name="microphone" />
            Говорить
          </button>
        )}
        <button type="button" onClick={onClose}>
          Вернуться в чат
        </button>
      </div>
      <small>
        Распознавание и озвучивание выполняет браузер. Для ответа используется выбранная модель
        чата.
      </small>
    </dialog>
  );
}
