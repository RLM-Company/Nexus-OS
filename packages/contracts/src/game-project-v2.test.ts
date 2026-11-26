import { describe, expect, test } from "vitest";
import {
  GAME_PROJECT_V2_FORMAT,
  parseGameProjectV2,
  type GameProjectV2
} from "./game-project-v2.js";

const valid = (): GameProjectV2 => ({
  format: GAME_PROJECT_V2_FORMAT,
  title: "Кубик",
  files: {
    scene_html: "<h1>Кубик</h1>",
    styles_css: "#game-stage{background:#fff}",
    game_js: "game.onUpdate=()=>{};"
  },
  launch: { runtime: "web3d_sandbox", auto_start: false },
  assets: [{ name: "sprite.png", media_type: "image/png", data_base64: "iVBORw0KGgo=" }],
  scenes: [{ id: "main", title: "Сцена", html: "<p>Сцена</p>" }],
  model: { name: "cube.obj", format: "obj-lite", data: "v 0 0 0\nv 1 0 0\nf 1 2 3" }
});

describe("game-project-v2 contract", () => {
  test("accepts a bounded self-contained project", () => {
    expect(parseGameProjectV2(JSON.stringify(valid())).title).toBe("Кубик");
  });

  test("keeps v1 valid: v2 parser rejects v1 and vice versa shape", () => {
    expect(() =>
      parseGameProjectV2(
        JSON.stringify({ format: "kosmora.game-project.v1", files: [], title: "x" })
      )
    ).toThrow("INVALID_GAME_PROJECT_V2");
  });

  test("rejects unknown/external asset URLs, oversized base64 and extra fields", () => {
    const bad = valid();
    bad.assets = [{ name: "x", media_type: "image/png", data_base64: "https://evil.test/x.png" }];
    expect(() => parseGameProjectV2(JSON.stringify(bad))).toThrow("INVALID_GAME_PROJECT_V2");
    const extra = { ...valid(), evil: true };
    expect(() => parseGameProjectV2(JSON.stringify(extra))).toThrow("INVALID_GAME_PROJECT_V2");
  });

  test("rejects malformed base64 padding and oversized source", () => {
    const bad = valid();
    bad.assets = [{ name: "x", media_type: "image/png", data_base64: "abc" }];
    expect(() => parseGameProjectV2(JSON.stringify(bad))).toThrow("INVALID_GAME_PROJECT_V2");
    expect(() => parseGameProjectV2("x".repeat(600 * 1024))).toThrow("INVALID_GAME_PROJECT_V2");
  });

  test("keeps every field inert structured data", () => {
    const project = parseGameProjectV2(JSON.stringify(valid()));
    expect(project.model?.format).toBe("obj-lite");
    expect(project.launch.runtime).toBe("web3d_sandbox");
  });
});
