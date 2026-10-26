"use client";

import { useMemo, useState } from "react";
import { strToU8, zipSync } from "fflate";
import { parseGameProject } from "@cosmora/contracts/game-project";
import { createGameProjectHtml } from "./game-project-runtime";
import styles from "../sites/sites.module.css";

export function GameSourcePreview({ content }: { content: string }) {
  const project = useMemo(() => {
    try {
      return parseGameProject(content);
    } catch {
      return null;
    }
  }, [content]);
  const [session, setSession] = useState<{ source: string; document: string; id: string } | null>(
    null
  );
  const [error, setError] = useState("");
  const running = !!project && session?.source === content;
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
                document: createGameProjectHtml(project, true),
                id: crypto.randomUUID()
              });
              setError("");
            } catch {
              setError("Не удалось подготовить запуск.");
            }
          }}
        >
          {running ? "Перезапустить игру" : "Запустить игру"}
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
              entries["index.html"] = strToU8(createGameProjectHtml(project));
              entries["README.txt"] = strToU8(
                "Kosmora Games — исходники браузерной игры\nОткройте index.html, чтобы играть без сервера и интернета.\nscene.html — статичная сцена, styles.css — оформление, game.js — логика Canvas 2D в Worker.\nindex.html содержит снимок исходников на момент экспорта. После правок импортируйте project.json в Games и экспортируйте снова.\nПоле 800x500. API: game.ctx, game.keys (lower-case), game.pointer{x,y,down}, game.onUpdate(dt), game.onKey(key,down), game.onPointer(pointer).\nНужен современный браузер с OffscreenCanvas. Это браузерный проект, не Unity/Godot и не нативная сборка.\n"
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
        Собственный код игры · запуск без новых запросов к ИИ. Изменение исходников останавливает
        предпросмотр. Ошибки и консоль отображаются под игровым полем.
      </p>
      {error && <p role="alert">{error}</p>}
      {!project ? (
        <p>Откройте пакет kosmora.game-project.v1 из задачи или файла JSON.</p>
      ) : running && session ? (
        <iframe
          key={session.id}
          className={`${styles.frame} ${styles.desktop}`}
          style={{ height: 760 }}
          title="Проект игры Kosmora"
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          srcDoc={session.document}
        />
      ) : (
        <p>Исходники готовы к запуску.</p>
      )}
    </section>
  );
}
