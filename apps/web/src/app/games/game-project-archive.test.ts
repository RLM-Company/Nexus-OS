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
  const entries: Record<string, Uint8Array> = {};
  for (const [name, value] of Object.entries(files)) entries[name] = strToU8(value);
  return zipSync(entries);
};

it("restores the exact source package from a matching exported archive", () => {
  expect(readGameProjectArchive(archive())).toBe(source);
});

it("rejects mismatch between project.json and individual source files", () => {
  const mismatch = archive({ "game.js": "game.onUpdate = () => { alert(1); }" });
  expect(() => readGameProjectArchive(mismatch)).toThrow("INVALID_GAME_ARCHIVE");
});

it("rejects extra paths, missing files, non-zip input, and inflated oversized entries", () => {
  const unexpected = archive({ "../unsafe.js": "data" });
  expect(() => readGameProjectArchive(unexpected)).toThrow("INVALID_GAME_ARCHIVE");
  const incomplete = zipSync({ "project.json": strToU8(source) });
  expect(() => readGameProjectArchive(incomplete)).toThrow("INVALID_GAME_ARCHIVE");
  expect(() => readGameProjectArchive(strToU8("not a zip"))).toThrow("INVALID_GAME_ARCHIVE");
  const oversized = archive({ "scene.html": "X".repeat(65000) });
  expect(() => readGameProjectArchive(oversized)).toThrow("INVALID_GAME_ARCHIVE");
  const oversizedArchive = new Uint8Array(GAME_ARCHIVE_MAX_BYTES + 1);
  expect(() => readGameProjectArchive(oversizedArchive)).toThrow("INVALID_GAME_ARCHIVE");
});
