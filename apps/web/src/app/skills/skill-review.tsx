"use client";
import { useState } from "react";
import { draftKey, type Draft, type Revision } from "./skill-model";
import styles from "./skills.module.css";
const fields: { key: keyof Draft; label: string }[] = [
  { key: "name", label: "Название" },
  { key: "summary", label: "Описание" },
  { key: "instructions", label: "Инструкция" }
];
export function SkillReview({
  id,
  currentVersion,
  draft,
  revision,
  busy,
  onRestore,
  onDownload
}: {
  id: string;
  currentVersion: number;
  draft: Draft;
  revision: Revision;
  busy: boolean;
  onRestore: (version: number, expectedVersion: number, reviewedDraft: string) => void;
  onDownload: (value: Revision) => void;
}) {
  const [reviewed, setReviewed] = useState("");
  const key = JSON.stringify([
    id,
    currentVersion,
    draftKey(draft),
    revision.version,
    draftKey(revision)
  ]);
  const changed = fields.filter((field) => draft[field.key] !== revision[field.key]);
  return (
    <section className={styles.review} aria-label={`Сравнение с версией ${revision.version}`}>
      <h3>Версия {revision.version}: изменения при восстановлении</h3>
      <p>
        Сравнение с открытым черновиком. Изменённых полей: {changed.length}. Пробелы и переводы
        строк учитываются.
      </p>
      <div className={styles.comparison}>
        {fields.map((field) => (
          <section key={field.key}>
            <h4>
              {field.label}{" "}
              {draft[field.key] === revision[field.key] ? "· без изменений" : "· изменится"}
            </h4>
            <div>
              <div>
                <strong>Сейчас в редакторе</strong>
                <pre>{draft[field.key]}</pre>
              </div>
              <div>
                <strong>После восстановления</strong>
                <pre>{revision[field.key]}</pre>
              </div>
            </div>
          </section>
        ))}
      </div>
      <div className={styles.actions}>
        <button type="button" disabled={busy} onClick={() => onDownload(revision)}>
          Скачать пакет версии {revision.version}
        </button>
      </div>
      {revision.version !== currentVersion && (
        <>
          <label className={styles.check}>
            <input
              type="checkbox"
              disabled={busy}
              checked={reviewed === key}
              onChange={(event) => setReviewed(event.target.checked ? key : "")}
            />{" "}
            Проверил изменения Skill
          </label>
          <div className={styles.actions}>
            <button
              type="button"
              disabled={busy || reviewed !== key}
              onClick={() => onRestore(revision.version, currentVersion, draftKey(draft))}
            >
              Восстановить версию {revision.version}
            </button>
          </div>
        </>
      )}
      <p>
        Восстановление создаёт новую версию. Уже закреплённые версии в чатах и Work не обновляются
        автоматически.
      </p>
    </section>
  );
}
