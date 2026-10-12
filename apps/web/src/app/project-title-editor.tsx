"use client";

import { useState, type FormEvent } from "react";
import styles from "./project-title-editor.module.css";

type ProjectTitle = { id: string; title: string; updated_at: string };

export function ProjectTitleEditor({
  project,
  onSaved
}: {
  project: ProjectTitle;
  onSaved: (project: ProjectTitle) => void;
}) {
  const [title, setTitle] = useState(project.title);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const normalized = title.trim();

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || !normalized || normalized === project.title) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/projects/${encodeURIComponent(project.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: normalized })
      });
      if (!response.ok)
        throw new Error("Не удалось сохранить название проекта. Повторите попытку.");
      const result = (await response.json()) as { project: ProjectTitle };
      setTitle(result.project.title);
      onSaved(result.project);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить название проекта.");
    } finally {
      setPending(false);
    }
  };

  return (
    <form className={styles.editor} onSubmit={(event) => void save(event)}>
      <label htmlFor="project-title">Название проекта</label>
      <div className={styles.controls}>
        <input
          id="project-title"
          value={title}
          maxLength={160}
          required
          onChange={(event) => setTitle(event.target.value)}
          disabled={pending}
        />
        <button type="submit" disabled={pending || !normalized || normalized === project.title}>
          {pending ? "Сохранение…" : "Сохранить"}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
