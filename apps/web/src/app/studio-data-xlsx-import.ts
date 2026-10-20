/** XLSX import is strictly local. No DOMParser, external I/O, eval, or formula execution. */
import { inflateSync } from "fflate";
import type { CsvTable } from "./studio-csv";

export const XLSX_IMPORT_LIMITS = {
  zipBytes: 24_000_000,
  entries: 128,
  entryBytes: 64_000_000,
  inflatedBytes: 96_000_000,
  xmlChars: 64_000_000,
  rows: 80_000,
  columns: 100,
  cells: 1_000_000
} as const;

type Entry = {
  name: string;
  compressed: number;
  size: number;
  crc: number;
  offset: number;
  method: number;
  flags: number;
};
export type XlsxSheet = { name: string; path: string; hidden: boolean };
export type XlsxIndex = { sheets: XlsxSheet[]; workbookDate1904: boolean };
export type XlsxImported = {
  table: CsvTable;
  warnings: string[];
  formulaCached: number;
  formulaUncached: number;
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
function nameOk(name: string) {
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
export class SafeXlsxZip {
  readonly names: string[];
  private entries = new Map<string, Entry>();
  private data: Uint8Array;
  private view: DataView;
  private start: number;
  constructor(input: ArrayBuffer | Uint8Array) {
    const data = input instanceof Uint8Array ? input : new Uint8Array(input);
    assert(
      data.byteLength > 21 && data.byteLength <= XLSX_IMPORT_LIMITS.zipBytes,
      "Размер XLSX превышает 24 МБ или архив повреждён."
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
      count && count === read16(v, end + 8) && count <= XLSX_IMPORT_LIMITS.entries,
      "В XLSX слишком много вложений либо каталог повреждён."
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
        (flags & ~(0x0008 | 0x0800)) === 0 && (method === 0 || method === 8),
        "Метод сжатия XLSX не поддерживается."
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
        "ZIP64 и многотомные XLSX не поддерживаются."
      );
      assert(
        length <= XLSX_IMPORT_LIMITS.entryBytes && compressed <= XLSX_IMPORT_LIMITS.zipBytes,
        "XML-файл в XLSX превышает лимит."
      );
      assert(
        !compressed ? length === 0 : length <= compressed * 400,
        "ZIP содержит недопустимую степень сжатия."
      );
      total += length;
      assert(total <= XLSX_IMPORT_LIMITS.inflatedBytes, "Суммарный размер ZIP превышает 96 МБ.");
      const name = utf8(data.subarray(cursor + 46, cursor + 46 + nameSize));
      assert(nameOk(name), "Опасный путь в ZIP.");
      // POSIX symlinks and exotic entries are not valid OOXML package members.
      assert(((mode >>> 16) & 0xf000) !== 0xa000, "Ссылки в XLSX запрещены.");
      assert(
        !this.entries.has(name) && !insensitive.has(name.toLowerCase()),
        "Дублирующиеся пути ZIP запрещены."
      );
      insensitive.add(name.toLowerCase());
      assert(
        !(
          name === "xl/vbaProject.bin" ||
          name.startsWith("xl/externalLinks/") ||
          name.startsWith("xl/embeddings/")
        ),
        "Внешние или встроенные объекты в XLSX запрещены."
      );
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
    assert(
      this.entries.has("[Content_Types].xml") &&
        this.entries.has("_rels/.rels") &&
        this.entries.has("xl/workbook.xml") &&
        this.entries.has("xl/_rels/workbook.xml.rels"),
      "Это не поддерживаемый XLSX-пакет."
    );
  }
  has(name: string) {
    return this.entries.has(name);
  }
  read(name: string): Uint8Array {
    const entry = this.entries.get(name);
    assert(entry, `В XLSX отсутствует ${name}.`);
    const start =
      entry.offset +
      30 +
      read16(this.view, entry.offset + 26) +
      read16(this.view, entry.offset + 28);
    const raw = this.data.subarray(start, start + entry.compressed);
    const output = entry.method === 0 ? raw : inflateSync(raw, { out: new Uint8Array(entry.size) });
    assert(
      output.byteLength === entry.size && crc32(output) === entry.crc,
      "ZIP-файл повреждён: размер или контрольная сумма неверны."
    );
    return output;
  }
  xml(name: string): string {
    const bytes = this.read(name);
    assert(bytes.byteLength <= XLSX_IMPORT_LIMITS.entryBytes, "XML слишком велик.");
    const content = utf8(bytes);
    assert(content.length <= XLSX_IMPORT_LIMITS.xmlChars, "XML слишком велик.");
    return content;
  }
}

function entities(value: string): string {
  return value.replace(
    /&(#(?:x[0-9a-fA-F]+|[0-9]+)|amp|lt|gt|quot|apos);|&/gu,
    (match, entity: string | undefined) => {
      if (!entity) throw new Error("Неизвестная XML-сущность.");
      const specials: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
      if (specials[entity]) return specials[entity];
      const radix = entity.startsWith("#x") ? 16 : 10;
      const code = parseInt(entity.slice(radix === 16 ? 2 : 1), radix);
      assert(
        (code === 9 || code === 10 || code === 13 || code >= 32) &&
          code <= 0x10ffff &&
          !(code >= 0xd800 && code <= 0xdfff) &&
          code !== 0xfffe &&
          code !== 0xffff,
        "Некорректная XML-сущность."
      );
      return String.fromCodePoint(code);
    }
  );
}
function ooxmlText(value: string) {
  // A one-pass replace preserves escaped literal tokens: _x005F_x0041_ => _x0041_.
  return entities(value).replace(/_x([0-9a-fA-F]{4})_/gu, (_match, code: string) =>
    String.fromCharCode(parseInt(code, 16))
  );
}
type XmlHandler = {
  start?: (tag: string, attrs: Record<string, string>) => void;
  end?: (tag: string) => void;
  text?: (data: string) => void;
};
function local(tag: string) {
  return tag.slice(tag.indexOf(":") + 1);
}
/** Bounded SAX-like XML scanner; rejects DTD/entities; validates nesting without a DOM. */
function scanXml(xml: string, handler: XmlHandler) {
  assert(!/<!\s*(?:DOCTYPE|ENTITY)/iu.test(xml), "DTD/ENTITY запрещены в XLSX.");
  let cursor = 0;
  const stack: string[] = [];
  while (cursor < xml.length) {
    const lt = xml.indexOf("<", cursor);
    if (lt < 0) {
      if (cursor < xml.length) handler.text?.(ooxmlText(xml.slice(cursor)));
      break;
    }
    if (lt > cursor) handler.text?.(ooxmlText(xml.slice(cursor, lt)));
    if (xml.startsWith("<!--", lt)) {
      const end = xml.indexOf("-->", lt + 4);
      assert(end >= 0, "Незакрытый XML-комментарий.");
      cursor = end + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", lt)) {
      const end = xml.indexOf("]]>", lt + 9);
      assert(end >= 0, "Незакрытая CDATA.");
      handler.text?.(xml.slice(lt + 9, end));
      cursor = end + 3;
      continue;
    }
    if (xml.startsWith("<?", lt)) {
      const end = xml.indexOf("?>", lt + 2);
      assert(
        end > lt && /^<\?xml(?:\s|\?)/i.test(xml.slice(lt, end + 2)),
        "XML-инструкция запрещена."
      );
      cursor = end + 2;
      continue;
    }
    assert(xml[lt + 1] !== "!", "Неизвестная XML-директива.");
    let end = lt + 1,
      quote = "";
    for (; end < xml.length; end++) {
      const c = xml[end]!;
      if (quote) {
        if (c === quote) quote = "";
      } else if (c === '"' || c === "'") quote = c;
      else if (c === ">") break;
    }
    assert(
      end < xml.length && !quote && end - lt <= 8192,
      "XML-тег превышает лимит или не закрыт."
    );
    const token = xml.slice(lt + 1, end);
    if (token.startsWith("/")) {
      const tag = token.slice(1).trim();
      assert(tag && stack.pop() === tag, "Нарушена структура XML.");
      handler.end?.(local(tag));
    } else {
      const singleton = /\/\s*$/u.test(token);
      const source = singleton ? token.replace(/\/\s*$/u, "") : token;
      const match = /^([\w:.-]+)(.*)$/su.exec(source);
      assert(match, "Некорректный XML-тег.");
      const name = match[1]!,
        attrs: Record<string, string> = {};
      const tail = match[2]!;
      const attr = /\s+([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/guy;
      let p = 0,
        n = 0;
      while (p < tail.length) {
        if (!tail.slice(p).trim()) break;
        attr.lastIndex = p;
        const field = attr.exec(tail);
        assert(field && ++n <= 48 && !(field[1]! in attrs), "Некорректные атрибуты XML.");
        attrs[field[1]!] = ooxmlText(field[2] ?? field[3] ?? "");
        p = attr.lastIndex;
      }
      if (!singleton) {
        assert(stack.length < 48, "XML слишком глубоко вложен.");
        stack.push(name);
      }
      handler.start?.(local(name), attrs);
      if (singleton) handler.end?.(local(name));
    }
    cursor = end + 1;
  }
  assert(stack.length === 0, "XML обрывается до закрытия тегов.");
}
function partPath(parent: string, relative: string) {
  assert(
    !relative.startsWith("/") &&
      !/^[a-z]+:/iu.test(relative) &&
      !relative.includes("\\") &&
      !relative.includes("#"),
    "Внешние пути XLSX запрещены."
  );
  const dirs = parent.split("/").slice(0, -1);
  for (const part of relative.split("/")) {
    if (part === "..") {
      assert(dirs.length > 0, "Недопустимый путь XLSX.");
      dirs.pop();
    } else if (part && part !== ".") dirs.push(part);
  }
  const path = dirs.join("/");
  assert(nameOk(path), "Некорректный путь XLSX.");
  return path;
}
function relationships(xml: string, parent: string) {
  const map = new Map<string, { type: string; path: string }>();
  scanXml(xml, {
    start(tag, attrs) {
      if (tag !== "Relationship") return;
      assert(
        (!attrs.TargetMode || attrs.TargetMode.toLowerCase() === "internal") &&
          !/^[a-z]+:/iu.test(attrs.Target ?? ""),
        "Внешние связи в XLSX запрещены."
      );
      assert(
        attrs.Id && attrs.Type && attrs.Target && !map.has(attrs.Id),
        "Некорректные связи XLSX."
      );
      map.set(attrs.Id, { type: attrs.Type, path: partPath(parent, attrs.Target) });
    }
  });
  return map;
}
export function inspectXlsx(archive: SafeXlsxZip): XlsxIndex {
  // Reject external relationships anywhere, including hyperlinks in a worksheet.
  for (const filename of archive.names) {
    if (filename.endsWith(".rels"))
      relationships(
        archive.xml(filename),
        filename === "_rels/.rels" ? "_rels/.rels" : filename.replace(/(^|\/)_rels\//u, "$1")
      );
  }
  const root = relationships(archive.xml("_rels/.rels"), "root.xml");
  assert(
    [...root.values()].some(
      (r) => r.type.endsWith("/officeDocument") && r.path === "xl/workbook.xml"
    ),
    "Неизвестная структура пакета Excel."
  );
  const rels = relationships(archive.xml("xl/_rels/workbook.xml.rels"), "xl/workbook.xml");
  const sheets: XlsxSheet[] = [];
  let workbookDate1904 = false;
  scanXml(archive.xml("xl/workbook.xml"), {
    start(tag, attrs) {
      if (tag === "workbookPr")
        workbookDate1904 = attrs.date1904 === "1" || attrs.date1904 === "true";
      if (tag !== "sheet") return;
      const id = attrs["r:id"] ?? attrs.id;
      assert(id, "Не указан идентификатор листа Excel.");
      const linked = rels.get(id);
      assert(
        linked && linked.type.endsWith("/worksheet") && archive.has(linked.path),
        "Лист Excel не найден."
      );
      assert(attrs.name && attrs.name.length <= 100, "Некорректное название листа.");
      sheets.push({
        name: attrs.name,
        path: linked.path,
        hidden: attrs.state === "hidden" || attrs.state === "veryHidden"
      });
    }
  });
  assert(
    sheets.length &&
      sheets.length <= XLSX_IMPORT_LIMITS.entries &&
      new Set(sheets.map((s) => s.path)).size === sheets.length,
    "Некорректный список листов Excel."
  );
  return { sheets, workbookDate1904 };
}
function colIndex(ref: string) {
  const match = /^([A-Z]{1,3})([1-9]\d*)$/u.exec(ref);
  assert(match, "Неверный адрес ячейки Excel.");
  let col = 0;
  for (const char of match[1]!) col = col * 26 + char.charCodeAt(0) - 64;
  const row = Number(match[2]);
  assert(
    col <= XLSX_IMPORT_LIMITS.columns && row <= XLSX_IMPORT_LIMITS.rows + 80_000,
    "XLSX выходит за поддерживаемые границы листа."
  );
  return { column: col - 1, row };
}
function strings(zip: SafeXlsxZip): string[] {
  if (!zip.has("xl/sharedStrings.xml")) return [];
  const values: string[] = [];
  let inItem = false,
    inText = false,
    inPhonetic = false,
    current = "",
    total = 0;
  scanXml(zip.xml("xl/sharedStrings.xml"), {
    start(tag) {
      if (tag === "si") {
        assert(!inItem, "Некорректная таблица строк Excel.");
        inItem = true;
        current = "";
      }
      if (tag === "rPh") inPhonetic = true;
      if (tag === "t" && inItem && !inPhonetic) inText = true;
    },
    text(text) {
      if (inText) {
        current += text;
        assert(current.length <= 100_000, "Слишком длинная строка в XLSX.");
      }
    },
    end(tag) {
      if (tag === "t") inText = false;
      if (tag === "rPh") inPhonetic = false;
      if (tag === "si") {
        values.push(current);
        total += current.length;
        assert(
          values.length <= XLSX_IMPORT_LIMITS.cells && total <= XLSX_IMPORT_LIMITS.xmlChars,
          "Слишком много общих строк в XLSX."
        );
        inItem = false;
      }
    }
  });
  return values;
}

export function importXlsxSheet(
  zip: SafeXlsxZip,
  index: XlsxIndex,
  sheetIndex: number,
  headerRow: number
): XlsxImported {
  assert(
    Number.isInteger(sheetIndex) && sheetIndex >= 0 && sheetIndex < index.sheets.length,
    "Выберите лист XLSX."
  );
  assert(
    Number.isInteger(headerRow) && headerRow >= 1 && headerRow <= XLSX_IMPORT_LIMITS.rows,
    "Строка заголовков должна быть от 1 до 80000."
  );
  const shared = strings(zip),
    sparse = new Map<number, Map<number, string>>();
  let currentRow = 0,
    nextRow = 1,
    lastRow = 0,
    maxCol = -1,
    cells = 0;
  let lastColumnInRow = -1;
  let cell: null | {
    column: number;
    type: string;
    text: string;
    formula: string;
    inline: string;
    hasFormula: boolean;
    hasValue: boolean;
    reading: string;
    style: string;
  } = null;
  let formulaCached = 0,
    formulaUncached = 0,
    styledNumeric = 0;
  scanXml(zip.xml(index.sheets[sheetIndex]!.path), {
    start(tag, attrs) {
      if (tag === "row") {
        currentRow = attrs.r ? Number(attrs.r) : nextRow;
        assert(
          Number.isSafeInteger(currentRow) &&
            currentRow >= nextRow &&
            currentRow <= headerRow + XLSX_IMPORT_LIMITS.rows,
          "Некорректные номера строк или превышен лимит 80000 строк."
        );
        nextRow = currentRow + 1;
        lastColumnInRow = -1;
      }
      if (tag === "c") {
        assert(currentRow > 0 && !cell, "Ячейка вне строки Excel.");
        const ref = attrs.r ? colIndex(attrs.r) : { column: lastColumnInRow + 1, row: currentRow };
        assert(
          ref.row === currentRow && ref.column < XLSX_IMPORT_LIMITS.columns,
          "Некорректные номера столбцов XLSX."
        );
        let row = sparse.get(currentRow);
        if (!row) {
          row = new Map();
          sparse.set(currentRow, row);
        }
        assert(!row.has(ref.column), "Повторная ячейка XLSX.");
        cell = {
          column: ref.column,
          type: attrs.t ?? "n",
          text: "",
          formula: "",
          inline: "",
          hasFormula: false,
          hasValue: false,
          reading: "",
          style: attrs.s ?? ""
        };
        row.set(ref.column, "");
        cells++;
        assert(cells <= XLSX_IMPORT_LIMITS.cells, "В XLSX больше 1 млн ячеек.");
        maxCol = Math.max(maxCol, ref.column);
        lastColumnInRow = ref.column;
        lastRow = Math.max(lastRow, currentRow);
      }
      if (cell && (tag === "v" || tag === "f" || tag === "t")) {
        cell.reading = tag;
        if (tag === "f") cell.hasFormula = true;
        if (tag === "v") cell.hasValue = true;
      }
    },
    text(text) {
      if (!cell) return;
      if (cell.reading === "v") cell.text += text;
      else if (cell.reading === "f") cell.formula += text;
      else if (cell.reading === "t") cell.inline += text;
      assert(
        cell.text.length + cell.formula.length + cell.inline.length <= 100_000,
        "Слишком большое содержимое ячейки Excel."
      );
    },
    end(tag) {
      if (!cell) return;
      if (tag === cell.reading) cell.reading = "";
      if (tag !== "c") return;
      let value: string;
      if (cell.hasFormula && !cell.hasValue && !cell.inline) {
        value = cell.formula ? "=" + cell.formula : "[формула без сохранённого результата]";
        formulaUncached++;
      } else {
        const raw = cell.type === "inlineStr" ? cell.inline : cell.text;
        if (cell.type === "s") {
          assert(
            /^\d+$/u.test(raw) && Number.isSafeInteger(Number(raw)) && Number(raw) < shared.length,
            "Некорректный индекс общей строки XLSX."
          );
          value = shared[Number(raw)]!;
        } else if (cell.type === "b") {
          assert(raw === "0" || raw === "1", "Некорректное логическое значение Excel.");
          value = raw === "1" ? "TRUE" : "FALSE";
        } else if (cell.type === "e") value = `[ошибка Excel: ${raw}]`;
        else value = raw;
        if (cell.hasFormula) formulaCached++;
        if (cell.style && (cell.type === "n" || !cell.type)) styledNumeric++;
      }
      sparse.get(currentRow)!.set(cell.column, value);
      cell = null;
    }
  });
  assert(maxCol >= 0 && lastRow >= headerRow, "На выбранной строке и ниже нет данных.");
  const width = maxCol + 1,
    count = lastRow - headerRow;
  assert(
    width * (count + 1) <= XLSX_IMPORT_LIMITS.cells && count <= XLSX_IMPORT_LIMITS.rows,
    "Таблица превышает 80000 строк или 1 млн ячеек. Данные не усекались."
  );
  const head = sparse.get(headerRow);
  const headers = Array.from({ length: width }, (_, i) => head?.get(i) || `Столбец ${i + 1}`);
  const rows: string[][] = [];
  for (let r = headerRow + 1; r <= lastRow; r++) {
    const data = sparse.get(r);
    rows.push(Array.from({ length: width }, (_, i) => data?.get(i) ?? ""));
  }
  const warnings = [
    "Импорт использует сохранённые значения Excel. Формулы не вычисляются.",
    "Форматы отображения Excel (даты, проценты, лидирующие нули) не пересчитываются: числа и даты сохраняются как исходный текст; выбирайте числовой тип явно."
  ];
  if (formulaUncached)
    warnings.push(
      `Формул без сохранённого результата: ${formulaUncached}; показаны их тексты или предупреждения.`
    );
  if (formulaCached) warnings.push(`Формул с сохранённым результатом: ${formulaCached}.`);
  if (index.workbookDate1904)
    warnings.push("Книга использует дату 1904 года; Excel serial не конвертируется в дату.");
  if (styledNumeric)
    warnings.push(
      `Числовых ячеек с оформлением: ${styledNumeric}; формат отображения может отличаться от Excel.`
    );
  return { table: { delimiter: ",", headers, rows }, warnings, formulaCached, formulaUncached };
}
