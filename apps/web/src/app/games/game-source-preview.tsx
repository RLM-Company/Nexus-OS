"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { strToU8, zipSync } from "fflate";
import { readGameSources } from "./game-project-sources";
import { createGameProjectHtml, gameWorkerSource } from "./game-project-runtime";
import {
  gameErrorMessage,
  mapWorkerErrorToGameLine,
  type GameDiagnostic
} from "./game-error-diagnostic";
import styles from "../sites/sites.module.css";

type RuntimeDiagnostic = { line: number | null; message: string };

export function GameSourcePreview({
  content,
  onDiagnostic
}: {
  content: string;
  onDiagnostic?: (diagnostic: RuntimeDiagnostic) => void;
}) {
  const project = useMemo(() => {
    try {
      return readGameSources(content);
    } catch {
      return null;
    }
  }, [content]);
  const [session, setSession] = useState<{ source: string; document: string; id: string } | null>(
    null
  );
  const [error, setError] = useState("");
  const [diagnostic, setDiagnostic] = useState<GameDiagnostic | null>(null);
  // Accept diagnostics only from the running sandboxed frame of this session.
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      const payload = event.data as {
        type?: string;
        source?: string;
        line?: number | null;
        text?: string;
      } | null;
      if (
        !session ||
        event.source !== sessionFrame.current?.contentWindow ||
        !payload ||
        payload.type !== "kosmora-game-diagnostic" ||
        payload.source !== "game.js"
      )
        return;
      const gameSource = project?.files.find((file) => file.name === "game.js")?.content ?? "";
      const runtime = gameWorkerSource(gameSource);
      const line =
        typeof payload.line === "number"
          ? mapWorkerErrorToGameLine(runtime, gameSource, `at blob:x:${payload.line}:1`)
          : null;
      const next: GameDiagnostic = {
        source: "game.js",
        line,
        message: gameErrorMessage(payload.text ?? "")
      };
      setDiagnostic(next);
      onDiagnostic?.({ line: next.line, message: next.message });
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [session, project, onDiagnostic]);
  const sessionFrame = useRef<HTMLIFrameElement | null>(null);
  // Unmounting a frame on an edit stops its Worker. Invalidate the old launch as well:
  // reverting the text must never silently re-execute an earlier srcDoc session.
  useEffect(() => {
    setSession(null);
    setError("");
    setDiagnostic(null);
  }, [content]);
  const running = !!project && session?.source === content;
  const objScene = project?.v2?.launch.runtime === "web3d_sandbox";
  return (
    <section className={styles.preview} aria-label="Запуск проекта игры">
      <div className={styles.toolbar}>
        <button
          type="button"
          disabled={!project}
          onClick={() => {
            if (!project) return;
            try {
              setSession({
                source: content,
                document: createGameProjectHtml(
                  { format: "kosmora.game-project.v1", files: project.files },
                  true,
                  project.v2
                ),
                id: crypto.randomUUID()
              });
              setError("");
              setDiagnostic(null);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "Не удалось подготовить запуск.");
            }
          }}
        >
          {objScene ? "Показать модель и сцену" : running ? "Перезапустить игру" : "Запустить игру"}
        </button>
        <button type="button" disabled={!running} onClick={() => setSession(null)}>
          Остановить игру
        </button>
        <button
          type="button"
          disabled={!project}
          onClick={() => {
            if (!project) return;
            try {
              const entries: Record<string, Uint8Array> = {};
              for (const file of project.files) entries[file.name] = strToU8(file.content);
              entries["project.json"] = strToU8(content);
              entries["index.html"] = strToU8(
                createGameProjectHtml(
                  { format: "kosmora.game-project.v1", files: project.files },
                  false,
                  project.v2
                )
              );
              entries["README.txt"] = strToU8(
                objScene
                  ? "Откройте index.html для статического просмотра OBJ-lite. Модель и встроенные ресурсы сохраняются в project.json. Импортируйте ZIP в Games для правок.\n"
                  : "Kosmora Games — исходники браузерной игры\nОткройте index.html, чтобы играть без сервера и интернета.\nscene.html — статичная сцена, styles.css — оформление, game.js — логика Canvas 2D в Worker.\nindex.html содержит снимок исходников на момент экспорта. После правок импортируйте project.json в Games и экспортируйте снова.\nПоле 800x500. API: game.ctx, game.keys (lower-case), game.pointer{x,y,down}, game.onUpdate(dt), game.onKey(key,down), game.onPointer(pointer).\nНужен современный браузер с OffscreenCanvas. Это браузерный проект, не Unity/Godot и не нативная сборка.\n"
              );
              const bytes = zipSync(entries, { level: 6 });
              const url = URL.createObjectURL(
                new Blob([new Uint8Array(bytes)], { type: "application/zip" })
              );
              const link = document.createElement("a");
              link.href = url;
              link.download = "kosmora-game-source.zip";
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 30000);
              setError("");
            } catch {
              setError("Не удалось собрать архив. Исходники остались в редакторе.");
            }
          }}
        >
          Скачать проект ZIP
        </button>
      </div>
      <p className={styles.caption}>
        {objScene
          ? "Статический просмотр OBJ-lite. Код game.js в этом режиме не выполняется."
          : "Запуск без запросов к ИИ. Изменение исходников останавливает предпросмотр. Ошибки и консоль отображаются под игровым полем."}
      </p>
      {error && <p role="alert">{error}</p>}
      {!project ? (
        <p>Откройте поддерживаемый пакет игры или проверьте исходный JSON.</p>
      ) : running && session ? (
        <iframe
          ref={sessionFrame}
          key={session.id}
          className={`${styles.frame} ${styles.desktop}`}
          style={{ height: 760 }}
          title="Проект игры Kosmora"
          sandbox={objScene ? "" : "allow-scripts"}
          referrerPolicy="no-referrer"
          srcDoc={session.document}
        />
      ) : (
        <p>Исходники готовы к запуску.</p>
      )}
      {diagnostic && (
        <div role="alert" aria-label="Диагностика ошибки игры">
          <p>
            Ошибка в game.js{diagnostic.line ? `, строка ${diagnostic.line}` : ""}:{" "}
            {diagnostic.message}
          </p>
          <p>Исправьте game.js и нажмите «Запустить игру» для повторного запуска.</p>
        </div>
      )}
    </section>
  );
}
