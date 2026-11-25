import { describe, expect, it } from "vitest";
import {
  extractFieldRegister,
  fieldRegisterCsv,
  type FieldPage,
  type FieldSpec
} from "../src/biz040-field-register.js";

/** Синтетический пакет BIZ-040: обычный PDF, скан и документ без поля. */
const pages: FieldPage[] = [
  {
    file_name: "contract.pdf",
    page: 2,
    source: "pdf_text",
    text: "Договор № 00123\nСумма: 19700\nСрок: 12 октября 2027\nКонтрагент: ООО Ромашка"
  },
  {
    file_name: "contract.pdf",
    page: 3,
    source: "pdf_text",
    text: "Сумма: 19700\nПодпись: директор"
  },
  {
    file_name: "scan.png.pdf",
    page: 1,
    source: "ocr",
    image_verified: true,
    text: "Dоговор № 00l23\nСумма: 197O0\nКонтрагент: ООО Ромашка"
  },
  {
    file_name: "invoice.pdf",
    page: 1,
    source: "pdf_text",
    text: "Счёт № 44\nОплата: 1200"
  }
];
const fields: FieldSpec[] = [
  { key: "contract", label: "Номер договора", patterns: ["№\\s*([0-9]{5})"], critical: true },
  { key: "amount", label: "Сумма", patterns: ["Сумма:\\s*([0-9]+)"], critical: true },
  { key: "date", label: "Срок", patterns: ["Срок:\\s*([0-9]+ [а-я]+ [0-9]{4})"] },
  { key: "counterparty", label: "Контрагент", patterns: ["Контрагент:\\s*([^\\n]+)"] },
  { key: "penalty", label: "Неустойка", patterns: ["Неустойка:\\s*([0-9]+)"], critical: true }
];

describe("BIZ-040 field register", () => {
  it("marks a critical field that was never checked against the page image", () => {
    const rows = extractFieldRegister(pages, fields);
    const contract = rows.find((row) => row.field_key === "contract")!;
    expect(contract.status).toBe("critical_unverified");
    expect(contract.value).toBe("00123");
    expect(contract.file_name).toBe("contract.pdf");
    expect(contract.page).toBe(2);
    expect(contract.note).toContain("изображением");
    const date = rows.find((row) => row.field_key === "date")!;
    expect(date.status).toBe("text_verified");
  });

  it("reports missing critical and suspicious OCR explicitly", () => {
    const rows = extractFieldRegister(pages, fields);
    const penalty = rows.find((row) => row.field_key === "penalty")!;
    expect(penalty).toMatchObject({ status: "missing", value: "", file_name: "", page: "" });
    const onlyScan = extractFieldRegister(
      [{ ...pages[2]!, image_verified: false }],
      [{ key: "amount", label: "Сумма", patterns: ["Сумма:\\s*([0-9A-Za-z]+)"], critical: true }]
    );
    expect(onlyScan[0]!.status).toBe("critical_unverified");
    expect(onlyScan[0]!.note.toLowerCase()).toContain("сомнительные");
  });

  it("keeps an image-verified value and surfaces contradictions between files", () => {
    const imageChecked: FieldPage = {
      ...pages[2]!,
      image_verified: true,
      text: "Сумма: 19700"
    };
    const verified = extractFieldRegister([imageChecked], [fields[1]!]);
    expect(verified[0]!.status).toBe("image_verified");
    const conflicting = extractFieldRegister(
      [pages[0]!, { ...pages[3]!, text: "Сумма: 1200" }],
      [fields[1]!]
    );
    expect(conflicting[0]!.status).toBe("contradiction");
    expect(conflicting[0]!.note).toContain("19700");
    expect(conflicting[0]!.note).toContain("1200");
  });

  it("produces a downloadable CSV with value, file, page and status", () => {
    const csv = fieldRegisterCsv(extractFieldRegister(pages, fields));
    expect(
      csv.startsWith("\ufefffield_key,field,value,file_name,page,source,verification_status")
    ).toBe(true);
    expect(csv).toContain("contract.pdf,2,pdf_text,critical_unverified");
    expect(csv).toContain("missing");
    expect(csv).toContain('"Противоречие');
  });
});
