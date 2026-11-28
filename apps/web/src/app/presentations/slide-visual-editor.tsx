import { useEffect, useRef, useState } from "react";
import {
  parsePresentationVisual,
  PRESENTATION_IMAGE_BYTES,
  PRESENTATION_TABLE_LIMITS,
  type PresentationVisual
} from "@cosmora/contracts/presentation-package";
import { prepareChatImage } from "../prepare-chat-image";
import styles from "./presentations.module.css";

export function SlideVisualEditor({
  visual,
  onChange
}: {
  visual: PresentationVisual | undefined;
  onChange: (value: PresentationVisual | undefined) => void;
}) {
  const [error, setError] = useState("");
  const loading = useRef<AbortController | null>(null);
  useEffect(() => () => loading.current?.abort(), []);

  async function useFile(file: File) {
    loading.current?.abort();
    const controller = new AbortController();
    loading.current = controller;
    setError("");
    try {
      if (file.size > PRESENTATION_IMAGE_BYTES) throw new Error("Выберите PNG/JPEG до 48 КБ.");
      const prepared = await prepareChatImage(file);
      const next = parsePresentationVisual({
        kind: "image",
        mime: prepared.media_type,
        alt: file.name.slice(0, 160),
        data_base64: prepared.data_base64
      });
      if (!controller.signal.aborted) onChange(next);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : "Не удалось добавить изображение.");
    }
  }

  function change(value: PresentationVisual | undefined) {
    loading.current?.abort();
    setError("");
    onChange(value);
  }

  return (
    <section aria-label="Изображение или таблица слайда" className={styles.fields}>
      {(!visual || visual.kind === "image") && (
        <label>
          {visual ? "Заменить изображение" : "Добавить изображение"} (PNG/JPEG, до 48 КБ и 1024 ×
          1024)
          <input
            type="file"
            accept="image/png,image/jpeg"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void useFile(file);
              event.target.value = "";
            }}
          />
        </label>
      )}
      {visual?.kind === "image" && (
        <label>
          Описание изображения
          <input
            value={visual.alt}
            maxLength={160}
            onChange={(event) => change({ ...visual, alt: event.target.value })}
          />
        </label>
      )}
      {!visual && (
        <button
          type="button"
          onClick={() =>
            change({
              kind: "table",
              rows: [
                ["", ""],
                ["", ""]
              ]
            })
          }
        >
          Добавить таблицу
        </button>
      )}
      {visual?.kind === "table" && (
        <>
          <table className={styles.visualTable}>
            <tbody>
              {visual.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((value, column) => (
                    <td key={column}>
                      <input
                        aria-label={`Строка ${rowIndex + 1}, столбец ${column + 1}`}
                        maxLength={PRESENTATION_TABLE_LIMITS.cell}
                        value={value}
                        onChange={(event) => {
                          const content = event.target.value;
                          change({
                            ...visual,
                            rows: visual.rows.map((cells, r) =>
                              r === rowIndex
                                ? cells.map((cell, c) => (c === column ? content : cell))
                                : cells
                            )
                          });
                        }}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div className={styles.slideTools}>
            <button
              type="button"
              disabled={visual.rows.length >= PRESENTATION_TABLE_LIMITS.rows}
              onClick={() =>
                change({ ...visual, rows: [...visual.rows, visual.rows[0]!.map(() => "")] })
              }
            >
              Добавить строку
            </button>
            <button
              type="button"
              disabled={visual.rows.length <= 1}
              onClick={() => change({ ...visual, rows: visual.rows.slice(0, -1) })}
            >
              Удалить последнюю строку
            </button>
            <button
              type="button"
              disabled={visual.rows[0]!.length >= PRESENTATION_TABLE_LIMITS.columns}
              onClick={() => change({ ...visual, rows: visual.rows.map((row) => [...row, ""]) })}
            >
              Добавить столбец
            </button>
            <button
              type="button"
              disabled={visual.rows[0]!.length <= 1}
              onClick={() =>
                change({ ...visual, rows: visual.rows.map((row) => row.slice(0, -1)) })
              }
            >
              Удалить последний столбец
            </button>
          </div>
        </>
      )}
      {visual && (
        <button type="button" onClick={() => change(undefined)}>
          {visual.kind === "image" ? "Удалить изображение" : "Удалить таблицу"}
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
