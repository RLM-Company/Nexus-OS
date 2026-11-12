"use client";
import { useState } from "react";
import type { SkillCorrectionDraft } from "@cosmora/contracts";
import { skillApi } from "./skill-client";
import styles from "./skills.module.css";

type Props = { onSaved: () => void };

/** Explicit owner confirmation loop. The draft is inert until "Сохранить". */
export function SkillCorrectionForm({ onSaved }: Props) {
  const [correction, setCorrection] = useState("");
  const [draft, setDraft] = useState<SkillCorrectionDraft | null>(null);
  const [requestId, setRequestId] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const propose = async () => {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const result = await skillApi<{ draft: SkillCorrectionDraft }>(
        "/corrections/propose",
        "POST",
        { correction }
      );
      setDraft(result.draft);
      setRequestId(crypto.randomUUID());
      setStatus("Черновик подготовлен, но ещё не сохранён. Подтвердите правило вручную.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось подготовить черновик.");
    } finally {
      setBusy(false);
    }
  };

  const accept = async () => {
    if (!draft) return;
    setBusy(true);
    setError("");
    try {
      await skillApi("/corrections/accept", "POST", {
        client_request_id: requestId,
        draft: {
          format: draft.format,
          name: draft.name,
          summary: draft.summary,
          instructions: draft.instructions
        }
      });
      setDraft(null);
      setCorrection("");
      setStatus("Правило подтверждено и сохранено как личный Skill.");
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить правило.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.boundary} aria-label="Подтверждение исправления">
      <strong>Исправление ответа</strong>
      <p>
        Опишите правку своими словами. Мы подготовим черновик правила из вашего текста — без выводов
        о вас и без чтения других переписок. Правило начнёт действовать только после явного
        подтверждения.
      </p>
      <label>
        Что исправить
        <textarea
          value={correction}
          maxLength={2000}
          disabled={busy}
          onChange={(event) => {
            setCorrection(event.target.value);
            setDraft(null);
          }}
        />
      </label>
      <button type="button" disabled={busy || !correction.trim()} onClick={() => void propose()}>
        Предложить правило
      </button>
      {draft && (
        <div aria-label="Черновик правила">
          <p>
            <strong>{draft.name}</strong> · не сохранено
          </p>
          <pre className={styles.preview}>{draft.instructions}</pre>
          <button type="button" disabled={busy} onClick={() => void accept()}>
            Подтвердить и сохранить
          </button>
          <button type="button" disabled={busy} onClick={() => setDraft(null)}>
            Отменить
          </button>
        </div>
      )}
      {status && <p role="status">{status}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
