"use client";
import { useEffect, useRef, useState } from "react";
import {
  answerClarification,
  clarificationDraft,
  clarificationWaiting,
  clearClarificationCard,
  createClarificationCard,
  readClarificationCard,
  saveClarificationCard,
  selectOption,
  setFreeText,
  skipClarification,
  type ClarificationCard
} from "./clarification-card-state";
import styles from "./clarification-card.module.css";

/** A compact card above the Koswork composer. The card is scoped to the current
 * project/plan, restored after reload, and an answer or skip is applied once.
 * Sending the answer uses the parent's existing submit/permission flow. */
export type ClarificationRequest = {
  id: string;
  question: string;
  options: string[];
  required: boolean;
};

/** Integration point, mirroring `kosmora:open-work-plan`: the current Koswork
 * task announces a clarification need; the card renders for that task only. */
export const CLARIFICATION_EVENT = "kosmora:clarification";
export function requestClarification(projectId: string, request: ClarificationRequest): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CLARIFICATION_EVENT, { detail: { projectId, ...request } }));
}

export function ClarificationCardPanel({
  projectId,
  taskScope,
  onDraft,
  onResolved
}: {
  projectId: string;
  taskScope: string;
  onDraft: (text: string) => void;
  onResolved?: (summary: string) => void;
}) {
  const [card, setCard] = useState<ClarificationCard | null>(null);
  const [request, setRequest] = useState<ClarificationRequest | null>(null);
  const [error, setError] = useState("");
  const restoredScope = useRef<string | null>(null);

  useEffect(() => {
    const onRequest = (event: Event) => {
      const detail = (event as CustomEvent<ClarificationRequest & { projectId: string }>).detail;
      if (detail?.projectId !== projectId) return;
      setRequest({
        id: detail.id,
        question: detail.question,
        options: detail.options,
        required: detail.required
      });
    };
    window.addEventListener(CLARIFICATION_EVENT, onRequest);
    return () => window.removeEventListener(CLARIFICATION_EVENT, onRequest);
  }, [projectId]);

  // Restore from the same task scope after a reload; drop a card from another task.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = readClarificationCard(window.localStorage, taskScope);
      if (stored && stored.taskScope === taskScope) setCard(stored);
      else setCard(null);
    } catch {
      setCard(null);
    }
    restoredScope.current = taskScope;
  }, [taskScope]);

  // A new request creates a fresh pending card. A resolved card is never
  // recreated on repeat renders (answer/skip counted exactly once).
  useEffect(() => {
    if (!request || typeof window === "undefined") return;
    try {
      const existing = readClarificationCard(window.localStorage, taskScope);
      if (existing?.id === request.id) {
        setCard(existing);
        return;
      }
      const next = createClarificationCard({ ...request, taskScope });
      saveClarificationCard(window.localStorage, next);
      setCard(next);
    } catch {
      setError("Не удалось подготовить уточняющий вопрос.");
    }
  }, [request, taskScope]);

  const persist = (next: ClarificationCard) => {
    setCard(next);
    try {
      saveClarificationCard(window.localStorage, next);
    } catch {
      setError("Не удалось сохранить состояние карточки в этом браузере.");
    }
  };

  const send = (next: ClarificationCard) => {
    const text = clarificationDraft(next);
    if (!text) {
      setError("Выберите вариант или напишите свой ответ.");
      return;
    }
    setError("");
    persist(next);
    onDraft(text);
    onResolved?.(`Ответ: ${text}`);
  };

  const skip = (next: ClarificationCard) => {
    setError("");
    persist(next);
    onResolved?.("Уточнение пропущено владельцем.");
  };

  if (!card || restoredScope.current !== taskScope) return null;

  return (
    <section
      className={styles.card}
      aria-label="Уточняющий вопрос"
      data-clarification-status={card.status}
    >
      <p className={styles.question}>{card.question}</p>
      {clarificationWaiting(card) && card.status === "pending" && (
        <p className={styles.waiting} role="status">
          Задача ждёт решения: без ответа этот шаг выполнить нельзя.
        </p>
      )}
      {card.status === "pending" ? (
        <>
          <ol className={styles.options}>
            {card.options.map((option) => (
              <li key={option.number}>
                <button
                  type="button"
                  className={styles.option}
                  aria-pressed={card.selectedNumber === option.number}
                  data-option={option.number}
                  onClick={() => persist(selectOption(card, option.number))}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      send(answerClarification(selectOption(card, option.number)));
                    }
                  }}
                >
                  <span className={styles.number}>{option.number}.</span> {option.label}
                </button>
              </li>
            ))}
          </ol>
          <label className={styles.freeLabel} htmlFor="clarification-free-text">
            Свой ответ
          </label>
          <textarea
            id="clarification-free-text"
            className={styles.freeText}
            rows={2}
            value={card.freeText}
            onChange={(event) => persist(setFreeText(card, event.target.value))}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                send(answerClarification(card));
              }
            }}
            placeholder="Напишите свой ответ…"
          />
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primary}
              onClick={() => send(answerClarification(card))}
            >
              Отправить
            </button>
            {!card.required && (
              <button
                type="button"
                className={styles.secondary}
                onClick={() => skip(skipClarification(card))}
              >
                Пропустить
              </button>
            )}
          </div>
        </>
      ) : (
        <p className={styles.resolved} role="status">
          {card.status === "answered"
            ? `Ответ принят: ${clarificationDraft(card)}`
            : "Уточнение пропущено."}
        </p>
      )}
    </section>
  );
}

/** Clears the stored card when the owner leaves the task scope. */
export function clearClarificationForTask(taskScope: string) {
  try {
    clearClarificationCard(window.localStorage, taskScope);
  } catch {
    /* Storage may be unavailable; an in-memory card still stays honest. */
  }
}

/** The work snapshot supplies the question; only the API can accept the answer. */
export function WorkClarificationForm({
  question,
  busy,
  submit
}: {
  question: string;
  busy: boolean;
  submit: (text: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const sending = useRef(false);

  return (
    <form
      aria-label="Уточнение сравнения поставщиков"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy || sending.current || !draft.trim()) return;
        sending.current = true;
        void submit(draft).finally(() => {
          sending.current = false;
        });
      }}
    >
      <p>{question}</p>
      <label>
        Недостающие данные JSON
        <textarea
          value={draft}
          maxLength={8000}
          onChange={(event) => setDraft(event.target.value)}
        />
      </label>
      <button className="manager-work-action primary" disabled={busy || !draft.trim()}>
        Продолжить сравнение
      </button>
    </form>
  );
}
