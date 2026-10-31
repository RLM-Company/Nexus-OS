import type {
  ContextMemoryEntry,
  ContextMemoryInput,
  ContextMemorySource
} from "./context-memory.js";

export interface ProfileCandidate {
  id: string;
  slot: string;
  observed_at: string;
  input: ContextMemoryInput;
  source: ContextMemorySource;
  replaces: Pick<ContextMemoryEntry, "id" | "version" | "title" | "content">[];
  conflicts_limited: boolean;
}
export interface ProfileCandidatePage {
  method: "explicit-owner-quotes-v1";
  items: ProfileCandidate[];
  scanned: number;
  limited: boolean;
  enabled: boolean;
}

/** Deliberately narrow: only explicit standalone owner statements, never an LLM inference. */
export function explicitProfileStatements(content: string) {
  if (
    content.length > 16000 ||
    /```|~~~|(?:пример|цитат|переведи|translate|example|quote)/iu.test(content)
  )
    return [];
  const rules = [
    {
      slot: "name",
      title: "Имя",
      kind: "fact",
      personal: true,
      pattern: /^(?:Меня зовут|My name is)\s+\S/iu
    },
    {
      slot: "response-style",
      title: "Стиль ответа",
      kind: "preference",
      personal: true,
      pattern:
        /^(?:(?:Я предпочитаю|I prefer).*(?:ответ|responses?|answers?)|(?:Отвечай|Пиши|Please respond|Respond|Write)\s+\S)/iu
    },
    {
      slot: "preference",
      title: "Предпочтение",
      kind: "preference",
      personal: true,
      pattern: /^(?:Я предпочитаю|I prefer)\s+\S/iu
    },
    {
      slot: "goal",
      title: "Цель работы",
      kind: "fact",
      personal: false,
      pattern: /^(?:Моя цель|Наша цель|Цель проекта|My goal|Our goal)\s*[:—-]?\s+\S/iu
    },
    {
      slot: "decision",
      title: "Принятое решение",
      kind: "decision",
      personal: false,
      pattern: /^(?:Мы решили|Мы утвердили|Решили|We decided|We agreed)\s+\S/iu
    },
    {
      slot: "constraint",
      title: "Условие работы",
      kind: "constraint",
      personal: false,
      pattern: /^(?:Не меняй|Не изменяй|Не отправляй|Never change|Do not change|Do not send)\s+\S/iu
    }
  ] as const;
  return content
    .split(/\r?\n/)
    .flatMap((line) => {
      const text = line.trim();
      if (text.length < 8 || text.length > 1000 || /[«»“”"]/.test(text)) return [];
      const rule = rules.find((r) => r.pattern.test(text));
      return rule
        ? [{ slot: rule.slot, title: rule.title, kind: rule.kind, personal: rule.personal, text }]
        : [];
    })
    .slice(0, 8);
}
