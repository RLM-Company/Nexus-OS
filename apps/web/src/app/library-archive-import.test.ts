import { strToU8, zipSync } from "fflate";
import { expect, it, vi } from "vitest";
import { prepareLibraryUpload } from "./library-archive-import";

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
  const result = await prepareLibraryUpload([archive], new AbortController().signal, callback);
  expect(result.skipped).toBe(1);
  expect(callback).toHaveBeenCalledWith("package.zip");
  expect(result.files.map((file) => file.name)).toEqual(["a › report.txt", "b › report.txt"]);
  expect(await Promise.all(result.files.map((file) => file.text()))).toEqual(["alpha", "beta"]);
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
