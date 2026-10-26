export type GameGenre = "arcade" | "memory" | "quiz";
type BaseGame = { format: "kosmora.game.v1"; title: string; description: string };
export type GamePackage = BaseGame &
  (
    | {
        genre: "arcade";
        duration_seconds: number;
        target_score: number;
        speed: number;
        collectible: string;
      }
    | { genre: "memory"; pairs: string[] }
    | { genre: "quiz"; questions: { prompt: string; choices: string[]; answer_index: number }[] }
  );
export const GAME_MAX_BYTES = 64 * 1024;
const fail = (): never => {
  throw Error("INVALID_GAME_RESULT");
};
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fail();
const keys = (value: Record<string, unknown>, names: string[]) => {
  if (Object.keys(value).sort().join(",") !== names.sort().join(",")) fail();
};
const text = (value: unknown, max: number): string => {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return (code < 32 && ![9, 10, 13].includes(code)) || code === 127;
    }) ||
    !value.isWellFormed()
  )
    return fail();
  return value;
};
const integer = (value: unknown, min: number, max: number): number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max
    ? value
    : fail();
const array = (value: unknown, min: number, max: number): unknown[] =>
  Array.isArray(value) && value.length >= min && value.length <= max
    ? (value as unknown[])
    : fail();
const unique = (values: string[]) => {
  if (
    new Set(values.map((value) => value.trim().normalize("NFC").toLocaleLowerCase("en"))).size !==
    values.length
  )
    fail();
};

/** Data only. No HTML, script, URLs, permissions or runtime code are accepted as fields. */
export function parseGamePackage(source: string, expectedGenre?: GameGenre): GamePackage {
  if (new TextEncoder().encode(source).length > GAME_MAX_BYTES) return fail();
  let decoded: unknown;
  try {
    decoded = JSON.parse(source.replace(/^\uFEFF/, ""));
  } catch {
    return fail();
  }
  const value = object(decoded);
  if (value.format !== "kosmora.game.v1" || (expectedGenre && value.genre !== expectedGenre))
    return fail();
  const base: BaseGame = {
    format: "kosmora.game.v1",
    title: text(value.title, 100),
    description: text(value.description, 600)
  };
  const common = ["format", "title", "description", "genre"];
  if (value.genre === "arcade") {
    keys(value, [...common, "duration_seconds", "target_score", "speed", "collectible"]);
    const duration = integer(value.duration_seconds, 20, 120),
      target = integer(value.target_score, 3, 30);
    if (target > Math.floor(duration / 2)) return fail();
    return {
      ...base,
      genre: "arcade",
      duration_seconds: duration,
      target_score: target,
      speed: integer(value.speed, 1, 5),
      collectible: text(value.collectible, 40)
    };
  }
  if (value.genre === "memory") {
    keys(value, [...common, "pairs"]);
    const pairs = array(value.pairs, 4, 8).map((item) => text(item, 32));
    unique(pairs);
    return { ...base, genre: "memory", pairs };
  }
  if (value.genre === "quiz") {
    keys(value, [...common, "questions"]);
    const questions = array(value.questions, 3, 10).map((item) => {
      const question = object(item);
      keys(question, ["prompt", "choices", "answer_index"]);
      const choices = array(question.choices, 2, 4).map((choice) => text(choice, 120));
      unique(choices);
      return {
        prompt: text(question.prompt, 300),
        choices,
        answer_index: integer(question.answer_index, 0, choices.length - 1)
      };
    });
    unique(questions.map((question) => question.prompt));
    return { ...base, genre: "quiz", questions };
  }
  return fail();
}

export function gameOutputInstruction(genre: GameGenre): string {
  const examples = {
    arcade: { duration_seconds: 45, target_score: 10, speed: 2, collectible: "звёзды" },
    memory: { pairs: ["Орбита", "Комета", "Луна", "Марс"] },
    quiz: {
      questions: [
        { prompt: "Сколько будет 2 + 2?", choices: ["3", "4", "5"], answer_index: 1 },
        { prompt: "Сколько дней в неделе?", choices: ["5", "7"], answer_index: 1 },
        { prompt: "Что является спутником Земли?", choices: ["Луна", "Марс"], answer_index: 0 }
      ]
    }
  };
  const example = {
    format: "kosmora.game.v1",
    title: "Название игры",
    description: "Тема и правила",
    genre,
    ...examples[genre]
  };
  return `Game output contract: return exactly one game.json inside the normal files JSON envelope. Its content is a JSON string matching this DATA schema: ${JSON.stringify(example)}. Adapt theme and content to the owner's goal. No extra keys, code, HTML, external resources or claims of hosting. The built-in trusted engine implements the mechanics: arcade moves a collector left/right, catches falling circles and avoids crosses; memory flips matching text pairs; quiz selects one correct choice per question. Keep description consistent with those mechanics. Arcade: duration_seconds integer 20..120, target_score integer 3..30 and <= duration_seconds/2, speed integer 1..5. Memory: 4..8 distinct short pair labels. Quiz: 3..10 distinct questions with 2..4 distinct choices and a zero-based valid answer_index. Title <=100 characters, description <=600. Strings are plain text, not markup. Produce complete useful game data, not a coding plan.`;
}
