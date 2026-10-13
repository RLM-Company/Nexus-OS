import type { ModelMessage } from "@cosmora/contracts";

export class ContextTooLargeError extends Error {
  constructor() {
    super(
      "Последнее сообщение и материалы превышают размер контекста. Сократите текст или число файлов."
    );
  }
}

export const estimateMessageTokens = (message: ModelMessage): number =>
  new TextEncoder().encode(message.content).length + 8 + (message.images?.length ?? 0) * 16384;

export const estimateInputTokensUpperBound = (messages: ModelMessage[]): number =>
  messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0);

export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const chars = text.length;
  return Math.max(Math.ceil(chars / 3.5), Math.ceil(words * 1.3));
}

export interface ContextBudgetUsage {
  usedTokens: number;
  budgetTokens: number;
  percentage: number;
  isCloseToLimit: boolean;
}

export function calculateContextUsage(
  messages: ModelMessage[],
  budget = 28000
): ContextBudgetUsage {
  const usedTokens = estimateInputTokensUpperBound(messages);
  const percentage = Math.min(100, Math.round((usedTokens / budget) * 100));
  return {
    usedTokens,
    budgetTokens: budget,
    percentage,
    isCloseToLimit: percentage >= 80
  };
}

export function conversationWindow(
  prefix: ModelMessage[],
  conversation: ModelMessage[],
  budget = 28000
): ModelMessage[] {
  const groups: ModelMessage[][] = [];
  for (const message of conversation) {
    if (message.role === "user" || groups.length === 0) groups.push([]);
    groups.at(-1)!.push(message);
  }
  let remaining = budget - estimateInputTokensUpperBound(prefix) - 256;
  const selected: ModelMessage[][] = [];
  for (let index = groups.length - 1; index >= 0; index--) {
    const group = groups[index]!;
    const size = estimateInputTokensUpperBound(group);
    if (size > remaining) {
      if (selected.length === 0) throw new ContextTooLargeError();
      break;
    }
    selected.unshift(group);
    remaining -= size;
  }
  if (groups.length > selected.length && prefix[0]?.role === "system") {
    prefix = prefix.map((message, index) =>
      index === 0
        ? {
            ...message,
            content:
              message.content +
              "\nРанние сообщения не вошли в текущий контекст. Не утверждай, что помнишь их содержание; при необходимости попроси уточнение."
          }
        : message
    );
  }
  return [...prefix, ...selected.flat()];
}
