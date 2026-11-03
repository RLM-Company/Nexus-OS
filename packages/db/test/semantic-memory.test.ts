import { beforeEach, afterEach, describe, expect, it } from "vitest";
import type { ContextMemoryRanker, ContextMemoryInput, MemoryTarget } from "@cosmora/contracts";
import { openDatabase, runMigrations, ContextMemoryStore } from "../src/index.js";

describe("hybrid memory source boundaries", () => {
  let db: ReturnType<typeof openDatabase>, memory: ContextMemoryStore;
  let now: number;
  const at = "2026-11-03T12:00:00.000Z";
  const target: MemoryTarget = { kind: "chat", id: "current" };
  const fact = (content: string, extra: Partial<ContextMemoryInput> = {}): ContextMemoryInput => ({
    scope: "chat",
    scope_id: "source",
    kind: "fact",
    title: "Решение",
    content,
    source: null,
    pinned: false,
    expires_at: null,
    ...extra
  });
  const message = (id: string, chat: string, content: string, owner = "a", role = "user") =>
    db.sqlite
      .prepare(
        "INSERT INTO general_chat_messages(id,chat_id,owner_id,role,content_type,content,status,created_at,updated_at) VALUES(?,?,?,?,'text',?,'completed',?,?)"
      )
      .run(id, chat, owner, role, content, at, at);
  const configure = (extra = {}) =>
    memory.updateSettings(
      target,
      {
        enabled: true,
        use_personal: false,
        source_chat_ids: ["source"],
        project_ids: [],
        expected_version: memory.settings(target, "a").version,
        ...extra
      },
      "a"
    );
  const encoder = (hook?: () => void): ContextMemoryRanker => ({
    rank: async (_query, passages) => {
      await Promise.resolve();
      // Deliberately controlled scores test DB authority, NOT semantic intelligence.
      hook?.();
      return { encoder: "fixture-only", scores: passages.map(() => 0.9) };
    }
  });
  beforeEach(async () => {
    db = openDatabase(":memory:");
    await runMigrations(db);
    now = Date.parse(at);
    memory = new ContextMemoryStore(db.sqlite, () => now);
    for (const [id, owner] of [
      ["current", "a"],
      ["source", "a"],
      ["unselected", "a"],
      ["foreign", "b"]
    ])
      db.sqlite
        .prepare(
          "INSERT INTO general_chats(id,owner_id,title,created_at,updated_at) VALUES(?,?,?,?,?)"
        )
        .run(id!, owner!, id!, at, at);
    configure();
  });
  afterEach(() => db.close());
  it("recalls paraphrases without lexical overlap and retains numbers and user provenance", async () => {
    message("budget", "source", "Лимит расходов — 19 700 ₽, кроме доставки. Код 00123.");
    memory.semanticRanker = encoder();
    expect(memory.resolve(target, "a", "spending ceiling").items).toHaveLength(0);
    const bundle = await memory.resolveAsync(target, "a", "spending ceiling");
    expect(bundle.retrieval).toBe("hybrid");
    expect(bundle.items[0]).toMatchObject({
      reference: "H:g:budget",
      source: { role: "user" },
      text: "Лимит расходов — 19 700 ₽, кроме доставки. Код 00123."
    });
    expect(bundle.bytes).toBe(Buffer.byteLength(JSON.stringify(bundle)));
    expect(bundle.bytes).toBeLessThanOrEqual(bundle.budget_bytes);
    expect(memory.sourceFor(target, "a", bundle.items[0]!.reference).content).toContain("00123");
  });
  it("never sends unselected, foreign, excluded, credential or archived sources to an encoder", async () => {
    message("ok", "source", "Обсудили поставку мебели.");
    message("hidden", "unselected", "UNSELECTED");
    message("other", "foreign", "FOREIGN", "b");
    message("secret", "source", "API key: sk-" + "x".repeat(40));
    message("excluded", "source", "EXCLUDED");
    memory.semanticRanker = {
      rank: async (_query, passages) => {
        await Promise.resolve();
        expect(passages).toEqual(["Обсудили поставку мебели."]);
        return { encoder: "fixture-only", scores: [0.9] };
      }
    };
    await memory.resolveAsync(target, "a", "chair", ["excluded"]);
    db.sqlite.prepare("UPDATE general_chats SET archived=1 WHERE id='source'").run();
    expect((await memory.resolveAsync(target, "a", "chair")).items).toHaveLength(0);
  });
  it.each(["edited", "deleted", "archived", "revoked"])(
    "drops a source %s during inference",
    async (change) => {
      message("old", "source", "Согласован аванс.");
      memory.semanticRanker = encoder(() => {
        if (change === "edited")
          db.sqlite
            .prepare("UPDATE general_chat_messages SET content='Замена' WHERE id='old'")
            .run();
        if (change === "deleted")
          db.sqlite.prepare("DELETE FROM general_chat_messages WHERE id='old'").run();
        if (change === "archived")
          db.sqlite.prepare("UPDATE general_chats SET archived=1 WHERE id='source'").run();
        if (change === "revoked") configure({ source_chat_ids: [] });
      });
      expect((await memory.resolveAsync(target, "a", "prepayment")).items).toHaveLength(0);
    }
  );
  it("does not turn a changed saved note or an expired note into current memory", async () => {
    const saved = memory.create(fact("Оплата после проверки."), "a");
    memory.create(fact("Истекает", { expires_at: "2026-11-03T12:01:00.000Z" }), "a");
    memory.semanticRanker = encoder(() => {
      memory.update(saved.id, saved.version, fact("Новая версия"), "a");
      now += 60001;
    });
    expect((await memory.resolveAsync(target, "a", "payment")).items).toHaveLength(0);
  });
  it("falls back to freshly authorized lexical recall on bad or failed inference", async () => {
    message("old", "source", "Согласован аванс.");
    memory.semanticRanker = {
      rank: async () => {
        await Promise.resolve();
        configure({ source_chat_ids: [] });
        throw new Error("offline");
      }
    };
    const result = await memory.resolveAsync(target, "a", "аванс");
    expect(result.retrieval).toBe("lexical");
    expect(result.items).toHaveLength(0);
  });
  it.each([{ scores: [] }, { scores: [Number.NaN] }, { scores: [1.5] }])(
    "rejects invalid ranking %j without losing lexical behavior",
    async ({ scores }) => {
      message("old", "source", "Согласован аванс.");
      memory.semanticRanker = { rank: () => Promise.resolve({ encoder: "fixture-only", scores }) };
      expect(await memory.resolveAsync(target, "a", "аванс")).toEqual(
        memory.resolve(target, "a", "аванс")
      );
    }
  );
  it("does no inference when disabled and propagates cancellation", async () => {
    message("old", "source", "Согласован аванс.");
    configure({ enabled: false });
    memory.semanticRanker = {
      rank: () => Promise.reject(new Error("must not run"))
    };
    expect((await memory.resolveAsync(target, "a", "аванс")).items).toHaveLength(0);
    configure();
    const controller = new AbortController();
    memory.semanticRanker = encoder(() => controller.abort());
    await expect(
      memory.resolveAsync(target, "a", "аванс", [], 6000, controller.signal)
    ).rejects.toThrow();
  });
  it("preserves required constraints before optional semantic matches under tight budget", async () => {
    memory.create(fact("Только после одобрения владельца.", { kind: "constraint" }), "a");
    for (let n = 0; n < 8; n++) message("message" + n, "source", "Описание " + "x".repeat(300));
    memory.semanticRanker = encoder();
    const result = await memory.resolveAsync(target, "a", "unrelated", [], 1000);
    expect(result.items[0]?.memory_kind).toBe("constraint");
    expect(result.priority_omitted).toBe(0);
    expect(result.bytes).toBeLessThanOrEqual(1000);
  });
  it("reports bounded coverage and never mislabels assistant evidence as a user fact", async () => {
    message(
      "assistant",
      "source",
      "Помощник предложил вариант. " + "🌙".repeat(40000),
      "a",
      "assistant"
    );
    let count = 0;
    memory.semanticRanker = {
      rank: async (_q, texts) => {
        await Promise.resolve();
        count = texts.length;
        expect(texts.every((t) => t.length <= 600)).toBe(true);
        expect(texts.every((t) => !/[\uD800-\uDBFF]$|^[\uDC00-\uDFFF]/.test(t))).toBe(true);
        return { encoder: "fixture-only", scores: texts.map(() => 0.9) };
      }
    };
    const result = await memory.resolveAsync(target, "a", "unrelated");
    expect(count).toBe(96);
    expect(result.semantic_retrieval?.limited).toBe(true);
    expect(result.items[0]?.source?.role).toBe("assistant");
    expect(result.items[0]?.excerpt_only).toBe(true);
  });
  it("honors the owner lifecycle fence after asynchronous ranking", async () => {
    message("old", "source", "Согласован аванс.");
    memory.semanticRanker = encoder(() => {
      db.sqlite
        .prepare(
          "INSERT INTO kosmora_owner_data_lifecycle(owner_id,state,epoch,operation_id,started_at,updated_at) VALUES('a','deleting',1,'delete',?,?)"
        )
        .run(at, at);
    });
    await expect(memory.resolveAsync(target, "a", "prepayment")).rejects.toThrow(
      "OWNER_DATA_FENCED"
    );
  });
  it("does not let one long source starve a short independent source", async () => {
    message("z-long", "source", "Длинный текст ".repeat(10000));
    message("a-short", "source", "Короткий источник с отдельным решением.");
    memory.semanticRanker = {
      rank: (_q, texts) => {
        expect(texts).toContain("Короткий источник с отдельным решением.");
        return Promise.resolve({
          encoder: "fixture-only",
          scores: texts.map((t) => (t.includes("Короткий") ? 0.95 : 0.7))
        });
      }
    };
    const result = await memory.resolveAsync(target, "a", "paraphrase");
    expect(result.items[0]?.reference).toBe("H:g:a-short");
    expect(result.semantic_retrieval?.limited).toBe(true);
  });
  it("uses the project's own granted history without importing another owner's project", async () => {
    for (const [id, owner] of [
      ["p-owned", "a"],
      ["p-foreign", "b"]
    ]) {
      db.sqlite
        .prepare(
          "INSERT INTO projects(id,owner_id,title,status,created_at,updated_at) VALUES(?,?,?,'ACTIVE',?,?)"
        )
        .run(id!, owner!, id!, at, at);
      db.sqlite
        .prepare("INSERT INTO chats(id,project_id,kind,created_at) VALUES(?,?,'main',?)")
        .run("c-" + id, id!, at);
      db.sqlite
        .prepare(
          "INSERT INTO messages(id,project_id,chat_id,role,content_type,content,status,created_at,updated_at) VALUES(?,?,?,'user','text',?,'completed',?,?)"
        )
        .run(
          "m-" + id,
          id!,
          "c-" + id,
          owner === "a" ? "Лимит расходов 19700, без доставки." : "FOREIGN",
          at,
          at
        );
    }
    const project: MemoryTarget = { kind: "project", id: "p-owned" };
    memory.updateSettings(
      project,
      {
        enabled: true,
        use_personal: false,
        source_chat_ids: [],
        project_ids: [],
        expected_version: 0
      },
      "a"
    );
    memory.semanticRanker = {
      rank: (_q, texts) => {
        expect(texts).toEqual(["Лимит расходов 19700, без доставки."]);
        return Promise.resolve({ encoder: "fixture-only", scores: [0.9] });
      }
    };
    const result = await memory.resolveAsync(project, "a", "spending ceiling");
    expect(result.items[0]).toMatchObject({
      reference: "H:p:m-p-owned",
      source: { project_id: "p-owned", role: "user" }
    });
    await expect(memory.resolveAsync(project, "b", "spending ceiling")).rejects.toThrow(
      "MEMORY_TARGET_NOT_FOUND"
    );
  });
});
