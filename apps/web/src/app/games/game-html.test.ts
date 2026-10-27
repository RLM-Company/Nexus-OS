import { Script } from "node:vm";
import { expect, it } from "vitest";
import type { GamePackage } from "@cosmora/contracts/game-package";
import { createGameHtml } from "./game-html";

const game: GamePackage = {
  format: "kosmora.game.v1",
  title: '</script><img src="https://invalid.test">',
  description: "Только текст & Unicode\u2028",
  genre: "memory",
  pairs: ["A", "B", "C", "D"]
};
it("embeds only escaped JSON and a fixed syntactically valid runtime", () => {
  const html = createGameHtml(game, true, "a".repeat(32));
  expect(html.match(/<script\b/g)).toHaveLength(2);
  expect(html).not.toContain('<img src="https://invalid.test">');
  expect(html).toContain("\\u003c/script\\u003e");
  expect(html).toContain("connect-src 'none'");
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  expect(JSON.parse(scripts[0]![2]!)).toEqual(game);
  expect(() => new Script(scripts[1]![2]!)).not.toThrow();
});
it("does not let callers inject a nonce or bypass data validation", () => {
  expect(() => createGameHtml(game, false, '" onload=evil')).toThrow("INVALID_GAME_NONCE");
  expect(() => createGameHtml({ ...game, pairs: ["A"] })).toThrow("INVALID_GAME_RESULT");
});
