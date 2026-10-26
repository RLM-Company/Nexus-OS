"use client";

import { useState } from "react";
import { SitesWorkbench } from "../sites/sites-workbench";
import styles from "../sites/sites.module.css";

export function GamesWorkbench(props: {
  projects: { id: string; title: string; status: string }[];
  initialProjectId: string | null;
}) {
  const [kind, setKind] = useState<"game_project" | "game">("game_project");
  return (
    <div className={styles.root}>
      <div className={styles.toolbar} role="group" aria-label="Режим разработки игр">
        <button
          type="button"
          aria-pressed={kind === "game_project"}
          onClick={() => setKind("game_project")}
        >
          Разработка игры
        </button>
        <button type="button" aria-pressed={kind === "game"} onClick={() => setKind("game")}>
          Готовые механики
        </button>
      </div>
      <SitesWorkbench key={kind} {...props} kind={kind} />
    </div>
  );
}
