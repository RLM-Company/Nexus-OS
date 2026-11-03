import type { ContextMemoryBundle, ModelMessage } from "@cosmora/contracts";
import { assertContextMemoryComplete, fitContextMemory } from "./context-memory.js";
import { ContextTooLargeError, estimateInputTokensUpperBound } from "./conversation-window.js";

/** A pure renderer must place the compact memory JSON verbatim in a user message.
 * All other fields are mandatory and remain unchanged across renders. The framing
 * may depend on memory being present, but not on the particular selected entries.
 */
export function fitContextMessages(options: {
  render: (memory: ContextMemoryBundle | undefined) => ModelMessage[];
  memory: ContextMemoryBundle | undefined;
  inputBudget: number;
  query: string;
}): { messages: ModelMessage[]; memory: ContextMemoryBundle | undefined } {
  const { render, memory, inputBudget, query } = options;
  if (!Number.isSafeInteger(inputBudget) || inputBudget < 0)
    throw new RangeError("Invalid input context budget");
  assertContextMemoryComplete(memory);
  const base = render(undefined);
  if (estimateInputTokensUpperBound(base) > inputBudget) throw new ContextTooLargeError();
  if (!memory?.items.length) return { messages: base, memory: undefined };

  const contains = (messages: ModelMessage[], value: ContextMemoryBundle) =>
    messages.some((m) => m.role === "user" && m.content.includes(JSON.stringify(value)));
  const full = render(memory);
  if (!contains(full, memory)) throw new Error("MEMORY_SERIALIZATION_MISMATCH");
  // Work JSON embeds this exact object; account for the envelope and conditional
  // rules as well as all mandatory materials/results and image reservations.
  const framing = estimateInputTokensUpperBound(full) - Buffer.byteLength(JSON.stringify(memory));
  const fitted = fitContextMemory(memory, inputBudget - framing, query);
  if (!fitted) return { messages: base, memory: undefined };
  const messages = render(fitted);
  if (!contains(messages, fitted)) throw new Error("MEMORY_SERIALIZATION_MISMATCH");
  if (estimateInputTokensUpperBound(messages) > inputBudget) throw new ContextTooLargeError();
  return { messages, memory: fitted };
}
