"use client";

import { useMemo, useState } from "react";
import { parseGamePackage } from "@cosmora/contracts/game-package";
import { createGameHtml } from "./game-html";
import styles from "../sites/sites.module.css";

export function GamePreview({ content }: { content: string }) {
  const parsed = useMemo(() => {
    if (!content.trim()) return null;
    try {
      return { game: parseGamePackage(content) };
    } catch {
      return {
        error:
          "JSON игры пока не соответствует выбранному формату. Исправьте данные перед запуском."
      };
    }
  }, [content]);
  const [session, setSession] = useState<{ source: string; document: string } | null>(null);
  const game = parsed && "game" in parsed ? parsed.game : null;
  const running = !!game && session?.source === content;
  const download = () => {
    if (!game) return;
    const url = URL.createObjectURL(
      new Blob([createGameHtml(game)], { type: "text/html;charset=utf-8" })
    );
    const link = document.createElement("a");
    link.href = url;
    link.download =
      (game.title.replace(/[^\p{L}\p{N}_.-]+/gu, "-").slice(0, 60) || "game") + ".html";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  };
  return (
    <section className={styles.preview} aria-label="Игровой прототип">
      <div className={styles.toolbar}>
        <button
          type="button"
          disabled={!game}
          onClick={() => {
            if (game) setSession({ source: content, document: createGameHtml(game, true) });
          }}
        >
          {running ? "Перезапустить прототип" : "Играть"}
        </button>
        <button type="button" disabled={!running} onClick={() => setSession(null)}>
          Остановить прототип
        </button>
        <button type="button" disabled={!game} onClick={download}>
          Скачать игру HTML
        </button>
      </div>
      <p className={styles.caption}>
        Встроенный движок · запуск без новых запросов к ИИ. Изменение JSON останавливает текущую
        игру.
      </p>
      {!parsed ? (
        <p>Создайте прототип с ИИ или откройте сохранённый game.json.</p>
      ) : "error" in parsed ? (
        <p role="status">{parsed.error}</p>
      ) : running && session ? (
        <iframe
          className={`${styles.frame} ${styles.desktop}`}
          style={{ height: 720 }}
          title="Игра Kosmora"
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          srcDoc={session.document}
        />
      ) : (
        <p>«{game?.title}» готова к запуску.</p>
      )}
    </section>
  );
}
