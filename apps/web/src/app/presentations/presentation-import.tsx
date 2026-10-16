"use client";
import { useEffect, useRef, useState } from "react";
import {
  parsePresentationPackage,
  PRESENTATION_IMPORT_BYTES,
  type PresentationPackage
} from "./package";
import styles from "./presentations.module.css";

export function PresentationImport({
  busy,
  onImport
}: {
  busy: boolean;
  onImport: (value: PresentationPackage) => Promise<boolean>;
}) {
  const [value, setValue] = useState<PresentationPackage | null>(null);
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    []
  );
  const read = async (file: File) => {
    const current = ++generation.current;
    setValue(null);
    setError("");
    setReading(true);
    try {
      if (file.size > PRESENTATION_IMPORT_BYTES) throw Error("Файл презентации превышает 350 КБ.");
      const parsed = parsePresentationPackage(await file.text());
      if (current === generation.current) setValue(parsed);
    } catch (cause) {
      if (current === generation.current) setError(String(cause));
    } finally {
      if (current === generation.current) setReading(false);
    }
  };
  return (
    <div className={styles.importPanel}>
      <label>
        Импорт JSON Kosmora
        <input
          type="file"
          accept=".json,application/json"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void read(file);
          }}
        />
      </label>
      {reading && <p role="status">Проверяем файл…</p>}
      {error && <p role="alert">{error}</p>}
      {value && (
        <div>
          <strong>{value.title}</strong>
          <p>{value.slides.length} слайдов. Импорт создаст новую копию в вашем аккаунте.</p>
          <details>
            <summary>Структура презентации</summary>
            <ol>
              {value.slides.map((slide) => (
                <li key={slide.id}>{slide.title || "Без названия"}</li>
              ))}
            </ol>
          </details>
          <button
            type="button"
            disabled={busy || reading}
            onClick={() => {
              void onImport(value)
                .then((done) => {
                  if (done) setValue(null);
                })
                .catch((cause) => setError(String(cause)));
            }}
          >
            Импортировать копию
          </button>
          <button type="button" disabled={busy} onClick={() => setValue(null)}>
            Отмена импорта
          </button>
        </div>
      )}
    </div>
  );
}
