import { Inflate } from "fflate";

export type ZipLimits = {
  zipBytes: number;
  entries: number;
  entryBytes: number;
  inflatedBytes: number;
};
type Entry = {
  name: string;
  compressed: number;
  size: number;
  crc: number;
  offset: number;
  method: number;
  flags: number;
};
const decoder = new TextDecoder("utf-8", { fatal: true });
const MAX_U32 = 0xffffffff;
const utf8 = (bytes: Uint8Array) => decoder.decode(bytes);
function assert(ok: unknown, error: string): asserts ok {
  if (!ok) throw new Error(error);
}
function read16(v: DataView, n: number) {
  return v.getUint16(n, true);
}
function read32(v: DataView, n: number) {
  return v.getUint32(n, true);
}
function crc32(data: Uint8Array): number {
  let crc = -1;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i]!;
    for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ -1) >>> 0;
}
export function zipMemberNameOk(name: string) {
  return (
    name.length > 0 &&
    name.length < 512 &&
    !name.startsWith("/") &&
    !name.includes("\\") &&
    !name.includes(":") &&
    !name.includes("\0") &&
    name.split("/").every((part) => part !== ".." && part !== "." && part !== "")
  );
}

/** ZIP central-directory reader: refuses ZIP64, encryption, overlap, links, and ambiguous members. */
export class BoundedZip {
  readonly names: string[];
  private entries = new Map<string, Entry>();
  private data: Uint8Array;
  private view: DataView;
  private start: number;
  constructor(input: ArrayBuffer | Uint8Array, limits: ZipLimits, allowDirectories = false) {
    const data = input instanceof Uint8Array ? input : new Uint8Array(input);
    assert(
      data.byteLength > 21 && data.byteLength <= limits.zipBytes,
      "ZIP превышает допустимый размер или повреждён."
    );
    this.data = data;
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let end = -1;
    for (let i = data.byteLength - 22; i >= Math.max(0, data.byteLength - 65557); i--) {
      if (
        read32(this.view, i) === 0x06054b50 &&
        i + 22 + read16(this.view, i + 20) === data.byteLength
      ) {
        end = i;
        break;
      }
    }
    assert(end >= 0, "Центральный каталог ZIP не найден.");
    const v = this.view;
    assert(!read16(v, end + 4) && !read16(v, end + 6), "Многотомные ZIP не поддерживаются.");
    const count = read16(v, end + 10);
    assert(
      count && count === read16(v, end + 8) && count <= limits.entries,
      "В ZIP слишком много записей либо каталог повреждён."
    );
    const size = read32(v, end + 12),
      offset = read32(v, end + 16);
    assert(size !== MAX_U32 && offset !== MAX_U32 && count !== 65535, "ZIP64 не поддерживается.");
    assert(offset + size === end && offset <= data.length, "Некорректные границы ZIP.");
    this.start = offset;
    let cursor = offset,
      total = 0;
    const insensitive = new Set<string>();
    for (let i = 0; i < count; i++) {
      assert(cursor + 46 <= end && read32(v, cursor) === 0x02014b50, "Повреждён каталог ZIP.");
      const flags = read16(v, cursor + 8),
        method = read16(v, cursor + 10);
      const crc = read32(v, cursor + 16),
        compressed = read32(v, cursor + 20);
      const length = read32(v, cursor + 24);
      const nameSize = read16(v, cursor + 28),
        extra = read16(v, cursor + 30),
        comment = read16(v, cursor + 32);
      const disk = read16(v, cursor + 34),
        mode = read32(v, cursor + 38);
      const localOffset = read32(v, cursor + 42);
      const next = cursor + 46 + nameSize + extra + comment;
      assert(next <= end && nameSize > 0, "Неверная длина ZIP-записи.");
      assert(
        (flags & 0x0001) === 0 && (flags & 0x0040) === 0 && (flags & 0x2000) === 0,
        "Зашифрованные ZIP-файлы не поддерживаются."
      );
      assert(
        (flags & ~(0x0008 | 0x0800 | (method === 8 ? 0x0006 : 0))) === 0 &&
          (method === 0 || method === 8),
        "Метод сжатия ZIP не поддерживается."
      );
      let extraAt = cursor + 46 + nameSize;
      while (extraAt < cursor + 46 + nameSize + extra) {
        assert(extraAt + 4 <= next, "Некорректное расширение ZIP.");
        const extraId = read16(v, extraAt),
          extraSize = read16(v, extraAt + 2);
        assert(extraId !== 0x0001, "ZIP64 не поддерживается.");
        extraAt += 4 + extraSize;
        assert(extraAt <= cursor + 46 + nameSize + extra, "Некорректное расширение ZIP.");
      }
      assert(
        compressed !== MAX_U32 && length !== MAX_U32 && localOffset !== MAX_U32 && !disk,
        "ZIP64 и многотомные ZIP не поддерживаются."
      );
      assert(
        length <= limits.entryBytes && compressed <= limits.zipBytes,
        "Файл в ZIP превышает допустимый размер."
      );
      assert(
        !compressed ? length === 0 : length <= compressed * 400,
        "ZIP содержит недопустимую степень сжатия."
      );
      total += length;
      assert(total <= limits.inflatedBytes, "Суммарный размер распакованного ZIP превышает лимит.");
      const name = utf8(data.subarray(cursor + 46, cursor + 46 + nameSize));
      const directory = allowDirectories && name.endsWith("/");
      assert(!directory || length === 0, "Неверная запись папки ZIP.");
      assert(zipMemberNameOk(directory ? name.slice(0, -1) : name), "Опасный путь в ZIP.");
      // POSIX symlinks and exotic entries are not valid OOXML package members.
      assert(((mode >>> 16) & 0xf000) !== 0xa000, "Ссылки в ZIP запрещены.");
      assert(
        !this.entries.has(name) && !insensitive.has(name.toLowerCase()),
        "Дублирующиеся пути ZIP запрещены."
      );
      insensitive.add(name.toLowerCase());
      this.entries.set(name, {
        name,
        compressed,
        size: length,
        crc,
        offset: localOffset,
        method,
        flags
      });
      cursor = next;
    }
    assert(cursor === end, "Повреждён центральный каталог ZIP.");
    // No ZIP data entries may overlap each other or central directory.
    const spans: [number, number][] = [];
    for (const entry of this.entries.values()) {
      const start = entry.offset;
      assert(
        start + 30 <= this.start && read32(v, start) === 0x04034b50,
        "Повреждён ZIP-заголовок."
      );
      const flags = read16(v, start + 6),
        method = read16(v, start + 8);
      assert(
        flags === entry.flags && method === entry.method,
        "ZIP-заголовки противоречат друг другу."
      );
      const n = read16(v, start + 26),
        ext = read16(v, start + 28);
      let extraAt = start + 30 + n;
      while (extraAt < start + 30 + n + ext) {
        assert(extraAt + 4 <= this.start, "Некорректное расширение ZIP.");
        const extraId = read16(v, extraAt),
          extraSize = read16(v, extraAt + 2);
        assert(extraId !== 0x0001, "ZIP64 не поддерживается.");
        extraAt += 4 + extraSize;
        assert(extraAt <= start + 30 + n + ext, "Некорректное расширение ZIP.");
      }
      const first = start + 30 + n + ext,
        last = first + entry.compressed;
      assert(last <= this.start && first >= start + 30, "Некорректные смещения ZIP.");
      assert(
        utf8(data.subarray(start + 30, start + 30 + n)) === entry.name,
        "ZIP-заголовки содержат разные пути."
      );
      if (!(flags & 8))
        assert(
          read32(v, start + 14) === entry.crc &&
            read32(v, start + 18) === entry.compressed &&
            read32(v, start + 22) === entry.size,
          "ZIP-заголовки содержат разные размеры."
        );
      spans.push([start, last]);
    }
    spans.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < spans.length; i++)
      assert(spans[i]![0] >= spans[i - 1]![1], "Наложение ZIP-записей запрещено.");
    this.names = [...this.entries.keys()];
  }
  has(name: string) {
    return this.entries.has(name);
  }
  read(name: string): Uint8Array {
    const entry = this.entries.get(name);
    assert(entry, `В ZIP отсутствует ${name}.`);
    const start =
      entry.offset +
      30 +
      read16(this.view, entry.offset + 26) +
      read16(this.view, entry.offset + 28);
    const raw = this.data.subarray(start, start + entry.compressed);
    let output = raw;
    if (entry.method === 8) {
      output = new Uint8Array(entry.size);
      let written = 0;
      const inflater = new Inflate((chunk) => {
        assert(written + chunk.length <= output.length, "ZIP превысил объявленный размер.");
        output.set(chunk, written);
        written += chunk.length;
      });
      for (let i = 0; i < raw.length; i += 4096) {
        inflater.push(raw.subarray(i, i + 4096), i + 4096 >= raw.length);
      }
      assert(raw.length > 0 && written === output.length, "ZIP-файл повреждён: неверный размер.");
    }
    assert(
      output.byteLength === entry.size && crc32(output) === entry.crc,
      "ZIP-файл повреждён: размер или контрольная сумма неверны."
    );
    return output;
  }
}
