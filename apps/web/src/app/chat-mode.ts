export type GreetingPeriod = "all" | "morning" | "day" | "evening" | "night";

type Greeting = {
  text: string;
  baseWeight: number;
  period: GreetingPeriod;
};

const GREETINGS: Greeting[] = [
  { text: "Чем могу помочь?", baseWeight: 1.3, period: "all" },
  { text: "С чего начнём?", baseWeight: 1.15, period: "all" },
  { text: "Над чем поработаем?", baseWeight: 1.1, period: "all" },
  { text: "Что хотите узнать?", baseWeight: 1, period: "all" },
  { text: "Что хотите сделать?", baseWeight: 1, period: "all" },
  { text: "О чём поговорим?", baseWeight: 0.9, period: "all" },
  { text: "Какую задачу разберём?", baseWeight: 1, period: "all" },
  { text: "Что сейчас важнее всего?", baseWeight: 0.85, period: "all" },
  { text: "Доброе утро. С чего начнём?", baseWeight: 1.2, period: "morning" },
  { text: "Что создадим сегодня?", baseWeight: 1, period: "morning" },
  { text: "Какой вопрос решим сейчас?", baseWeight: 1.05, period: "day" },
  { text: "Куда направим внимание?", baseWeight: 0.9, period: "day" },
  { text: "Добрый вечер. Что обсудим?", baseWeight: 1.15, period: "evening" },
  { text: "Подведём итоги или начнём новое?", baseWeight: 0.9, period: "evening" },
  { text: "Ещё не спите? Что разберём?", baseWeight: 1, period: "night" },
  { text: "Ночная идея? Давайте посмотрим.", baseWeight: 0.85, period: "night" }
];

export const GREETING_TEXTS = GREETINGS.map((greeting) => greeting.text);

const periodAt = (hour: number): Exclude<GreetingPeriod, "all"> => {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "day";
  if (hour >= 18 && hour < 24) return "evening";
  return "night";
};

const seededUnit = (seed: number, index: number): number => {
  let value = (seed ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return ((value >>> 0) + 1) / 4_294_967_297;
};

/**
 * Weighted exponential race: Rᵢ = -ln(Uᵢ) / (Bᵢ × Tᵢ × Nᵢ).
 * The smallest race value wins. Time fit raises T; an immediate repeat lowers N.
 */
export const chooseGreeting = ({
  seed,
  hour,
  previous
}: {
  seed: number;
  hour: number;
  previous: string | null;
}): string => {
  const currentPeriod = periodAt(hour);
  let winner = GREETINGS[0]?.text ?? "Чем могу помочь?";
  let winningRace = Number.POSITIVE_INFINITY;

  GREETINGS.forEach((greeting, index) => {
    const timeFit = greeting.period === "all" ? 1 : greeting.period === currentPeriod ? 1.9 : 0;
    const novelty = greeting.text === previous ? 0 : 1;
    const weight = greeting.baseWeight * timeFit * novelty;
    const race = -Math.log(seededUnit(seed, index)) / weight;
    if (race < winningRace) {
      winner = greeting.text;
      winningRace = race;
    }
  });

  return winner;
};

export type TaskComplexity = {
  score: number;
  requiresProject: boolean;
  reasons: string[];
};

const includes = (text: string, pattern: RegExp): boolean => pattern.test(text);

/**
 * C = 6I + 2S + 2E + 2K + 2A + L + M. A project is suggested when C >= 5.
 * I: explicit project intent; S: broad delivery scope; E: staged work;
 * K: several technical/business systems; A: team coordination;
 * L: long brief; M: multiple requested outcomes.
 */
export const assessTaskComplexity = (content: string): TaskComplexity => {
  const normalized = content.toLocaleLowerCase("ru").replace(/\s+/g, " ").trim();
  const explicitProjectIntent = includes(
    normalized,
    /(?:создай|создать|оформи|оформить|открой|открыть|запусти|запустить).{0,28}проект|как проект/u
  );
  const broadScope = includes(
    normalized,
    /(?:разработай|разработать|реализуй|реализовать|построй|построить|запусти|запустить|перенеси|перенести|приложение|платформ[ау]|сервис|сайт)/u
  );
  const stagedWork = includes(
    normalized,
    /(?:сначала|затем|после этого|этап(?:а|ов|ы)?|пошагов|до конца|полностью|план(?:ом|а)?)/u
  );
  const systemMatches = [
    /(?:api|интеграц)/u,
    /(?:баз[ауые]|данн(?:ых|ые)|хранилищ)/u,
    /(?:авторизац|аутентификац|доступ)/u,
    /(?:frontend|фронтенд|интерфейс|дизайн)/u,
    /(?:backend|бэкенд|сервер)/u,
    /(?:тест|ci|e2e|провер)/u,
    /(?:релиз|production|продакшн|деплой)/u,
    /(?:оплат|финанс|биллинг)/u
  ].filter((pattern) => pattern.test(normalized)).length;
  const severalSystems = systemMatches >= 2;
  const agentCoordination = includes(
    normalized,
    /(?:команд[ауеы]|агент(?:а|ов|ы)?|мультиагент|менеджер|делегир|параллельн)/u
  );
  const wordCount = normalized ? normalized.split(" ").length : 0;
  const longBrief = wordCount >= 34;
  const outcomeCount = normalized.match(
    /(?:сделай|создай|добавь|убери|проверь|подготовь|настрой|реализуй|разработай|адаптируй)/gu
  )?.length;
  const multipleOutcomes = (outcomeCount ?? 0) >= 2;

  const score =
    Number(explicitProjectIntent) * 6 +
    Number(broadScope) * 2 +
    Number(stagedWork) * 2 +
    Number(severalSystems) * 2 +
    Number(agentCoordination) * 2 +
    Number(longBrief) +
    Number(multipleOutcomes);
  const reasons = [
    explicitProjectIntent ? "вы прямо упомянули проект" : null,
    broadScope ? "нужен законченный результат" : null,
    stagedWork ? "есть несколько этапов" : null,
    severalSystems ? "затронуто несколько систем" : null,
    agentCoordination ? "потребуется координация ролей" : null,
    longBrief ? "задача содержит развёрнутый контекст" : null,
    multipleOutcomes ? "запрошено несколько результатов" : null
  ].filter((reason): reason is string => reason !== null);

  return { score, requiresProject: score >= 5, reasons };
};
