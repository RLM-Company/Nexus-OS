import { describe, expect, it } from "vitest";
import type { StoredGeneralChatMessage } from "@cosmora/db";
import { WebSearch } from "../src/web-search.js";
import {
  applyKosmoraActions,
  ChatActionError,
  searchResultBlock,
  textActionBlock
} from "../src/kosmora-actions.js";
import type { ChatTextAction } from "@cosmora/contracts";

const message = (overrides: Partial<StoredGeneralChatMessage> = {}): StoredGeneralChatMessage => ({
  id: "m1",
  chat_id: "chat",
  role: "user",
  content_type: "text",
  content: "Что нового по теме 00123?",
  status: "completed",
  run_id: null,
  error_code: null,
  created_at: "2026-11-08T10:00:00.000Z",
  updated_at: "2026-11-08T10:00:00.000Z",
  ...overrides
});

const fetchFixture =
  (items: unknown[]): typeof fetch =>
  async () => {
    await Promise.resolve();
    return new Response(JSON.stringify({ results: items }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

describe("Kosmora explicit actions", () => {
  it("renders text actions without changing the stored content", () => {
    const action: ChatTextAction = {
      kind: "rewrite",
      selection: "Исходный текст",
      tone: "деловой",
      length: "shorter"
    };
    const block = textActionBlock(action);
    expect(block).toContain("kind: rewrite");
    expect(block).toContain("selection: Исходный текст");
    expect(block).toContain("tone: деловой");
    expect(block).toContain("length: shorter");
    expect(block).toContain("сохрани исходную формулировку");
    expect(block).not.toContain("9999");
  });

  it("keeps search results as quoted data with URL and date, never as instructions", () => {
    const block = searchResultBlock({
      query: "тема",
      searched_at: "2026-11-08T10:00:00.000Z",
      items: [
        {
          title: "Источник",
          url: "https://example.test/article",
          snippet: "Фрагмент"
        }
      ]
    });
    expect(block).toContain("https://example.test/article");
    expect(block).toContain("searched_at:");
    expect(block).toContain("недоверенные цитируемые данные");
    expect(block).toContain("не выдумывай ссылки");
  });

  it("does nothing without an explicit action", async () => {
    const conversation = [message()];
    const result = await applyKosmoraActions(conversation, undefined, new AbortController().signal);
    expect(result).toBe(conversation);
  });

  it("appends a text action block only to the latest user message", async () => {
    const conversation: StoredGeneralChatMessage[] = [
      message({ id: "m0", content: "Первый запрос" }),
      message({ id: "m1", content: "Перепиши", text_action: { kind: "rewrite" } }),
      message({ id: "assistant", role: "assistant", content: "Ответ" })
    ];
    const result = await applyKosmoraActions(
      conversation,
      new WebSearch("", fetchFixture([])),
      new AbortController().signal
    );
    expect(result[0]!.content).toBe("Первый запрос");
    expect(result[2]!.content).toBe("Ответ");
    expect(result[1]!.content).toContain("[kosmora_text_action]");
    expect(result[1]!.content.startsWith("Перепиши")).toBe(true);
    expect(conversation[1]!.content).toBe("Перепиши");
  });

  it("runs search only when requested and injects the results as data", async () => {
    let calls = 0;
    const base = fetchFixture([
      { title: "Отчёт", url: "https://example.test/report", content: "19 700 ₽" }
    ]);
    const counted: typeof fetch = async (...args) => {
      calls++;
      return base(...args);
    };
    const search = new WebSearch("http://127.0.0.1:8080", counted);
    const result = await applyKosmoraActions(
      [message({ web_search: true })],
      search,
      new AbortController().signal
    );
    expect(calls).toBe(1);
    expect(result[0]!.content).toContain("[kosmora_web_search]");
    expect(result[0]!.content).toContain("https://example.test/report");
    expect(result[0]!.content).toContain("19 700 ₽");
    expect(result[0]!.content.startsWith("Что нового по теме 00123?")).toBe(true);
  });

  it("fails closed when search is not configured", async () => {
    await expect(
      applyKosmoraActions([message({ web_search: true })], undefined, new AbortController().signal)
    ).rejects.toThrow(ChatActionError);
  });

  it("fails closed when the search backend is unavailable", async () => {
    const unavailable: typeof fetch = async () => {
      await Promise.resolve();
      throw new Error("Search unavailable");
    };
    const search = new WebSearch("http://127.0.0.1:8080", unavailable);
    await expect(
      applyKosmoraActions([message({ web_search: true })], search, new AbortController().signal)
    ).rejects.toThrow(ChatActionError);
  });

  it("still reports an empty result honestly instead of inventing links", async () => {
    const search = new WebSearch("http://127.0.0.1:8080", fetchFixture([]));
    const result = await applyKosmoraActions(
      [message({ web_search: true })],
      search,
      new AbortController().signal
    );
    expect(result[0]!.content).toContain("items: []");
    expect(result[0]!.content).toContain("поиск ничего не вернул");
  });
});
