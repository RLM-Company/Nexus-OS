import { expect, it } from "vitest";
import { parseGamePackage, gameOutputInstruction, type GamePackage } from "../src/game-package.js";

const base = {
  format: "kosmora.game.v1" as const,
  title: "Орбита",
  description: "Соберите предметы"
};
const arcade: GamePackage = {
  ...base,
  genre: "arcade",
  duration_seconds: 40,
  target_score: 8,
  speed: 2,
  collectible: "звёзды"
};
it("accepts bounded game data and enforces the requested mechanic", () => {
  expect(parseGamePackage(JSON.stringify(arcade), "arcade")).toEqual(arcade);
  expect(
    parseGamePackage(JSON.stringify({ ...base, genre: "memory", pairs: ["A", "B", "C", "D"] }))
      .genre
  ).toBe("memory");
  expect(() => parseGamePackage(JSON.stringify(arcade), "quiz")).toThrow("INVALID_GAME_RESULT");
  expect(gameOutputInstruction("arcade")).toContain('"target_score":10');
});
it.each([
  { ...arcade, script: "fetch('/private')" },
  { ...arcade, speed: 99 },
  { ...arcade, duration_seconds: 20, target_score: 30 },
  { ...base, genre: "memory", pairs: ["A", "a", "B", "C"] },
  { ...base, genre: "memory", pairs: ["é", "e\u0301", "B", "C"] },
  {
    ...base,
    genre: "quiz",
    questions: Array.from({ length: 3 }, (_, i) => ({
      prompt: "Q" + i,
      choices: ["A", "B"],
      answer_index: 2
    }))
  },
  { ...arcade, title: "x".repeat(100000) }
])("rejects unsafe or unplayable package structure: %j", (value) => {
  expect(() => parseGamePackage(JSON.stringify(value))).toThrow("INVALID_GAME_RESULT");
});
