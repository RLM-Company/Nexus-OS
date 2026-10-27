import { describe, expect, it, vi } from "vitest";
import {
  LibraryUploadRejectedError,
  runLibraryUploadQueue,
  type LibraryUploadAdapter
} from "./library-upload-queue";
import type { LibraryFileView } from "./studio-files-library-client";

const view = (file: File): LibraryFileView => ({
  id: file.name,
  project_id: "project",
  name: file.name,
  format: "txt",
  bytes: file.size,
  status: "processing",
  error_code: null,
  characters: 0,
  chunks: 0
});
function adapter(): LibraryUploadAdapter {
  return {
    stage: vi.fn((file: File) => Promise.resolve(view(file))),
    extract: vi.fn(() => Promise.resolve([{ page: null, text: "text" }])),
    index: vi.fn(() => Promise.resolve(undefined)),
    settle: vi.fn(() => Promise.resolve("failed" as const))
  };
}
const files = () => [
  new File(["first"], "first.txt"),
  new File(["bad"], "bad.txt"),
  new File(["last"], "last.txt")
];

describe("document upload queue", () => {
  it("continues after an extraction error and reconciles the saved original", async () => {
    const api = adapter();
    api.extract = vi.fn((file: File) => {
      if (file.name === "bad.txt") return Promise.reject(new Error("bad text"));
      return Promise.resolve([{ page: null, text: file.name }]);
    });
    const result = await runLibraryUploadQueue(
      files(),
      api,
      new AbortController().signal,
      () => {}
    );
    expect(result.map((item) => item.state)).toEqual(["ready", "failed", "ready"]);
    expect(api.stage).toHaveBeenCalledTimes(3);
    expect(api.index).toHaveBeenCalledTimes(2);
    expect(api.settle).toHaveBeenCalledTimes(1);
    expect(result[1]).toMatchObject({ fileId: "bad.txt", detail: "bad text" });
  });
  it("rejects invalid files locally, preserves duplicate names as separate queue items and caps a batch", async () => {
    const api = adapter();
    const two = files()[0]!;
    const result = await runLibraryUploadQueue(
      [two, new File(["x"], "bad.exe"), two],
      api,
      new AbortController().signal,
      () => {}
    );
    expect(result.map((item) => item.state)).toEqual(["ready", "failed", "ready"]);
    expect(result.map((item) => item.index)).toEqual([0, 1, 2]);
    expect(api.stage).toHaveBeenCalledTimes(2);
    await expect(
      runLibraryUploadQueue(
        Array.from({ length: 101 }, () => two),
        api,
        new AbortController().signal,
        () => {}
      )
    ).rejects.toThrow(/100 файлов/);
  });
  it("cancel stops all later uploads and confirms the active saved file's cancelled state", async () => {
    const api = adapter();
    const controller = new AbortController();
    api.extract = vi.fn(() => {
      controller.abort();
      return Promise.reject(new DOMException("cancelled", "AbortError"));
    });
    const result = await runLibraryUploadQueue(files(), api, controller.signal, () => {});
    expect(result.map((item) => item.state)).toEqual(["cancelled", "cancelled", "cancelled"]);
    expect(api.stage).toHaveBeenCalledTimes(1);
    expect(api.index).not.toHaveBeenCalled();
    expect(api.settle).toHaveBeenCalledWith(expect.objectContaining({ id: "first.txt" }), true);
  });
  it("does not retry a lost upload response and distinguishes a definitive rejection", async () => {
    const api = adapter();
    api.stage = vi.fn((file: File) => {
      if (file.name === "first.txt") return Promise.reject(new TypeError("network lost"));
      if (file.name === "bad.txt") return Promise.reject(new LibraryUploadRejectedError("quota"));
      return Promise.resolve(view(file));
    });
    const result = await runLibraryUploadQueue(
      files(),
      api,
      new AbortController().signal,
      () => {}
    );
    expect(result.map((item) => item.state)).toEqual(["uncertain", "failed", "ready"]);
    expect(api.stage).toHaveBeenCalledTimes(3);
    expect(api.settle).not.toHaveBeenCalled();
  });
  it("accepts server-proven completion after a lost index reply and retains unverified status", async () => {
    const api = adapter();
    api.index = vi.fn(() => {
      return Promise.reject(new TypeError("lost response"));
    });
    api.settle = vi.fn((file: LibraryFileView) =>
      Promise.resolve(file.id === "first.txt" ? ("ready" as const) : null)
    );
    const result = await runLibraryUploadQueue(
      files().slice(0, 2),
      api,
      new AbortController().signal,
      () => {}
    );
    expect(result.map((item) => item.state)).toEqual(["ready", "uncertain"]);
  });
});
