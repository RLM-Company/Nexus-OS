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
export const DEFAULT_CONTEXT_BUDGET = 28000;
const HISTORY_WARNING =
  "\nРанние сообщения не вошли в текущий контекст. Не утверждай, что помнишь их содержание; при необходимости попроси уточнение.";
const HISTORY_WARNING_BYTES = new TextEncoder().encode(HISTORY_WARNING).length;

/** Legacy standalone callers keep their old budget; production uses its selected route. */
export function modelInputContextBudget(
  contextWindowTokens: number | undefined,
  maxOutputTokens: number
): number {
  if (contextWindowTokens === undefined) return DEFAULT_CONTEXT_BUDGET;
  if (
    !Number.isSafeInteger(contextWindowTokens) ||
    contextWindowTokens < 1 ||
    !Number.isSafeInteger(maxOutputTokens) ||
    maxOutputTokens < 1
  )
    throw new Error("Invalid model context window");
  // Leave room for the live clock and owner profile/Relay framing added after packing.
  const reserve = Math.min(4096, Math.floor(contextWindowTokens / 10));
  const available = contextWindowTokens - maxOutputTokens - reserve;
  if (available < 512)
    throw new Error("Model context window cannot fit the configured output reservation");
  return available;
}

export function conversationWindow(
  prefix: ModelMessage[],
  conversation: ModelMessage[],
  budget = DEFAULT_CONTEXT_BUDGET
): ModelMessage[] {
  if (!Number.isSafeInteger(budget) || budget < 0) throw new RangeError("Invalid context budget");
  const prefixSize = estimateInputTokensUpperBound(prefix);
  if (prefixSize > budget) throw new ContextTooLargeError();
  const groups: ModelMessage[][] = [];
  for (const message of conversation) {
    if (message.role === "user" || groups.length === 0) groups.push([]);
    groups.at(-1)!.push(message);
  }
  let remaining = budget - prefixSize - 256;
  let selectedSize = 0;
  const selected: { messages: ModelMessage[]; size: number }[] = [];
  for (let index = groups.length - 1; index >= 0; index--) {
    const group = groups[index]!;
    const size = estimateInputTokensUpperBound(group);
    if (size > remaining) {
      if (selected.length === 0) throw new ContextTooLargeError();
      break;
    }
    selected.push({ messages: group, size });
    selectedSize += size;
    remaining -= size;
  }
  if (groups.length > selected.length && prefix[0]?.role === "system") {
    prefix = prefix.map((message, index) =>
      index === 0
        ? {
            ...message,
            content: message.content + HISTORY_WARNING
          }
        : message
    );
    // Existing headroom covers today's warning. Keep the output bound explicit
    // if that text grows later, removing only complete oldest selected groups.
    while (prefixSize + selectedSize + HISTORY_WARNING_BYTES > budget) {
      if (selected.length <= 1) throw new ContextTooLargeError();
      selectedSize -= selected.pop()!.size;
    }
  }
  return [...prefix, ...selected.reverse().flatMap((group) => group.messages)];
}
