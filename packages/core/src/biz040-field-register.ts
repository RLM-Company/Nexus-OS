/** BIZ-040 — extracted field register for PDFs and scans.
 * Pure core logic: callers supply already extracted page text and whether the
 * page image/OCR was actually reviewed. No filesystem, model or DOM access. */

export type FieldSourceKind = "pdf_text" | "ocr" | "image";
export type FieldPage = {
  file_name: string;
  page: number;
  text: string;
  source: FieldSourceKind;
  /** True only when the value was checked against the rendered page image. */
  image_verified?: boolean;
};
export type FieldSpec = {
  key: string;
  label: string;
  /** Plain substrings or regex source strings, matched case-insensitively. */
  patterns: string[];
  critical?: boolean;
};
export type RegisterStatus =
  | "text_verified"
  | "image_verified"
  | "ocr_uncertain"
  | "contradiction"
  | "missing"
  | "critical_unverified";
export type FieldRow = {
  field_key: string;
  field: string;
  value: string;
  file_name: string;
  page: number | "";
  source: FieldSourceKind | "";
  status: RegisterStatus;
  note: string;
  critical: boolean;
};

// Tesseract-style glyph confusions that must not be presented as confident data.
const SUSPICIOUS = /[Oo][0]|[0][Oo]|[Il][1]|[1][Il]|[|]/u;
const normalize = (value: string) => value.replace(/\s+/gu, " ").trim();
const matchValue = (text: string, pattern: string): string | null => {
  try {
    const match = new RegExp(pattern, "iu").exec(text);
    return match ? normalize(match[1] ?? match[0]) : null;
  } catch {
    // Plain substring fallback keeps field specs simple for callers.
    const at = text.toLowerCase().indexOf(pattern.toLowerCase());
    return at < 0 ? null : normalize(text.slice(at, at + pattern.length));
  }
};
const valueOf = (page: FieldPage, field: FieldSpec): string | null => {
  for (const pattern of field.patterns) {
    const value = matchValue(page.text, pattern);
    if (value) return value;
  }
  return null;
};

/** One row per requested field. A contradiction wins over a single confident
 * match; an unreviewed critical value is never silently marked verified. */
export function extractFieldRegister(
  pages: readonly FieldPage[],
  fields: readonly FieldSpec[]
): FieldRow[] {
  return fields.map((field) => {
    const found = pages
      .map((page) => ({ page, value: valueOf(page, field) }))
      .filter((entry): entry is { page: FieldPage; value: string } => entry.value !== null);
    const distinct = [...new Set(found.map((entry) => entry.value))];
    const base = {
      field_key: field.key,
      field: field.label,
      critical: Boolean(field.critical)
    };
    if (!found.length)
      return {
        ...base,
        value: "",
        file_name: "",
        page: "",
        source: "",
        status: "missing",
        note: "Поле не найдено ни в одном выбранном файле."
      };
    if (distinct.length > 1)
      return {
        ...base,
        value: found[0]!.value,
        file_name: found[0]!.page.file_name,
        page: found[0]!.page.page,
        source: found[0]!.page.source,
        status: "contradiction",
        note: `Противоречие: ${distinct.map((value) => JSON.stringify(value)).join(", ")}.`
      };
    const chosen = found[0]!;
    const imageVerified = found.some((entry) => entry.page.image_verified === true);
    const uncertain =
      !imageVerified &&
      (SUSPICIOUS.test(chosen.value) ||
        found.some((entry) => entry.page.source === "ocr" && SUSPICIOUS.test(entry.value)));
    let status: RegisterStatus;
    let note: string;
    if (uncertain) {
      status = field.critical && !imageVerified ? "critical_unverified" : "ocr_uncertain";
      note = "Сомнительные символы OCR требуют сверки с изображением страницы.";
    } else if (imageVerified) {
      status = "image_verified";
      note = "Значение сверено с изображением страницы.";
    } else if (chosen.page.source === "pdf_text") {
      status = field.critical ? "critical_unverified" : "text_verified";
      note = field.critical
        ? "Критичное поле не сверено с изображением страницы."
        : "Извлечено из встроенного текста PDF; изображение не проверялось.";
    } else {
      status = field.critical ? "critical_unverified" : "ocr_uncertain";
      note = field.critical
        ? "Критичное поле распознано OCR, но не сверено с изображением страницы."
        : "Распознано OCR без сверки с изображением страницы.";
    }
    return {
      ...base,
      value: chosen.value,
      file_name: chosen.page.file_name,
      page: chosen.page.page,
      source: chosen.page.source,
      status,
      note
    };
  });
}

const csvCell = (value: string | number): string => {
  const text = String(value);
  return /[",\r\n]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
};

/** Download-ready CSV: value, file name, page, verification status. */
export function fieldRegisterCsv(rows: readonly FieldRow[]): string {
  const header = [
    "field_key",
    "field",
    "value",
    "file_name",
    "page",
    "source",
    "verification_status",
    "critical",
    "note"
  ];
  const lines = [
    header,
    ...rows.map((row) => [
      row.field_key,
      row.field,
      row.value,
      row.file_name,
      row.page,
      row.source,
      row.status,
      row.critical ? "yes" : "no",
      row.note
    ])
  ];
  return "\ufeff" + lines.map((line) => line.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
