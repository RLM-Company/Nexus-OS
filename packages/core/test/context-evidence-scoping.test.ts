import { describe, expect, it } from "vitest";
import { selectContextScope } from "../src/context-evidence-selection.js";
import type { ContextMemoryEvidence } from "@cosmora/contracts";

const evidence = (
  reference: string,
  title: string,
  text: string,
  overrides: Partial<ContextMemoryEvidence> & { owner?: string; deleted?: boolean } = {}
): ContextMemoryEvidence & { owner?: string; deleted?: boolean } => ({
  reference,
  kind: "memory",
  memory_kind: "decision",
  title,
  text,
  source: null,
  excerpt_only: false,
  ...overrides
});

describe("context evidence scoping for the assembled model context", () => {
  it("drops foreign-owner material before packing", () => {
    const items = [
      evidence("M:self", "Решение", "Своё решение", { owner: "A" }),
      evidence("M:foreign", "Решение", "Чужое решение", { owner: "B", version: 99 })
    ];
    expect(selectContextScope(items, { owner: "A" }).map((i) => i.reference)).toEqual(["M:self"]);
  });

  it("prefers the newest revision of the same subject", () => {
    const items = [
      evidence("M:old", "Решение по таймерам", "Старое решение", { version: 1, priority: true }),
      evidence("M:new", "Решение по таймерам", "Новое решение", { version: 4, priority: true })
    ];
    expect(selectContextScope(items, { owner: "A" }).map((i) => i.reference)).toEqual(["M:new"]);
  });

  it("drops deleted sources and unmatched lookalikes", () => {
    const items = [
      evidence("M:deleted", "Черновик", "Удалённый черновик", { deleted: true, matched: true }),
      evidence("M:answer", "Ответ", "Прямой ответ", { matched: true }),
      evidence("M:similar", "Похожее", "Тематически близко, но не ответ", { matched: false })
    ];
    const selected = selectContextScope(items, { owner: "A" });
    expect(selected.map((i) => i.reference)).toEqual(["M:answer"]);
  });

  it("keeps mandatory constraints even when no query matched", () => {
    const items = [
      evidence("M:constraint", "Ограничение", "Не выдумывать метрики", {
        memory_kind: "constraint",
        priority: true
      }),
      evidence("M:similar", "Похожее", "Не ответ", { matched: false })
    ];
    expect(selectContextScope(items, { owner: "A" }).map((i) => i.reference)).toEqual([
      "M:constraint"
    ]);
  });
});
