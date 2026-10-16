import { expect, it } from "vitest";
import { readCanvasFile } from "./canvas-file";

it("imports exact UTF-8 content and chooses an inert Canvas format", async () => {
  const content = "# Привет\n\n<script>bad()</script>\n";
  const result = await readCanvasFile(new File([content], "Бриф.md"), new AbortController().signal);
  expect(result).toEqual({ title: "Бриф", content, format: "markdown" });
  expect(
    (await readCanvasFile(new File([content], "notes.html"), new AbortController().signal)).format
  ).toBe("html");
});

it("rejects malformed UTF-8, binary text and oversized input instead of truncating", async () => {
  const signal = new AbortController().signal;
  await expect(
    readCanvasFile(new File([new Uint8Array([0xff])], "bad.txt"), signal)
  ).rejects.toThrow("UTF-8");
  await expect(readCanvasFile(new File(["a\0b"], "bad.txt"), signal)).rejects.toThrow("двоичные");
  await expect(readCanvasFile(new File(["я".repeat(262145)], "large.md"), signal)).rejects.toThrow(
    "512 КиБ"
  );
});

it("rejects unsupported content and respects a closed editor before import", async () => {
  await expect(
    readCanvasFile(new File(["not a document"], "run.exe"), new AbortController().signal)
  ).rejects.toThrow("Откройте");
  const controller = new AbortController();
  controller.abort();
  await expect(
    readCanvasFile(new File(["cancelled"], "note.txt"), controller.signal)
  ).rejects.toThrow();
});
