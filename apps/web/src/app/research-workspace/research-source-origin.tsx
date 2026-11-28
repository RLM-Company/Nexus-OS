import { useState, type FormEvent } from "react";
import type { ResearchSource, ResearchSourceOrigin } from "@cosmora/core";

const labels: Record<ResearchSourceOrigin, string> = {
  primary: "Первичный источник",
  independent: "Независимое подтверждение"
};

export function ResearchSourceOriginControl({
  sourceId,
  origin,
  save
}: {
  sourceId: string;
  origin: ResearchSource["origin"];
  save: (role: ResearchSourceOrigin | null, note: string) => Promise<void>;
}) {
  const [role, setRole] = useState<ResearchSourceOrigin | "">(origin?.role ?? "");
  const [note, setNote] = useState(origin?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await save(role || null, role ? note.trim() : "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить отметку.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <details>
      <summary>
        {sourceId} ·{" "}
        {origin ? `${labels[origin.role]} (отметка владельца)` : "Происхождение не проверено"}
      </summary>
      {origin && <p>{origin.note}</p>}
      <form onSubmit={(event) => void submit(event)}>
        <label>
          Происхождение {sourceId}
          <select
            disabled={busy}
            value={role}
            onChange={(event) => setRole(event.target.value as ResearchSourceOrigin | "")}
          >
            <option value="">Не проверено</option>
            <option value="primary">{labels.primary}</option>
            <option value="independent">{labels.independent}</option>
          </select>
        </label>
        {role && (
          <label>
            Основание {sourceId}
            <input
              disabled={busy}
              maxLength={500}
              required
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
        )}
        <button
          disabled={
            busy ||
            (Boolean(role) && !note.trim()) ||
            (role === (origin?.role ?? "") && (!role || note.trim() === origin?.note))
          }
          type="submit"
        >
          Сохранить отметку {sourceId}
        </button>
        {error && <p role="alert">{error}</p>}
      </form>
    </details>
  );
}
