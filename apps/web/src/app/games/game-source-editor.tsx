"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  GAME_PROJECT_FILES,
  parseGameProject,
  type GameProject,
  type GameProjectFile
} from "@cosmora/contracts/game-project";
import { CanvasComparison } from "../canvas-editor/canvas-comparison";
import { GAME_ARCHIVE_MAX_BYTES, readGameProjectArchive } from "./game-project-archive";
import styles from "./game-source.module.css";

type FileHistory = { past: string[]; future: string[] };
const HISTORY_LIMIT = 40;

/** Only the selected file changes; adjacent source files remain byte-identical. */
function replaceSource(project: GameProject, selected: GameProjectFile, content: string): string {
  const files = project.files.map((item) => {
    if (item.name !== selected) return item;
    return { ...item, content };
  });
  return JSON.stringify({ ...project, files }, null, 2);
}

export function GameSourceEditor({
  content,
  baselineContent,
  disabled,
  onChange
}: {
  content: string;
  baselineContent: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const [selected, setSelected] = useState<GameProjectFile>("game.js");
  const [raw, setRaw] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [histories, setHistories] = useState<Partial<Record<GameProjectFile, FileHistory>>>({});
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState("");
  const mounted = useRef(true);
  const currentSource = useRef(content);
  currentSource.current = content;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const lastEmitted = useRef<string | null>(null);
  const lastInput = useRef<{ file: GameProjectFile; type: string; at: number } | null>(null);
  // Revisions/imports/raw package updates are external sources: never undo into
  // an old artifact or silently apply a stale snapshot to another project.
  useEffect(() => {
    if (lastEmitted.current === content) {
      lastEmitted.current = null;
      return;
    }
    lastEmitted.current = null;
    lastInput.current = null;
    setHistories({});
  }, [content]);
  const baselineFiles = useMemo(() => {
    try {
      return parseGameProject(baselineContent).files;
    } catch {
      return [];
    }
  }, [baselineContent]);
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
  const original = baselineFiles.find((item) => item.name === selected);
  const history = histories[selected];
  const emit = (next: string) => {
    lastEmitted.current = next;
    currentSource.current = next;
    onChange(next);
  };
  const restoreArchive = async (archive: File) => {
    if (disabled || restoring) return;
    const startedWith = currentSource.current;
    setRestoring(true);
    setRestoreError("");
    try {
      if (archive.size > GAME_ARCHIVE_MAX_BYTES) throw new Error("archive too large");
      const bytes = new Uint8Array(await archive.arrayBuffer());
      if (!mounted.current) return;
      if (currentSource.current !== startedWith) throw new Error("source changed during read");
      const recovered = readGameProjectArchive(bytes);
      if (recovered === startedWith) return;
      if (
        !window.confirm(
          "Заменить текущий черновик файлами из ZIP? Несохранённые правки будут потеряны. Рекомендуется сначала сохранить версию."
        )
      )
        return;
      if (!mounted.current || currentSource.current !== startedWith) return;
      setHistories({});
      setRaw(false);
      setShowDiff(false);
      lastInput.current = null;
      emit(recovered);
    } catch (cause) {
      if (mounted.current)
        setRestoreError(
          cause instanceof Error && cause.message === "source changed during read"
            ? "Черновик изменился во время чтения архива. Выберите ZIP заново."
            : "Архив отклонён: нужен ZIP экспорта Kosmora с совпадающими project.json и исходниками."
        );
    } finally {
      if (mounted.current) setRestoring(false);
    }
  };
  const changeSelected = (value: string, type: string) => {
    if (!project || !file || file.content === value) return;
    const now = performance.now();
    const previous = lastInput.current;
    const grouped =
      (type === "insertText" || type === "deleteContentBackward") &&
      previous?.file === selected &&
      previous.type === type &&
      now - previous.at < 700;
    setHistories((current) => {
      const state = current[selected] ?? { past: [], future: [] };
      const past = [...state.past];
      if (!grouped || past.length === 0) {
        if (past.length >= HISTORY_LIMIT) past.shift();
        past.push(file.content);
      }
      return { ...current, [selected]: { past, future: [] } };
    });
    lastInput.current = { file: selected, type, at: now };
    emit(replaceSource(project, selected, value));
  };
  const travel = (direction: "undo" | "redo") => {
    if (disabled || !project || !file) return;
    const state = histories[selected];
    const stack = direction === "undo" ? state?.past : state?.future;
    const previous = stack?.at(-1);
    if (previous === undefined) return;
    lastInput.current = null;
    setHistories((current) => {
      const latest = current[selected]!;
      return {
        ...current,
        [selected]:
          direction === "undo"
            ? {
                past: latest.past.slice(0, -1),
                future: [...latest.future.slice(-(HISTORY_LIMIT - 1)), file.content]
              }
            : {
                past: [...latest.past.slice(-(HISTORY_LIMIT - 1)), file.content],
                future: latest.future.slice(0, -1)
              }
      };
    });
    emit(replaceSource(project, selected, previous));
  };
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
              lastInput.current = null;
            }}
          >
            {item.name}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={raw || !project}
          onClick={() => {
            setRaw(true);
            lastInput.current = null;
          }}
        >
          Пакет JSON
        </button>
        <button
          type="button"
          disabled={disabled || raw || !file || !history?.past.length}
          onClick={() => travel("undo")}
        >
          Отменить правку файла
        </button>
        <button
          type="button"
          disabled={disabled || raw || !file || !history?.future.length}
          onClick={() => travel("redo")}
        >
          Повторить правку файла
        </button>
        <button
          type="button"
          aria-pressed={showDiff}
          disabled={raw || !file || !original}
          onClick={() => setShowDiff((visible) => !visible)}
        >
          Сравнить файл
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
              changeSelected(event.target.value, (event.nativeEvent as InputEvent).inputType);
            else {
              setHistories({});
              lastInput.current = null;
              emit(event.target.value);
            }
          }}
        />
      </label>
      {showDiff && !raw && file && original && (
        <CanvasComparison
          before={{
            label: `Основа файла ${selected}`,
            title: selected,
            format: "code",
            content: original.content
          }}
          after={{
            label: `Черновик файла ${selected}`,
            title: selected,
            format: "code",
            content: file.content
          }}
        />
      )}
      <label>
        Восстановить экспортированный проект
        <input
          type="file"
          accept=".zip,application/zip"
          aria-label="Восстановить ZIP проекта"
          disabled={disabled || restoring}
          onChange={(event) => {
            const archive = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (archive) void restoreArchive(archive);
          }}
        />
      </label>
      {restoreError && <p role="alert">{restoreError}</p>}
      {restoring && <p role="status">Проверяю архив…</p>}
      <p>ZIP восстанавливает исходники без выполнения кода. Сохраните новую версию в Canvas.</p>
      <p>
        Отмена и повтор действуют только для выбранного файла до переключения версии; сохранённые
        версии доступны в истории Canvas. Не более {HISTORY_LIMIT} локальных шагов на файл.
      </p>
      <p>
        JavaScript: game.ctx, game.keys, game.pointer и game.onUpdate(dt). Поле 800 × 500. Код
        выполняется в отдельном Worker; DOM и внешние зависимости недоступны.
      </p>
    </section>
  );
}
