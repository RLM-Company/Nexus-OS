import { strToU8, zipSync } from "fflate";
import { afterEach, expect, it, vi } from "vitest";
import { runLibraryUploadQueue } from "./library-upload-queue";
import { BoundedZip } from "./bounded-zip";
import { prepareLibraryUpload } from "./library-archive-import";

afterEach(() => vi.restoreAllMocks());

function zip(entries: Record<string, Uint8Array>) {
  const bytes = new Uint8Array(zipSync(entries));
  return new File([bytes], "package.zip");
}

it("imports distinct documents from folders and reports skipped formats", async () => {
  const archive = zip({
    "a/": strToU8(""),
    "a/report.txt": strToU8("alpha"),
    "b/report.txt": strToU8("beta"),
    "preview.png": strToU8("ignored")
  });
  const callback = vi.fn();
  const read = vi.spyOn(BoundedZip.prototype, "read");
  const result = await prepareLibraryUpload([archive], new AbortController().signal, callback);
  expect(result.skipped).toBe(1);
  expect(read).not.toHaveBeenCalled();
  expect(callback).toHaveBeenCalledWith("package.zip");
  expect(result.files.map((file) => file.name)).toEqual(["a › report.txt", "b › report.txt"]);
  expect(
    await Promise.all(result.files.map((file) => ("open" in file ? file.open() : file).text()))
  ).toEqual(["alpha", "beta"]);
});

it("rejects a package exceeding the upload file count before staging anything", async () => {
  const archive = zip(
    Object.fromEntries(
      Array.from({ length: 101 }, (_, index) => [index + ".txt", strToU8("document")])
    )
  );
  await expect(
    prepareLibraryUpload([archive], new AbortController().signal, vi.fn())
  ).rejects.toThrow(/до 100 файлов/);
});

it("stops before reading an archive when the upload is cancelled", async () => {
  const controller = new AbortController();
  controller.abort();
  const archive = zip({ "report.txt": strToU8("document") });
  const read = vi.spyOn(archive, "arrayBuffer");
  await expect(prepareLibraryUpload([archive], controller.signal, vi.fn())).rejects.toMatchObject({
    name: "AbortError"
  });
  expect(read).not.toHaveBeenCalled();
});

it("expands one nested ZIP level with a breadcrumb label", async () => {
  const inner = new Uint8Array(zipSync({ "note.txt": strToU8("внутри") }));
  const outer = new Uint8Array(
    zipSync({
      "outer/letter.txt": strToU8("снаружи"),
      "outer/inner.zip": inner
    })
  );
  const result = await prepareLibraryUpload(
    [new File([outer], "package.zip")],
    new AbortController().signal,
    vi.fn()
  );
  expect(result.skipped).toBe(0);
  expect(result.files.map((file) => file.name)).toEqual([
    "outer › letter.txt",
    "outer › inner.zip › note.txt"
  ]);
  expect(
    await Promise.all(result.files.map((file) => ("open" in file ? file.open() : file).text()))
  ).toEqual(["снаружи", "внутри"]);
});

it("reports nested archives beyond the depth limit as skipped, not silently dropped", async () => {
  const third = new Uint8Array(zipSync({ "deep.txt": strToU8("глубоко") }));
  const second = new Uint8Array(zipSync({ "level3.zip": third, "mid.txt": strToU8("середина") }));
  const first = new Uint8Array(zipSync({ "level2.zip": second }));
  const result = await prepareLibraryUpload(
    [new File([first], "package.zip")],
    new AbortController().signal,
    vi.fn()
  );
  // level2 expands, mid.txt is imported; level3 exceeds MAX_ARCHIVE_DEPTH and is skipped.
  expect(result.files.map((file) => file.name)).toEqual(["level2.zip › mid.txt"]);
  expect(result.skipped).toBe(1);
});

it("defers a bad CRC to its file, before the upload adapter is called", async () => {
  const bytes = zipSync(
    { "bad.txt": strToU8("unique-content"), "good.txt": strToU8("valid") },
    { level: 0 }
  );
  const offset = 30 + "bad.txt".length;
  bytes[offset] = bytes[offset]! ^ 1;
  const result = await prepareLibraryUpload(
    [new File([new Uint8Array(bytes)], "package.zip")],
    new AbortController().signal,
    vi.fn()
  );
  const stage = vi.fn((_file: File) => Promise.reject(new Error("fixture stage")));
  const extract = vi.fn();
  const rows = await runLibraryUploadQueue(
    result.files,
    {
      stage,
      extract,
      index: vi.fn(),
      settle: vi.fn()
    },
    new AbortController().signal,
    vi.fn()
  );
  expect(rows[0]).toMatchObject({
    state: "failed",
    detail: expect.stringMatching(/контрольная сумма/)
  });
  expect(stage).toHaveBeenCalledTimes(1);
  expect(stage.mock.calls[0]?.[0].name).toBe("good.txt");
  expect(extract).not.toHaveBeenCalled();
});
