import {
  parseGameProject,
  validateGameProjectFiles,
  type GameProject
} from "@cosmora/contracts/game-project";
import {
  GAME_PROJECT_V2_FORMAT,
  parseGameProjectV2,
  type GameProjectV2
} from "@cosmora/contracts/game-project-v2";

export type GameProjectSources = { files: GameProject["files"]; v2?: GameProjectV2 };

export function readGameSources(source: string): GameProjectSources {
  if (source.includes(GAME_PROJECT_V2_FORMAT)) {
    const value = JSON.parse(source) as { format?: unknown } | null;
    if (value?.format === GAME_PROJECT_V2_FORMAT) {
      const v2 = parseGameProjectV2(source);
      return {
        v2,
        files: validateGameProjectFiles([
          { name: "scene.html", content: v2.files.scene_html },
          { name: "styles.css", content: v2.files.styles_css },
          { name: "game.js", content: v2.files.game_js }
        ])
      };
    }
  }
  return parseGameProject(source);
}
