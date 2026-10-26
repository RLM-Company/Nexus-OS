"use client";

import { useState } from "react";
import {
  GAME_PROJECT_FILES,
  type GameProject,
  type GameProjectFile
} from "@cosmora/contracts/game-project";
import styles from "./game-source.module.css";

export function GameSourceEditor({
  content,
  disabled,
  onChange
}: {
  content: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const [selected, setSelected] = useState<GameProjectFile>("game.js");
  const [raw, setRaw] = useState(false);
  let project: GameProject | undefined;
  try {
    const value = JSON.parse(content) as GameProject;
    if (
      value.format === "kosmora.game-project.v1" &&
      Array.isArray(value.files) &&
      value.files.length === 3 &&
      GAME_PROJECT_FILES.every(
        (name) =>
          value.files.filter((item) => item?.name === name && typeof item.content === "string")
            .length === 1
      )
    )
      project = value;
  } catch {
    /* Raw editing recovers incomplete/imported packages. Empty files stay editable. */
  }
  const file = project?.files.find((item) => item.name === selected);
  return (
    <section className={styles.editor} aria-label="Файлы игры">
      <div className={styles.tabs} role="group" aria-label="Исходники игры">
        {project?.files.map((item) => (
          <button
            key={item.name}
            type="button"
            aria-pressed={!raw && item.name === selected}
            onClick={() => {
              setSelected(item.name);
              setRaw(false);
            }}
          >
            {item.name}
          </button>
        ))}
        <button type="button" aria-pressed={raw || !project} onClick={() => setRaw(true)}>
          Пакет JSON
        </button>
      </div>
      <label>
        {!raw && file ? selected : "Исходный пакет игры"}
        <textarea
          spellCheck={false}
          disabled={disabled}
          value={!raw && file ? file.content : content}
          onChange={(event) => {
            if (!raw && project && file)
              onChange(
                JSON.stringify(
                  {
                    ...project,
                    files: project.files.map((item) =>
                      item.name === selected ? { ...item, content: event.target.value } : item
                    )
                  },
                  null,
                  2
                )
              );
            else onChange(event.target.value);
          }}
        />
      </label>
      <p>
        JavaScript: game.ctx, game.keys, game.pointer и game.onUpdate(dt). Поле 800 × 500. Код
        выполняется в отдельном Worker; DOM и внешние зависимости недоступны.
      </p>
    </section>
  );
}
