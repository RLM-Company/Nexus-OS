import { createHash } from "node:crypto";
import type {
  CreateManagerWork,
  ManagerWork,
  ManagerWorkFiles,
  ManagerWorkPlan,
  SupplierWorkEvidence
} from "@cosmora/contracts";
import {
  buildVersionChangeReport,
  compareSupplierOffers,
  extractFieldRegister,
  fieldRegisterCsv,
  resolveSupplierRules,
  type VersionChangeInput
} from "@cosmora/core";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { supplierWorkInput } from "./supplier-work-input.js";

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

export function buildBusinessWorkFiles(work: ManagerWork): ManagerWorkFiles {
  const { request } = work;
  const output = request.output_contract;
  if (output?.kind === "supplier_comparison") {
    const inputText = supplierWorkInput(work);
    const input = JSON.parse(inputText) as Parameters<typeof compareSupplierOffers>[0];
    const rules = work.correction_rules ?? [];
    const ruleResult = resolveSupplierRules(rules);
    const result = compareSupplierOffers(input, {
      separateDelivery: ruleResult.applied_rule_versions.some(
        (rule) => rule.effect === "delivery_separate_line"
      )
    });
    const files = [
      { name: "supplier-comparison.csv", content: result.csv },
      { name: "supplier-comparison.md", content: result.markdown }
    ];
    if (work.supplier_handoff || work.supplier_clarification || rules.length > 0) {
      const disputes: SupplierWorkEvidence["disputes"] = [];
      for (const row of result.rows) {
        for (const line of row.lines)
          for (const reason of line.issues)
            disputes.push({ supplier: row.supplier, item_id: line.itemId, reason });
        for (const item_id of row.unrequestedItems)
          disputes.push({ supplier: row.supplier, item_id, reason: "Позиция вне спецификации" });
        if (row.deliveryDays === null)
          disputes.push({ supplier: row.supplier, item_id: null, reason: "Срок не указан" });
        if (
          row.additionalCostsStatus === "не указаны" ||
          row.additionalCostsStatus === "частично известны"
        )
          disputes.push({
            supplier: row.supplier,
            item_id: null,
            reason: "Дополнительные расходы: " + row.additionalCostsStatus
          });
      }
      const evidence: SupplierWorkEvidence = {
        format: "kosmora.supplier-comparison-evidence.v1",
        input_sha256: createHash("sha256").update(inputText).digest("hex"),
        source_files: work.supplier_handoff?.inputs ?? [],
        applied_rule_versions: ruleResult.applied_rule_versions.flatMap((applied) => {
          const rule = rules.find((item) => item.id === applied.id);
          return rule ? [{ ...applied, name: rule.name }] : [];
        }),
        ignored_rules: rules
          .filter((rule) => ruleResult.ignored_rules.includes(rule.id))
          .map(({ id, name, version }) => ({ id, name, version })),
        conflicting_rules: ruleResult.conflicting_rules.flatMap((conflict) => {
          const rule = rules.find((item) => item.id === conflict.id);
          return rule ? [{ ...conflict, name: rule.name }] : [];
        }),
        checks: [
          "Проверена уникальность поставщиков и кодов позиций.",
          "Сопоставлены комплектация, единицы и цены по точному коду позиции.",
          "Проверены известные расходы и сроки. Пропуски отмечены отдельно."
        ],
        disputes
      };
      files.push(
        { name: "supplier-input.json", content: inputText },
        {
          name: "supplier-evidence.json",
          content: JSON.stringify(evidence, null, 2)
        }
      );
    }
    return { files };
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
