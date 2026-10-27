import { createHash } from "node:crypto";
import { unzipSync, strFromU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { createChatArchive, CHAT_ARCHIVE_LIMITS } from "./chat-archive-export";
import type { ChatExportSource } from "./chat-export";

const at = "2026-10-12T09:00:00.000Z";
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5k8AAAAASUVORK5CYII=";
const source: ChatExportSource = {
  id: "chat",
  projectId: null,
  title: "Мой архив",
  messages: [
    {
      id: "user",
      role: "user",
      content: "Прочитай файлы 🪐",
      status: "completed",
      created_at: at,
      updated_at: at,
      attachments: [
        { name: "договор.pdf", source_type: "pdf", content: "Текст договора 🪐" },
        { name: "фото.png", kind: "image", media_type: "image/png", data_base64: png },
        { name: "заметки.md", content: "# План\nДела" }
      ]
    }
  ]
};
type Manifest = {
  attachments: {
    message_id: string;
    original_name: string;
    representation: string;
    path: string;
    bytes: number;
    sha256: string;
  }[];
};

describe("chat archives with saved attachments", () => {
  it("compresses a long transcript through the asynchronous compression path without truncation", async () => {
    const content = "Длинная переписка и код 🪐\n".repeat(20_000);
    const result = await createChatArchive(
      { ...source, messages: [{ ...source.messages[0]!, attachments: [], content }] },
      at
    );
    const files = unzipSync(result.bytes);
    const transcript = JSON.parse(strFromU8(files["conversation.json"]!)) as {
      messages: { content: string }[];
    };
    expect(transcript.messages[0]!.content).toBe(content);
  });
  it("round-trips the actual files with hashes, exact images, Unicode and extracted-document labels", async () => {
    const result = await createChatArchive(source, at);
    const files = unzipSync(result.bytes);
    const manifest = JSON.parse(strFromU8(files["manifest.json"]!)) as Manifest;
    expect(Object.keys(files)).toHaveLength(7);
    expect(strFromU8(files["conversation.md"]!)).toContain("Прочитай файлы 🪐");
    expect(manifest.attachments.map((entry) => entry.representation)).toEqual([
      "extracted_text",
      "saved_image",
      "saved_text"
    ]);
    for (const entry of manifest.attachments) {
      expect(entry.message_id).toBe("user");
      expect(files[entry.path]!.byteLength).toBe(entry.bytes);
      expect(createHash("sha256").update(files[entry.path]!).digest("hex")).toBe(entry.sha256);
    }
    expect(strFromU8(files[manifest.attachments[0]!.path]!)).toBe("Текст договора 🪐");
    expect(Buffer.from(files[manifest.attachments[1]!.path]!).toString("base64")).toBe(png);
    expect(manifest.attachments[0]!.path).toMatch(/\.txt$/);
    expect(Object.keys(files).some((path) => path.endsWith(".pdf"))).toBe(false);
    expect(result.filename).toMatch(/\.zip$/);
  });

  it("keeps duplicate names unique and excludes system events entirely", async () => {
    const message = source.messages[0]!;
    const result = await createChatArchive(
      {
        ...source,
        messages: [
          message,
          { ...message, id: "user-2" },
          { ...message, id: "event", role: "system_event", content: "secret event" }
        ]
      },
      at
    );
    const files = unzipSync(result.bytes);
    const manifest = JSON.parse(strFromU8(files["manifest.json"]!)) as Manifest;
    expect(manifest.attachments).toHaveLength(6);
    expect(new Set(manifest.attachments.map((entry) => entry.path)).size).toBe(6);
    expect(strFromU8(files["conversation.json"]!)).not.toContain("secret event");
    expect(manifest.attachments.map((entry) => entry.message_id)).not.toContain("event");
  });

  it("rejects damaged images, traversal filenames and excessive totals without silently dropping files", async () => {
    const message = source.messages[0]!;
    await expect(
      createChatArchive(
        {
          ...source,
          messages: [{ ...message, attachments: [{ name: "../../bad.txt", content: "bad" }] }]
        },
        at
      )
    ).rejects.toThrow(/повреждено/);
    await expect(
      createChatArchive(
        {
          ...source,
          messages: [
            {
              ...message,
              attachments: [
                { name: "bad.png", kind: "image", media_type: "image/png", data_base64: "aGVsbG8=" }
              ]
            }
          ]
        },
        at
      )
    ).rejects.toThrow(/повреждено/);
    await expect(
      createChatArchive(
        { ...source, messages: [{ ...message, content: "a".repeat(CHAT_ARCHIVE_LIMITS.bytes) }] },
        at
      )
    ).rejects.toThrow(/25 МБ/);
    await expect(
      createChatArchive(
        {
          ...source,
          messages: Array.from({ length: 101 }, (_, index) => ({ ...message, id: String(index) }))
        },
        at
      )
    ).rejects.toThrow(/300 вложений/);
  });

  it("supports an empty attachments folder and cancels without delivering a late archive", async () => {
    const result = await createChatArchive(
      { ...source, messages: [{ ...source.messages[0]!, attachments: [] }] },
      at
    );
    expect(Object.keys(unzipSync(result.bytes))).toHaveLength(4);
    const controller = new AbortController();
    controller.abort();
    await expect(createChatArchive(source, at, controller.signal)).rejects.toMatchObject({
      name: "AbortError"
    });
    const during = new AbortController();
    const pending = createChatArchive(source, at, during.signal);
    during.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
