import { BoundedZip } from "./bounded-zip";

const ARCHIVE_LIMITS = {
  zipBytes: 24_000_000,
  entries: 500,
  entryBytes: 20_000_000,
  inflatedBytes: 100_000_000
} as const;
/** One outer archive plus one nested level; deeper archives are reported as skipped. */
const MAX_ARCHIVE_DEPTH = 2;
const MAX_NESTED_ARCHIVES = 8;

/**
 * Expand ZIP archives into library documents. The outer archive may contain one
 * nested level of archives; deeper or broken nested archives are counted as
 * skipped (never silently dropped) so the owner sees honest coverage.
 */
export async function prepareLibraryUpload(
  selected: readonly File[],
  signal: AbortSignal,
  onArchive: (name: string) => void
): Promise<{ files: File[]; skipped: number }> {
  if (selected.length > 100 || selected.reduce((sum, file) => sum + file.size, 0) > 100_000_000)
    throw new Error("В одном пакете может быть до 100 файлов общим размером до 100 МБ.");
  const files: File[] = [];
  let bytes = 0;
  let skipped = 0;
  let nestedArchives = 0;
  const add = (file: File) => {
    if (files.length >= 100 || bytes + file.size > 100_000_000)
      throw new Error(
        "После распаковки в пакете может быть до 100 файлов общим размером до 100 МБ."
      );
    files.push(file);
    bytes += file.size;
  };
  /** Expand one archive. `prefix` is the owner-visible breadcrumb for nested paths. */
  const expandArchive = async (
    data: ArrayBuffer | Uint8Array,
    prefix: string,
    lastModified: number,
    depth: number
  ): Promise<void> => {
    if (data.byteLength > ARCHIVE_LIMITS.zipBytes)
      throw new Error("ZIP: максимум 24 МБ до распаковки.");
    const archive = new BoundedZip(data, ARCHIVE_LIMITS, true);
    let supported = 0;
    const names = new Set<string>();
    for (const path of archive.names) {
      signal.throwIfAborted();
      if (path.endsWith("/")) continue;
      if (path.startsWith("__MACOSX/")) {
        skipped++;
        continue;
      }
      const label = `${prefix}${path.replaceAll("/", " › ")}`;
      if (/\.zip$/i.test(path) || /\.(pdf|docx|csv|txt)$/i.test(path) === false) {
        if (/\.zip$/i.test(path)) {
          if (depth >= MAX_ARCHIVE_DEPTH || nestedArchives >= MAX_NESTED_ARCHIVES) {
            // Honest skip: a deeper archive cannot be expanded within the limits.
            skipped++;
            continue;
          }
          nestedArchives++;
          onArchive(label);
          try {
            const nested = archive.read(path);
            await expandArchive(nested, `${label} › `, lastModified, depth + 1);
            supported++;
          } catch {
            // A corrupt/unsupported nested archive is reported, not silently lost.
            skipped++;
          }
          continue;
        }
        skipped++;
        continue;
      }
      // The library stores a label rather than a filesystem path.
      const name = label;
      // eslint-disable-next-line no-control-regex -- Archive names must not contain control characters.
      if (name.length > 180 || /[\u0000-\u001f\u007f]/u.test(name) || names.has(name.toLowerCase()))
        throw new Error("ZIP содержит слишком длинные или пересекающиеся имена документов.");
      names.add(name.toLowerCase());
      const content = archive.read(path);
      const data = new Uint8Array(content.length);
      data.set(content);
      add(new File([data], name, { lastModified }));
      supported++;
      // Yield between entries so cancellation and progress remain responsive.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    if (!supported) throw new Error("В ZIP нет документов PDF, DOCX, TXT или CSV.");
  };
  for (const file of selected) {
    signal.throwIfAborted();
    if (!/\.zip$/i.test(file.name)) {
      add(file);
      continue;
    }
    onArchive(file.name);
    const data = await file.arrayBuffer();
    signal.throwIfAborted();
    await expandArchive(data, "", file.lastModified, 1);
  }
  signal.throwIfAborted();
  return { files, skipped };
}
