/** XLSX import is strictly local. No DOMParser, external I/O, eval, or formula execution. */
import { BoundedZip, zipMemberNameOk } from "./bounded-zip";
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

export type XlsxSheet = { name: string; path: string; hidden: boolean };
export type XlsxIndex = { sheets: XlsxSheet[]; workbookDate1904: boolean };
export type XlsxImported = {
  table: CsvTable;
  warnings: string[];
  formulaCached: number;
  formulaUncached: number;
};
const decoder = new TextDecoder("utf-8", { fatal: true });
const utf8 = (bytes: Uint8Array) => decoder.decode(bytes);
function assert(ok: unknown, error: string): asserts ok {
  if (!ok) throw new Error(error);
}

export class SafeXlsxZip extends BoundedZip {
  constructor(input: ArrayBuffer | Uint8Array) {
    super(input, XLSX_IMPORT_LIMITS);
    assert(
      this.has("[Content_Types].xml") &&
        this.has("_rels/.rels") &&
        this.has("xl/workbook.xml") &&
        this.has("xl/_rels/workbook.xml.rels"),
      "Это не поддерживаемый XLSX-пакет."
    );
    assert(
      !this.names.some(
        (name) =>
          name === "xl/vbaProject.bin" ||
          name.startsWith("xl/externalLinks/") ||
          name.startsWith("xl/embeddings/")
      ),
      "Внешние или встроенные объекты в XLSX запрещены."
    );
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
  assert(zipMemberNameOk(path), "Некорректный путь XLSX.");
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
