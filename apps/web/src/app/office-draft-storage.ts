import type { OfficeOperation } from "@cosmora/contracts";
import { editedOfficeRange, officeCellDraft, validateEditableOfficePlan } from "./office-plan";
import { officeCellValue } from "./office-range";

export const OFFICE_DRAFT_PREFIX = "koswork:office-plan:v1:";
export const OFFICE_DRAFT_LIMITS = {
  entries: 20,
  characters: 400_000,
  record: 24_000,
  ageMs: 7 * 86400_000
};
type DraftStorage = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;
export type OfficeDraftSource = { name: string; version: string; existingSheets: number };
export type OfficeDraftSnapshot = {
  raw: string | null;
  operations: OfficeOperation[] | null;
  notice: string;
};
const conflict = () =>
  Error(
    "Сохранённый черновик изменился в другой вкладке. Проверьте его снова; текущий план сохранён в редакторе."
  );
const invalid = () => Error("Черновик повреждён или не поддерживается. Восстановление отклонено.");
function exact(value: unknown, keys: string[]): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}
export function officeDraftKey(source: OfficeDraftSource): string {
  if (
    !source.name ||
    source.name.length > 255 ||
    /[\\/]/.test(source.name) ||
    source.name.includes(String.fromCharCode(0)) ||
    !/\.(docx|xlsx|pptx)$/i.test(source.name) ||
    !/^sha256:[a-f0-9]{64}$/.test(source.version) ||
    !Number.isInteger(source.existingSheets) ||
    source.existingSheets < 0 ||
    source.existingSheets > 999
  )
    throw invalid();
  return OFFICE_DRAFT_PREFIX + encodeURIComponent(source.name);
}
function checkedOperations(value: unknown, source: OfficeDraftSource): OfficeOperation[] {
  if (!Array.isArray(value) || !value.length || value.length > 40) throw invalid();
  const xlsx = /\.xlsx$/i.test(source.name);
  const cell = (v: unknown) => {
    if (
      v !== null &&
      typeof v !== "string" &&
      typeof v !== "number" &&
      typeof v !== "boolean" &&
      !(exact(v, ["formula"]) && typeof v.formula === "string")
    )
      throw invalid();
    const draft = officeCellDraft(v as Parameters<typeof officeCellDraft>[0]);
    officeCellValue(draft.text, draft.type);
  };
  for (const candidate of value as unknown[]) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw invalid();
    const op = candidate as Record<string, unknown>;
    if (op.kind === "replace_text" && !xlsx) {
      if (
        !exact(op, ["kind", "target", "find", "replace"]) ||
        typeof op.target !== "string" ||
        typeof op.find !== "string" ||
        typeof op.replace !== "string"
      )
        throw invalid();
    } else if (op.kind === "add_sheet" && xlsx) {
      if (!exact(op, ["kind", "name"]) || typeof op.name !== "string") throw invalid();
    } else if (op.kind === "set_cell" && xlsx) {
      if (
        !exact(op, ["kind", "target", "address", "value"]) ||
        typeof op.target !== "string" ||
        typeof op.address !== "string"
      )
        throw invalid();
      cell(op.value);
    } else if (op.kind === "set_range" && xlsx) {
      if (
        !exact(op, ["kind", "target", "start", "rows"]) ||
        typeof op.target !== "string" ||
        typeof op.start !== "string" ||
        !Array.isArray(op.rows) ||
        op.rows.length > 10
      )
        throw invalid();
      for (const row of op.rows) {
        if (!Array.isArray(row) || row.length > 10) throw invalid();
        for (const v of row) cell(v);
      }
      editedOfficeRange(
        op.target,
        op.start,
        op.rows.map((row: unknown[]) =>
          row.map((v) => officeCellDraft(v as Parameters<typeof officeCellDraft>[0]))
        )
      );
    } else throw invalid();
  }
  const operations = value as OfficeOperation[];
  validateEditableOfficePlan(operations, source.existingSheets);
  return structuredClone(operations);
}
export function readOfficeDraft(
  storage: DraftStorage,
  source: OfficeDraftSource,
  now = Date.now()
): OfficeDraftSnapshot {
  const raw = storage.getItem(officeDraftKey(source));
  if (raw === null)
    return { raw, operations: null, notice: "Сохранённого черновика для этого имени файла нет." };
  try {
    if (raw.length > OFFICE_DRAFT_LIMITS.record) throw invalid();
    const record: unknown = JSON.parse(raw);
    if (
      !exact(record, [
        "schema",
        "revision",
        "savedAt",
        "name",
        "source_version",
        "existingSheets",
        "operations"
      ]) ||
      record.schema !== 1 ||
      typeof record.revision !== "string" ||
      record.revision.length > 80 ||
      !record.revision ||
      typeof record.savedAt !== "number" ||
      !Number.isFinite(record.savedAt) ||
      record.savedAt > now + 60_000
    )
      throw invalid();
    if (now - record.savedAt > OFFICE_DRAFT_LIMITS.ageMs)
      return {
        raw,
        operations: null,
        notice: "Срок восстановления черновика истёк (7 дней). Удалите его, чтобы сохранить новый."
      };
    if (
      record.name !== source.name ||
      record.source_version !== source.version ||
      record.existingSheets !== source.existingSheets
    )
      return {
        raw,
        operations: null,
        notice:
          "Версия исходника отличается от сохранённого черновика. Восстановление отклонено; выберите исходную версию или удалите черновик."
      };
    return {
      raw,
      operations: checkedOperations(record.operations, source),
      notice:
        "Найден сохранённый черновик. Восстановление заменит текущий план; потребуется новый preview."
    };
  } catch {
    return { raw, operations: null, notice: invalid().message };
  }
}
export function saveOfficeDraft(
  storage: DraftStorage,
  source: OfficeDraftSource,
  operations: OfficeOperation[],
  expected: string | null,
  revision: string,
  now = Date.now()
): OfficeDraftSnapshot {
  const key = officeDraftKey(source);
  if (!revision || revision.length > 80 || !Number.isFinite(now)) throw invalid();
  if (storage.getItem(key) !== expected) throw conflict();
  const existing = readOfficeDraft(storage, source, now);
  if (existing.raw !== null && existing.operations === null) throw Error(existing.notice);
  const raw = JSON.stringify({
    schema: 1,
    revision,
    savedAt: now,
    name: source.name,
    source_version: source.version,
    existingSheets: source.existingSheets,
    operations: checkedOperations(operations, source)
  });
  if (raw.length > OFFICE_DRAFT_LIMITS.record)
    throw Error("Черновик превышает допустимый размер; текущий план остаётся в редакторе.");
  let entries = 1,
    characters = raw.length + key.length;
  for (let i = 0; i < storage.length; i++) {
    const other = storage.key(i);
    if (!other?.startsWith(OFFICE_DRAFT_PREFIX) || other === key) continue;
    entries++;
    characters += other.length + (storage.getItem(other)?.length ?? 0);
  }
  if (entries > OFFICE_DRAFT_LIMITS.entries || characters > OFFICE_DRAFT_LIMITS.characters)
    throw Error(
      "Хранилище Office-черновиков заполнено. Удалите ненужные черновики; текущий план остаётся в редакторе."
    );
  // A single bounded record prevents partially saved plans. Never evict chat or other Office drafts.
  storage.setItem(key, raw);
  return readOfficeDraft(storage, source, now);
}
export function restoreOfficeDraft(
  storage: DraftStorage,
  source: OfficeDraftSource,
  expected: string
): OfficeOperation[] {
  const snapshot = readOfficeDraft(storage, source);
  if (snapshot.raw !== expected) throw conflict();
  if (!snapshot.operations) throw Error(snapshot.notice);
  return snapshot.operations;
}
export function deleteOfficeDraft(
  storage: DraftStorage,
  source: OfficeDraftSource,
  expected: string
): void {
  const key = officeDraftKey(source);
  if (storage.getItem(key) !== expected) throw conflict();
  storage.removeItem(key);
}
