import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";
import { prepareLibraryUpload } from "./library-archive-import";

/** The synthetic Studio package (docs/handoff/fixtures/studio-document-package)
 * is checked against the REAL product importer, not only its own self-check. */
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const fixtureDir = join(root, "docs/handoff/fixtures/studio-document-package");
const manifest = JSON.parse(readFileSync(join(fixtureDir, "manifest.json"), "utf8")) as {
  archives: Record<
    "simple" | "extended",
    { file: string; expected_document_names: string[]; skipped: Array<{ name: string }> }
  >;
};
const load = (name: string) => {
  const bytes = readFileSync(join(fixtureDir, name));
  return new File([bytes], name);
};

it("imports the simple Studio fixture through the real archive importer", async () => {
  const result = await prepareLibraryUpload(
    [load(manifest.archives.simple.file)],
    new AbortController().signal,
    vi.fn()
  );
  expect(result.skipped).toBe(0);
  expect(result.files.map((file) => file.name).sort()).toEqual(
    [...manifest.archives.simple.expected_document_names].sort()
  );
});

it("reports the extended Studio fixture gaps through the real importer", async () => {
  const result = await prepareLibraryUpload(
    [load(manifest.archives.extended.file)],
    new AbortController().signal,
    vi.fn()
  );
  const expected = new Set(manifest.archives.extended.expected_document_names);
  // Current importer skips unsupported extensions and __MACOSX, does not expand
  // nested archives; that is exactly what the manifest declares.
  expect(result.files.every((file) => expected.has(file.name))).toBe(true);
  expect(result.skipped).toBeGreaterThanOrEqual(manifest.archives.extended.skipped.length);
  expect(result.files.map((file) => file.name)).toContain("scans › scan.pdf");
  expect(result.files.map((file) => file.name)).toContain("partial › truncated.csv");
});
