import { describe, expect, it } from "vitest";
import { createChatExport, type ChatExportSource } from "./chat-export";

const at = "2026-10-11T12:30:00.000Z";
type ExportDocument = {
  format: string;
  version: number;
  conversation: unknown;
  attachments_mode: string;
  messages: { content: string; attachments: unknown[] }[];
};
const source: ChatExportSource = {
  id: "chat-1",
  projectId: "project-1",
  title: "План / проекта: <важно>",
  messages: [
    {
      id: "user-1",
      role: "user",
      content: "Проверь мой файл 🪐",
      status: "completed",
      created_at: at,
      updated_at: at,
      attachments: [
        { name: "отчёт.pdf", content: "private extracted file text", source_type: "pdf" },
        { name: "фото.png", kind: "image", media_type: "image/png", data_base64: "private-image" }
      ]
    },
    {
      id: "event-1",
      role: "system_event",
      content: "internal execution event",
      status: "completed",
      created_at: at,
      updated_at: at
    },
    {
      id: "assistant-1",
      role: "assistant",
      content: "```ts\nconst value = '<tag>';\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |",
      status: "cancelled",
      created_at: at,
      updated_at: at
    }
  ]
};

describe("portable chat exports", () => {
  it("preserves exact Unicode/code, ordering and status without embedding files or system events", () => {
    const file = createChatExport(source, "json", at);
    const parsed = JSON.parse(file.content) as ExportDocument;
    expect(parsed.conversation).toEqual({
      id: "chat-1",
      project_id: "project-1",
      title: source.title
    });
    expect(parsed.format).toBe("kosmora.chat");
    expect(parsed.version).toBe(1);
    expect(parsed.attachments_mode).toBe("metadata_only");
    expect(parsed.messages.map((message: { content: string }) => message.content)).toEqual([
      source.messages[0]!.content,
      source.messages[2]!.content
    ]);
    expect(parsed.messages[1]).toMatchObject({
      status: "cancelled",
      created_at: at,
      updated_at: at
    });
    expect(parsed.messages[0]!.attachments).toEqual([
      { name: "отчёт.pdf", kind: "document", source_type: "pdf" },
      { name: "фото.png", kind: "image", media_type: "image/png" }
    ]);
    expect(file.content).not.toMatch(/private extracted|private-image|internal execution/);
    expect(file.mimeType).toBe("application/json;charset=utf-8");
  });

  it("keeps Markdown code intact and marks cancelled answers and literal attachment names", () => {
    const file = createChatExport(
      {
        ...source,
        messages: [
          ...source.messages,
          {
            ...source.messages[0]!,
            id: "user-2",
            attachments: [{ name: "![photo](https://tracker.test/x)\n# fake", content: "hidden" }]
          }
        ]
      },
      "markdown",
      at
    );
    expect(file.content).toContain(source.messages[2]!.content);
    expect(file.content).toContain("Ответ остановлен");
    expect(file.content).toContain("Переписка проекта");
    expect(file.content).toContain("отчёт\\.pdf (pdf)");
    expect(file.content).not.toContain("![photo](https://tracker.test/x)");
    expect(file.content).not.toContain("\n# fake");
    expect(file.content).not.toMatch(/private extracted|private-image|internal execution/);
    expect(file.mimeType).toBe("text/markdown;charset=utf-8");
  });

  it("uses bounded safe filenames even with path separators and preserves long message bodies", () => {
    const text = "Длинная строка 🪐\n".repeat(12_000);
    const result = createChatExport(
      {
        ...source,
        title: "../CON:<>?*|\\" + "Я".repeat(160),
        messages: [{ ...source.messages[0]!, content: text }]
      },
      "json",
      at
    );
    expect(result.filename).toMatch(/^kosmora-[\p{L}\p{N}_-]+-20261011123000000\.json$/u);
    expect(result.filename.length).toBeLessThan(110);
    expect((JSON.parse(result.content) as ExportDocument).messages[0]!.content).toBe(text);
  });

  it("refuses empty or system-only exports and does not mutate the source", () => {
    const before = JSON.stringify(source);
    createChatExport(source, "markdown", at);
    expect(JSON.stringify(source)).toBe(before);
    expect(() => createChatExport({ ...source, messages: [] }, "json", at)).toThrow(
      /нет сообщений/
    );
    expect(() =>
      createChatExport({ ...source, messages: [source.messages[1]!] }, "json", at)
    ).toThrow(/нет сообщений/);
  });
});
