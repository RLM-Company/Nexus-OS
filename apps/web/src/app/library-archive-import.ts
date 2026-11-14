import { BoundedZip } from "./bounded-zip";

const ARCHIVE_LIMITS = {
  zipBytes: 24_000_000,
  entries: 500,
  entryBytes: 20_000_000,
  inflatedBytes: 100_000_000
} as const;

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
  const add = (file: File) => {
    if (files.length >= 100 || bytes + file.size > 100_000_000)
      throw new Error(
        "После распаковки в пакете может быть до 100 файлов общим размером до 100 МБ."
      );
    files.push(file);
    bytes += file.size;
  };
  for (const file of selected) {
    signal.throwIfAborted();
    if (!/\.zip$/i.test(file.name)) {
      add(file);
      continue;
    }
    if (file.size > ARCHIVE_LIMITS.zipBytes) throw new Error("ZIP: максимум 24 МБ до распаковки.");
    onArchive(file.name);
    const data = await file.arrayBuffer();
    signal.throwIfAborted();
    const archive = new BoundedZip(data, ARCHIVE_LIMITS, true);
    let supported = 0;
    const names = new Set<string>();
    for (const path of archive.names) {
      signal.throwIfAborted();
      if (path.endsWith("/")) continue;
      if (!/\.(pdf|docx|csv|txt)$/i.test(path) || path.startsWith("__MACOSX/")) {
        skipped++;
        continue;
      }
      // The library stores a label rather than a filesystem path.
      const name = path.replaceAll("/", " › ");
      if (name.length > 180 || /[\u0000-\u001f\u007f]/u.test(name) || names.has(name.toLowerCase()))
        throw new Error("ZIP содержит слишком длинные или пересекающиеся имена документов.");
      names.add(name.toLowerCase());
      const content = archive.read(path);
      const data = new Uint8Array(content.length);
      data.set(content);
      add(new File([data], name, { lastModified: file.lastModified }));
      supported++;
      // Yield between entries so cancellation and progress remain responsive.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    if (!supported) throw new Error("В ZIP нет документов PDF, DOCX, TXT или CSV.");
  }
  signal.throwIfAborted();
  return { files, skipped };
}
