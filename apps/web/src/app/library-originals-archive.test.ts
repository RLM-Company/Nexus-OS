import { createHash } from "node:crypto";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import { createLibraryOriginalsArchive } from "./library-originals-archive";
import type { LibraryFileView } from "./studio-files-library-client";

const bytes = new TextEncoder().encode("%PDF-1.7\nExact original bytes 🪐");
const file: LibraryFileView = {
  id: "file-1",
  project_id: "project",
  name: "договор.pdf",
  format: "pdf",
  bytes: bytes.length,
  status: "ready",
  error_code: null,
  characters: 0,
  chunks: 0
};
const options = () => ({
  projectId: "project",
  files: [file],
  signal: new AbortController().signal,
  onProgress: vi.fn()
});

describe("library original archives", () => {
  it("preserves exact binary PDF bytes, hashes, original names and collision-free paths", async () => {
    const fetcher = vi.fn<typeof fetch>(() => Promise.resolve(new Response(bytes)));
    const data = await createLibraryOriginalsArchive({
      ...options(),
      files: [file, { ...file, id: "file-2" }],
      fetcher
    });
    const entries = unzipSync(data);
    const manifest = JSON.parse(strFromU8(entries["manifest.json"]!)) as {
      files: { name: string; path: string; bytes: number; sha256: string }[];
    };
    expect(manifest.files).toHaveLength(2);
    expect(new Set(manifest.files.map((entry) => entry.path)).size).toBe(2);
    for (const entry of manifest.files) {
      expect(entries[entry.path]).toEqual(bytes);
      expect(entry.name).toBe(file.name);
      expect(entry.path).toMatch(/\.pdf$/);
      expect(entry.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    }
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("refuses partial responses and excess bodies instead of creating an incomplete archive", async () => {
    await expect(
      createLibraryOriginalsArchive({
        ...options(),
        fetcher: () => Promise.resolve(new Response(bytes.slice(1)))
      })
    ).rejects.toThrow(/не полностью/);
    await expect(
      createLibraryOriginalsArchive({
        ...options(),
        fetcher: () => Promise.resolve(new Response(new Uint8Array(bytes.length + 1)))
      })
    ).rejects.toThrow(/Размер оригинала/);
    await expect(
      createLibraryOriginalsArchive({
        ...options(),
        fetcher: () => Promise.resolve(new Response("missing", { status: 404 }))
      })
    ).rejects.toThrow(/Не удалось скачать/);
  });
  it("checks total/duplicates before a request and preserves safe paths even with malformed names", async () => {
    const fetcher = vi.fn<typeof fetch>(() => Promise.resolve(new Response(bytes)));
    await expect(
      createLibraryOriginalsArchive({ ...options(), files: [file, file], fetcher })
    ).rejects.toThrow(/повторяется/);
    await expect(
      createLibraryOriginalsArchive({
        ...options(),
        files: [
          { ...file, bytes: 20_000_000 },
          { ...file, id: "two", bytes: 20_000_000 },
          { ...file, id: "three", bytes: 20_000_000 }
        ],
        fetcher
      })
    ).rejects.toThrow(/50 МБ/);
    expect(fetcher).not.toHaveBeenCalled();
    const result = await createLibraryOriginalsArchive({
      ...options(),
      files: [{ ...file, name: "../../bad/evil.pdf" }],
      fetcher
    });
    expect(Object.keys(unzipSync(result)).some((path) => path.includes(".."))).toBe(false);
  });
  it("cancels active reading without fetching later documents or resolving a ZIP", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>(() => {
      const body = new ReadableStream<Uint8Array>({
        start(stream) {
          stream.enqueue(bytes);
          controller.abort();
        }
      });
      return Promise.resolve(new Response(body));
    });
    await expect(
      createLibraryOriginalsArchive({
        ...options(),
        signal: controller.signal,
        files: [file, { ...file, id: "file-2" }],
        fetcher
      })
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
