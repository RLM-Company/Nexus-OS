import type { ContextMemoryBundle, ModelMessage } from "@cosmora/contracts";

// Independent behavior baseline: production algorithms at f106571e, retained
// only for differential regression tests and the comparative benchmark.
export function legacyFitContextMemory(bundle: ContextMemoryBundle, available: number) {
  const incomplete = () => {
    const error = new Error("Required memory omitted");
    error.name = "MemoryContextIncompleteError";
    throw error;
  };
  if (bundle.priority_omitted) incomplete();
  const measure = (items: ContextMemoryBundle["items"]) => {
    const value = {
      ...bundle,
      items,
      omitted: bundle.omitted + bundle.items.length - items.length,
      bytes: 0
    };
    for (let i = 0; i < 4; i++)
      value.bytes = new TextEncoder().encode(JSON.stringify(value)).length;
    return value;
  };
  const priority = (item: ContextMemoryBundle["items"][number]) =>
    item.priority || item.memory_kind === "constraint";
  const ordered = [...bundle.items].sort(
    (a, b) => Number(Boolean(priority(b))) - Number(Boolean(priority(a)))
  );
  let selected: ContextMemoryBundle["items"] = [];
  for (const item of ordered) {
    const candidate = [...selected, item];
    if (measure(candidate).bytes <= available) selected = candidate;
    else if (priority(item)) incomplete();
  }
  return selected.length ? measure(selected) : undefined;
}

export function legacyConversationWindow(
  prefix: ModelMessage[],
  conversation: ModelMessage[],
  budget: number
) {
  const estimate = (messages: ModelMessage[]) =>
    messages.reduce(
      (sum, m) =>
        sum + new TextEncoder().encode(m.content).length + 8 + (m.images?.length ?? 0) * 16384,
      0
    );
  const groups: ModelMessage[][] = [];
  for (const message of conversation) {
    if (message.role === "user" || groups.length === 0) groups.push([]);
    groups.at(-1)!.push(message);
  }
  let remaining = budget - estimate(prefix) - 256;
  const selected: ModelMessage[][] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const size = estimate(groups[i]!);
    if (size > remaining) {
      if (!selected.length) {
        const error = new Error();
        throw error;
      }
      break;
    }
    selected.unshift(groups[i]!);
    remaining -= size;
  }
  if (groups.length > selected.length && prefix[0]?.role === "system") {
    prefix = prefix.map((m, i) =>
      i === 0
        ? {
            ...m,
            content:
              m.content +
              "\nРанние сообщения не вошли в текущий контекст. Не утверждай, что помнишь их содержание; при необходимости попроси уточнение."
          }
        : m
    );
  }
  return [...prefix, ...selected.flat()];
}
