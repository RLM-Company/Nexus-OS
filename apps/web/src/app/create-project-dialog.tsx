"use client";
import { useEffect, useId, useRef, useState } from "react";
import { WorkspaceIcon } from "./workspace-icons";
import styles from "./create-project-dialog.module.css";

export function CreateProjectDialog({
  onClose,
  onCreated
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const attempt = useRef<{ id: string; title: string } | null>(null);
  const locked = useRef(false);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.showModal();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  async function submit() {
    if (locked.current || !title.trim()) return;
    locked.current = true;
    setPending(true);
    setError("");
    const request = attempt.current ?? { id: crypto.randomUUID(), title: title.trim() };
    attempt.current = request;
    try {
      const response = await fetch("/api/v1/projects/empty", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: request.title, client_project_id: request.id }),
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) throw new Error();
      const value = (await response.json()) as { project: { id: string } };
      onCreated(value.project.id);
    } catch {
      // Reconcile a lost response before retrying the same idempotent creation.
      try {
        const response = await fetch(`/api/v1/projects/${request.id}`, {
          cache: "no-store",
          signal: AbortSignal.timeout(5000)
        });
        if (!response.ok) throw new Error();
        onCreated(request.id);
      } catch {
        setError("Не удалось подтвердить создание. Повторите: второй проект не появится.");
      }
    } finally {
      locked.current = false;
      setPending(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onClose();
      }}
    >
      <header>
        <span>
          <WorkspaceIcon name="projects" />
        </span>
        <h2 id={titleId}>Создать проект</h2>
        <button
          type="button"
          aria-label="Закрыть создание проекта"
          disabled={pending}
          onClick={onClose}
        >
          <WorkspaceIcon name="close" />
        </button>
      </header>
      <p>Общее пространство для переписок, файлов и результатов.</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label>
          Название проекта
          <input
            autoFocus
            required
            maxLength={160}
            value={title}
            disabled={pending || attempt.current !== null}
            placeholder="Например, Запуск продукта"
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <footer>
          <button type="button" disabled={pending} onClick={onClose}>
            Отмена
          </button>
          <button type="submit" disabled={pending || !title.trim()}>
            {pending ? "Создаём…" : "Создать проект"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
