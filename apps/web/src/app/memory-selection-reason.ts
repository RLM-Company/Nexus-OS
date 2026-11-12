import type { ContextMemoryBundle } from "@cosmora/contracts/context-memory";

/**
 * Why a recalled item is in context. Pure and testable; uses only fields that
 * actually exist on the bundle, never invents a score, confidence or permission.
 */
export const selectionReason = (item: ContextMemoryBundle["items"][number]): string => {
  const reasons: string[] = [];
  if (item.matched) reasons.push("совпало с запросом");
  else if (item.priority || item.memory_kind === "constraint")
    reasons.push("обязательная запись, не ответ на вопрос");
  else reasons.push("тематический контекст, не ответ на вопрос");
  if (item.retrieval_rank !== undefined) reasons.push(`порядок поиска ${item.retrieval_rank}`);
  if (item.source) {
    reasons.push(
      item.source.role === "assistant" ? "источник: ответ ИИ" : "источник: сообщение владельца"
    );
    if (item.source.quote) reasons.push("точная цитата сохранена");
  } else reasons.push("без привязки к исходному сообщению");
  if (item.excerpt_only) reasons.push("неполная выдержка");
  return reasons.join(" · ");
};
