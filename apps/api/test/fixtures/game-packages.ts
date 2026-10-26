import type { GameGenre, GamePackage } from "@cosmora/contracts/game-package";

export const GAME_FIXTURES: Record<GameGenre, GamePackage> = {
  arcade: {
    format: "kosmora.game.v1",
    title: "Орбитальный сборщик",
    description: "Собирайте звёзды и избегайте препятствий.",
    genre: "arcade",
    duration_seconds: 40,
    target_score: 8,
    speed: 2,
    collectible: "звёзды"
  },
  memory: {
    format: "kosmora.game.v1",
    title: "Космические пары",
    description: "Найдите одинаковые планеты.",
    genre: "memory",
    pairs: ["Луна", "Марс", "Земля", "Венера"]
  },
  quiz: {
    format: "kosmora.game.v1",
    title: "Космическая викторина",
    description: "Три коротких вопроса.",
    genre: "quiz",
    questions: [
      { prompt: "Сколько будет 2 + 2?", choices: ["3", "4"], answer_index: 1 },
      { prompt: "Сколько дней в неделе?", choices: ["5", "7"], answer_index: 1 },
      { prompt: "Спутник Земли?", choices: ["Луна", "Марс"], answer_index: 0 }
    ]
  }
};
