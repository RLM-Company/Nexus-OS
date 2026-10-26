import { expect, it } from "vitest";
import { parseGameProject, validateGameProjectFiles } from "../src/game-project.js";

const files = [
  { name: "game.js", content: "game.onUpdate=()=>{};" },
  { name: "styles.css", content: "body{}" },
  { name: "scene.html", content: "<h1>Игра</h1>" }
];
it("preserves custom source bytes and canonicalizes paths without executing anything", () => {
  const result = parseGameProject(JSON.stringify({ format: "kosmora.game-project.v1", files }));
  expect(result.files.map((item) => item.name)).toEqual(["scene.html", "styles.css", "game.js"]);
  expect(result.files[2]!.content).toBe(files[0]!.content);
});
it.each([
  files.slice(1),
  [...files, { name: "other.js", content: "x" }],
  files.map((item) => ({ ...item, name: "game.js" })),
  files.map((item) => (item.name === "game.js" ? { ...item, name: "../game.js" } : item)),
  files.map((item) => ({ ...item, content: " " })),
  files.map((item) => ({ ...item, content: "я".repeat(32001) })),
  files.map((item) => ({ ...item, content: "x".repeat(50000) })),
  files.map((item) => ({ ...item, content: "\0" })),
  files.map((item) => ({ ...item, execute: true }))
])("rejects incomplete, unsafe or oversized bundles", (value) => {
  expect(() => validateGameProjectFiles(value)).toThrow("INVALID_GAME_PROJECT_RESULT");
});
it("rejects wrong format and malformed JSON", () => {
  expect(() => parseGameProject("{")).toThrow();
  expect(() => parseGameProject(JSON.stringify({ format: "wrong", files }))).toThrow();
  expect(() =>
    parseGameProject(JSON.stringify({ format: "kosmora.game-project.v1", files, run: true }))
  ).toThrow();
});
