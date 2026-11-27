import { describe, expect, test } from "vitest";
import {
  gameErrorMessage,
  gameSourceVersion,
  mapWorkerErrorToGameLine
} from "./game-error-diagnostic";
import { gameWorkerSource } from "./game-project-runtime";

describe("worker error to game.js source mapping", () => {
  const code = ["game.onUpdate=()=>{", "  game.ctx.fillRect(0,0,1,1);", "};"].join("\n");
  const runtime = gameWorkerSource(code);

  test("maps an error on the first game.js line", () => {
    const preambleLines = runtime.slice(0, runtime.indexOf(code)).split("\n").length - 1;
    const stack = `Error: boom\n    at blob:null/abc:${preambleLines + 1}:9`;
    expect(mapWorkerErrorToGameLine(runtime, code, stack)).toBe(1);
  });

  test("maps an error on a later game.js line", () => {
    const preambleLines = runtime.slice(0, runtime.indexOf(code)).split("\n").length - 1;
    const stack = `TypeError: bad\n    at blob:https://example.test/uuid:${preambleLines + 2}:3`;
    expect(mapWorkerErrorToGameLine(runtime, code, stack)).toBe(2);
  });

  test("never guesses outside the game.js range or without a stack location", () => {
    const preambleLines = runtime.slice(0, runtime.indexOf(code)).split("\n").length - 1;
    expect(mapWorkerErrorToGameLine(runtime, code, "Error: no location")).toBeNull();
    expect(
      mapWorkerErrorToGameLine(runtime, code, `Error: x\n  at blob:x:${preambleLines - 2}:1`)
    ).toBeNull();
    expect(
      mapWorkerErrorToGameLine(runtime, code, `Error: x\n  at blob:x:${preambleLines + 99}:1`)
    ).toBeNull();
  });

  test("returns null if source was modified so it no longer matches the runtime", () => {
    expect(mapWorkerErrorToGameLine(runtime, "different", "Error: x\n  at blob:x:10:1")).toBeNull();
  });

  test("keeps the first stack line bounded", () => {
    expect(gameErrorMessage("Error: boom\n    at x")).toBe("Error: boom");
    expect(gameErrorMessage("")).toBe("Ошибка в game.js");
    expect(gameErrorMessage("x".repeat(1000)).length).toBe(300);
  });

  test("binds a diagnostic to the exact source version and reuses the fixed version on re-run", () => {
    const before = { text: code, version: gameSourceVersion(code) };
    const fixed = "game.onUpdate=()=>{ game.ctx.clearRect(0,0,1,1); };";
    const after = { text: fixed, version: gameSourceVersion(fixed) };
    expect(after.version).not.toBe(before.version);

    // The error was produced by the OLD source; the OLD runtime is the one that maps.
    const oldRuntime = gameWorkerSource(before.text);
    const preambleLines =
      oldRuntime.slice(0, oldRuntime.indexOf(before.text)).split("\n").length - 1;
    const stack = `Error: boom\n    at blob:x:${preambleLines + 2}:3`;
    expect(mapWorkerErrorToGameLine(oldRuntime, before.text, stack)).toBe(2);
    // A stale diagnostic must not be attributed to the fixed version.
    expect(mapWorkerErrorToGameLine(gameWorkerSource(after.text), after.text, stack)).toBeNull();

    // Re-run builds the document from the FIXED source, so the old line no longer maps.
    const newRuntime = gameWorkerSource(after.text);
    expect(newRuntime).toContain(after.text);
    expect(newRuntime).not.toContain("fillRect");
    expect(gameSourceVersion(after.text)).toBe(after.version);
  });
});
