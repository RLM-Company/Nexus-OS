import { strToU8, zipSync } from "fflate";
import { expect, it } from "vitest";
import { readGameProjectArchive, GAME_ARCHIVE_MAX_BYTES } from "./game-project-archive";

const sources = {
  "scene.html": "<h1>Сцена</h1>\n",
  "styles.css": "#game-stage { width: 800px; }\n",
  "game.js": "game.onUpdate = () => {};\n"
};
const source = JSON.stringify({
  format: "kosmora.game-project.v1",
  files: Object.entries(sources).map(([name, content]) => ({ name, content }))
});
const archive = (replace: Record<string, string> = {}) => {
  const files = {
    ...sources,
    "README.txt": "Kosmora source export",
    "index.html": "<!doctype html><html></html>",
    "project.json": source,
    ...replace
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, value]) => [name, strToU8(value)])));
};

it("restores the exact source package from a matching exported archive", () => {
  expect(readGameProjectArchive(archive())).toBe(source);
});

it("rejects mismatch between project.json and individual source files", () => {
  expect(() => readGameProjectArchive(archive({ "game.js": "game.onUpdate = () => { alert(1); }" })))
    .toThrow("INVALID_GAME_ARCHIVE");
});

it("rejects extra paths, missing files, non-zip input, and inflated oversized entries", () => {
  expect(() => readGameProjectArchive(archive({ "../unsafe.js": "data" })))
    .toThrow("INVALID_GAME_ARCHIVE");
  const incomplete = zipSync({ "project.json": strToU8(source) });
  expect(() => readGameProjectArchive(incomplete)).toThrow("INVALID_GAME_ARCHIVE");
  expect(() => readGameProjectArchive(strToU8("not a zip"))).toThrow("INVALID_GAME_ARCHIVE");
  expect(() => readGameProjectArchive(archive({ "scene.html": "X".repeat(65000) })))
    .toThrow("INVALID_GAME_ARCHIVE");
  expect(() => readGameProjectArchive(new Uint8Array(GAME_ARCHIVE_MAX_BYTES + 1)))
    .toThrow("INVALID_GAME_ARCHIVE");
});
