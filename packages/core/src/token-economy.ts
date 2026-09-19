import type { ModelMessage } from "@cosmora/contracts";

export const TOKEN_ECONOMY_MAX_OUTPUT_TOKENS = 360;
export const TOKEN_ECONOMY_CONTEXT_BYTES = 12_000;

const messageBytes = (message: ModelMessage): number =>
  new TextEncoder().encode(message.content).length + 8;

/** Keeps the newest complete turns; the latest turn is never dropped. */
export const compactConversationForTokenEconomy = (
  conversation: ModelMessage[]
): ModelMessage[] => {
  const kept: ModelMessage[] = [];
  let used = 0;
  for (let index = conversation.length - 1; index >= 0; index -= 1) {
    const message = conversation[index];
    if (!message) continue;
    const bytes = messageBytes(message);
    if (kept.length > 0 && used + bytes > TOKEN_ECONOMY_CONTEXT_BYTES) break;
    kept.unshift(message);
    used += bytes;
  }
  return kept;
};

export const TOKEN_ECONOMY_SYSTEM_NOTE =
  "Режим экономии токенов включён: отвечай кратко, без повторов; сначала дай результат, затем только необходимые шаги.";
