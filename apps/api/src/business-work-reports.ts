import type { CreateManagerWork, ManagerWorkFiles, ManagerWorkPlan } from "@cosmora/contracts";
import {
  buildVersionChangeReport,
  compareSupplierOffers,
  extractFieldRegister,
  fieldRegisterCsv,
  type VersionChangeInput
} from "@cosmora/core";
import { Type } from "typebox";
import { Value } from "typebox/value";

const plans = {
  supplier_comparison: [
    "Сравнить предложения поставщиков",
    "Сопоставить позиции по ID, сверить комплектность и расходы."
  ],
  pdf_field_register: [
    "Извлечь поля из PDF",
    "Собрать значения с указанием страниц и статуса проверки."
  ],
  version_change_report: [
    "Сравнить версии данных",
    "Сопоставить строки по ключу и показать изменения."
  ]
} as const;

export function businessWorkPlan(request: CreateManagerWork): ManagerWorkPlan | null {
  const kind = request.output_contract?.kind;
  if (
    kind !== "supplier_comparison" &&
    kind !== "pdf_field_register" &&
    kind !== "version_change_report"
  )
    return null;
  const [summary, instructions] = plans[kind];
  return {
    summary,
    instructions,
    complexity: "simple",
    needs_critic: false,
    requires_external_actions: false
  };
}

const fieldInput = Type.Object(
  {
    fields: Type.Array(
      Type.Object(
        {
          label: Type.String({ minLength: 1, maxLength: 80, pattern: "^[^\\r\\n]+$" }),
          critical: Type.Optional(Type.Boolean())
        },
        { additionalProperties: false }
      ),
      { minItems: 1, maxItems: 24 }
    ),
    pages: Type.Array(
      Type.Object(
        {
          file_name: Type.String({ minLength: 1, maxLength: 255 }),
          page: Type.Integer({ minimum: 1, maximum: 10_000 }),
          text: Type.String({ maxLength: 240_000 }),
          source: Type.Union([Type.Literal("pdf_text"), Type.Literal("ocr")])
        },
        { additionalProperties: false }
      ),
      { minItems: 1, maxItems: 250 }
    )
  },
  { additionalProperties: false }
);

export function buildBusinessWorkFiles(request: CreateManagerWork): ManagerWorkFiles {
  const output = request.output_contract;
  if (output?.kind === "supplier_comparison") {
    const input = JSON.parse(request.goal) as Parameters<typeof compareSupplierOffers>[0];
    const result = compareSupplierOffers(input);
    return {
      files: [
        { name: "supplier-comparison.csv", content: result.csv },
        { name: "supplier-comparison.md", content: result.markdown }
      ]
    };
  }
  if (output?.kind === "version_change_report") {
    const input = JSON.parse(output.input) as VersionChangeInput;
    return {
      files: [
        { name: "version-change-report.md", content: buildVersionChangeReport(input).markdown }
      ]
    };
  }
  if (output?.kind === "pdf_field_register") {
    const input: unknown = JSON.parse(output.input) as unknown;
    if (!Value.Check(fieldInput, input)) throw Error("INVALID_BUSINESS_INPUT");
    const labels = input.fields.map((field) => field.label.trim());
    if (
      labels.some((label) => !label) ||
      new Set(labels.map((label) => label.toLowerCase())).size !== labels.length
    )
      throw Error("INVALID_BUSINESS_INPUT");
    const rows = extractFieldRegister(
      input.pages,
      input.fields.map((field, index) => {
        const label = labels[index]!;
        const prefix = label.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
        return {
          key: String(index + 1),
          label,
          critical: field.critical ?? false,
          patterns: ["(?:^|\\n)[ \\t]*" + prefix + "[ \\t]*[:=][ \\t]*([^\\r\\n]+)"]
        };
      })
    );
    return { files: [{ name: "pdf-field-register.csv", content: fieldRegisterCsv(rows) }] };
  }
  throw Error("INVALID_BUSINESS_INPUT");
}
