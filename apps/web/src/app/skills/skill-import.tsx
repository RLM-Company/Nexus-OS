"use client";
import { useEffect, useRef, useState } from "react";
import { readSkillPackage, SKILL_PACKAGE_BYTES } from "./skill-package";
import type { Draft, SkillPackage } from "./skill-model";
import styles from "./skills.module.css";
export function SkillImport({
  busy,
  blocked,
  onImport
}: {
  busy: boolean;
  blocked: boolean;
  onImport: (value: SkillPackage) => Promise<boolean>;
}) {
  const [value, setValue] = useState<{ package: SkillPackage; draft: Draft } | null>(null);
  const [reading, setReading] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    []
  );
  const cancel = () => {
    generation.current++;
    setValue(null);
    setReading(false);
    setReviewed(false);
    setError("");
  };
  const read = async (file: File) => {
    const current = ++generation.current;
    setValue(null);
    setReviewed(false);
    setError("");
    setReading(true);
    try {
      if (file.size > SKILL_PACKAGE_BYTES) throw Error("Пакет превышает 64 КБ.");
      const result = await readSkillPackage(await file.text());
      if (generation.current === current) setValue(result);
    } catch (cause) {
      if (generation.current === current) setError(String(cause));
    } finally {
      if (generation.current === current) setReading(false);
    }
  };
  return (
    <section className={styles.importPanel} aria-label="Импорт Skill">
      <label>
        Импорт JSON
        <input
          aria-label="Выберите пакет Skill"
          type="file"
          accept="application/json,.json"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void read(file);
          }}
        />
      </label>
      {reading && <p role="status">Проверяем пакет и SHA-256…</p>}
      {error && <p role="alert">{error}</p>}
      {value && (
        <div className={styles.preview}>
          <h3>{value.draft.name}</h3>
          <p>{value.draft.summary}</p>
          <pre>{value.draft.instructions}</pre>
          <p>
            Это текст новой копии после удаления пробелов по краям. Файл ещё не сохранён в аккаунт.
          </p>
          <p>
            SHA-256 проверен. Хеш подтверждает целостность файла, а не его авторство. Разрешения
            пусты; подключения к чатам и Work не переносятся.
          </p>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={reviewed}
              disabled={busy}
              onChange={(event) => setReviewed(event.target.checked)}
            />{" "}
            Проверил текст импортируемой инструкции
          </label>
          <button
            type="button"
            disabled={busy || blocked || !reviewed}
            onClick={() => {
              const current = generation.current;
              void onImport(value.package)
                .then((done) => {
                  if (done && current === generation.current) cancel();
                })
                .catch((cause) => {
                  if (current === generation.current) setError(String(cause));
                });
            }}
          >
            Импортировать новую копию
          </button>
        </div>
      )}
      {(reading || value || error) && (
        <button type="button" disabled={busy} onClick={cancel}>
          Отмена импорта
        </button>
      )}
    </section>
  );
}
