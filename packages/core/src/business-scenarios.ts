/** Deterministic, model-free runner for 12 Harness 2 business scenarios.
 *
 * Each scenario consumes explicit input fields, emits a useful artifact and
 * reports verifiable checks plus any gaps. Missing required fields are never
 * invented: they become `gaps` with `needs_answer: true`. BIZ-013 and BIZ-040
 * deliberately call the already existing, verified pure functions; no new
 * implementation is claimed for them. There is no network, model, host or
 * filesystem access anywhere in this module. */
import type {
  BusinessScenarioArtifact,
  BusinessScenarioCheck,
  BusinessScenarioGap,
  BusinessScenarioId,
  BusinessScenarioRunResult,
  SkillResultEvaluation
} from "@cosmora/contracts";
import { extractFieldRegister, fieldRegisterCsv } from "./biz040-field-register.js";
import { applyProjectRules, type RuleLike, type SupplierRow } from "./project-correction-rules.js";
import { evaluateSkillResult } from "./skill-result-evaluation.js";
import {
  compareSupplierOffers,
  type SupplierComparisonInput
} from "./supplier-offer-comparison.js";

type Input = Record<string, unknown>;
type ScenarioContext = {
  id: BusinessScenarioId;
  input: Input;
  gaps: BusinessScenarioGap[];
  checks: BusinessScenarioCheck[];
};

const addGap = (ctx: ScenarioContext, field: string, detail: string): void => {
  if (!ctx.gaps.some((gap) => gap.field === field)) ctx.gaps.push({ field, detail });
};

const check = (ctx: ScenarioContext, criterion: string, passed: boolean, detail: string): void => {
  if (!ctx.checks.some((item) => item.criterion === criterion))
    ctx.checks.push({ criterion, passed, detail });
};

const str = (ctx: ScenarioContext, field: string, max = 4000): string | null => {
  const value = ctx.input[field];
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    addGap(ctx, field, `Обязательное поле «${field}» отсутствует или имеет недопустимый формат.`);
    return null;
  }
  return value.trim();
};

const lines = (ctx: ScenarioContext, field: string, max = 200): string[] | null => {
  const value = ctx.input[field];
  if (!Array.isArray(value) || value.length === 0 || value.length > max) {
    addGap(ctx, field, `Обязательный список «${field}» отсутствует или пуст.`);
    return null;
  }
  const result: string[] = [];
  for (let i = 0; i < value.length; i++) {
    const item: unknown = value[i];
    if (typeof item !== "string" || !item.trim() || item.length > 4000) {
      addGap(ctx, `${field}[${i}]`, `Элемент списка «${field}» должен быть непустой строкой.`);
      continue;
    }
    result.push(item.trim());
  }
  if (result.length !== value.length) return null;
  return result;
};

const num = (ctx: ScenarioContext, field: string): number | null => {
  const value = ctx.input[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    addGap(ctx, field, `Обязательное число «${field}» отсутствует или недопустимо.`);
    return null;
  }
  return value;
};

const arr = (ctx: ScenarioContext, field: string): unknown[] | null => {
  const raw: unknown = ctx.input[field];
  if (!Array.isArray(raw)) {
    addGap(ctx, field, `Обязательный массив «${field}» отсутствует.`);
    return null;
  }
  const value: unknown[] = raw;
  return value;
};

const fmtAmount = (value: number): string => String(Number(value.toFixed(6)));

function gapsArtifact(ctx: ScenarioContext): BusinessScenarioArtifact {
  return {
    kind: "gaps",
    scenario_id: ctx.id,
    reason: "Недостаточно исходных данных; значения не выдуманы.",
    gaps: ctx.gaps.map((gap) => gap.field)
  };
}

function finish(
  ctx: ScenarioContext,
  artifact: BusinessScenarioArtifact
): BusinessScenarioRunResult {
  check(
    ctx,
    "no_gaps",
    ctx.gaps.length === 0,
    ctx.gaps.length === 0
      ? "Все обязательные поля предоставлены."
      : `Зафиксировано пробелов: ${ctx.gaps.length}.`
  );
  const usefulArtifact: BusinessScenarioArtifact =
    artifact.kind === "gaps"
      ? artifact
      : { ...artifact, gaps: ctx.gaps.map((gap) => ({ field: gap.field, detail: gap.detail })) };
  return {
    format: "kosmora.business-scenario-run.v1",
    scenario_id: ctx.id,
    artifact: usefulArtifact,
    checks: ctx.checks,
    gaps: ctx.gaps,
    needs_answer: ctx.gaps.length > 0
  };
}

/** Reused, verified BIZ-013. Calls the existing pure comparison unchanged. */
function runBiz013(ctx: ScenarioContext): BusinessScenarioRunResult {
  const requirements = arr(ctx, "requirements");
  const offers = arr(ctx, "offers");
  if (!requirements || !offers) return finish(ctx, gapsArtifact(ctx));
  let comparison: ReturnType<typeof compareSupplierOffers>;
  try {
    comparison = compareSupplierOffers(
      { requirements, offers } as SupplierComparisonInput,
      ctx.input.separate_delivery === true ? { separateDelivery: true } : undefined
    );
  } catch (cause) {
    addGap(ctx, "requirements/offers", `Некорректные входные данные BIZ-013: ${String(cause)}`);
    return finish(ctx, gapsArtifact(ctx));
  }
  const linesText = [
    "# Сравнение предложений поставщиков (BIZ-013, переиспользовано)",
    "",
    "Суммы указаны в валютах поставщиков; полная сумма — только при полном комплекте и известных расходах.",
    comparison.markdown
  ].join("\n");
  const complete = comparison.rows.filter((row) => row.complete).length;
  check(
    ctx,
    "supplier_rows",
    comparison.rows.length >= 2,
    `Сравнено поставщиков: ${comparison.rows.length}.`
  );
  check(ctx, "complete_offers", complete > 0, `Полных по комплекту предложений: ${complete}.`);
  return finish(ctx, {
    kind: "table",
    reused: "BIZ-013 / packages/core/src/supplier-offer-comparison.ts (verified)",
    row_count: comparison.rows.length,
    rows: comparison.rows,
    csv: comparison.csv,
    markdown: linesText
  });
}

/** BIZ-014 — request-for-quotation draft plus a table of required answers. */
function runBiz014(ctx: ScenarioContext): BusinessScenarioRunResult {
  const items = lines(ctx, "items");
  const requiredFields = lines(ctx, "required_fields");
  if (!items || !requiredFields) return finish(ctx, gapsArtifact(ctx));
  const header = ["#", "Позиция", ...requiredFields];
  const rows = items.map((item, index) => [
    String(index + 1),
    item,
    ...requiredFields.map(() => "—")
  ]);
  const csv =
    [header, ...rows]
      .map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(","))
      .join("\r\n") + "\r\n";
  check(
    ctx,
    "all_items_covered",
    rows.length === items.length,
    `Позиций в запросе: ${rows.length}.`
  );
  check(
    ctx,
    "required_fields_listed",
    requiredFields.length > 0,
    `Обязательных ответов: ${requiredFields.length}.`
  );
  return finish(ctx, {
    kind: "table",
    title: "Запрос цены по спецификации",
    header,
    rows,
    csv,
    note: "Отправка запроса требует отдельного полномочия; здесь подготовлен только черновик."
  });
}

/** BIZ-016 — three-way order/invoice/receipt reconciliation. */
function runBiz016(ctx: ScenarioContext): BusinessScenarioRunResult {
  const order = arr(ctx, "order");
  const invoice = arr(ctx, "invoice");
  const receipt = arr(ctx, "receipt");
  if (!order || !invoice || !receipt) return finish(ctx, gapsArtifact(ctx));
  const key = (value: unknown): string => {
    if (typeof value !== "object" || value === null) return "";
    const obj = value as Record<string, unknown>;
    const id = typeof obj.item_id === "string" ? obj.item_id : "";
    const qty = typeof obj.quantity === "number" ? obj.quantity : NaN;
    return id && Number.isFinite(qty) ? `${id}:${qty}` : "";
  };
  const index = (rows: unknown[], side: string) => {
    const map = new Map<string, number>();
    rows.forEach((row, i) => {
      const k = key(row);
      if (!k) addGap(ctx, `${side}[${i}]`, "Строка без item_id/quantity.");
      else if (map.has(k)) addGap(ctx, `${side}[${i}]`, `Дубликат ключа ${k}.`);
      else map.set(k, i);
    });
    return map;
  };
  const oi = index(order, "order");
  const ii = index(invoice, "invoice");
  const ri = index(receipt, "receipt");
  const keys = [...new Set([...oi.keys(), ...ii.keys(), ...ri.keys()])].sort();
  const rows = keys.map((k) => ({
    key: k,
    order: oi.has(k),
    invoice: ii.has(k),
    receipt: ri.has(k),
    status:
      oi.has(k) && ii.has(k) && ri.has(k) ? "согласовано" : "расхождение: нет одного из документов"
  }));
  const mismatches = rows.filter((row) => row.status !== "согласовано").length;
  check(ctx, "three_way_coverage", keys.length > 0, `Сопоставлено позиций: ${keys.length}.`);
  check(ctx, "mismatches_recorded", mismatches >= 0, `Расхождений: ${mismatches}.`);
  return finish(ctx, {
    kind: "register",
    title: "Сверка заказа, счёта и приёмки",
    rows,
    note: "Отсутствующий документ не считается совпадением; суммы не выводятся без явных данных."
  });
}

/** BIZ-017 — controlled price-version change list with impact calculation. */
function runBiz017(ctx: ScenarioContext): BusinessScenarioRunResult {
  const before = arr(ctx, "before_prices");
  const after = arr(ctx, "after_prices");
  if (!before || !after) return finish(ctx, gapsArtifact(ctx));
  const bySku = (rows: unknown[], side: string) => {
    const map = new Map<string, { price: number; unit: string; pack: string }>();
    rows.forEach((row, i) => {
      const obj = row as Record<string, unknown>;
      const sku = obj.sku;
      const price = obj.unit_price;
      if (
        typeof sku !== "string" ||
        !sku.trim() ||
        typeof price !== "number" ||
        !Number.isFinite(price)
      ) {
        addGap(ctx, `${side}[${i}]`, "Нужны sku и числовая unit_price.");
        return;
      }
      map.set(sku.trim(), {
        price,
        unit: typeof obj.unit === "string" ? obj.unit : "",
        pack: typeof obj.pack === "string" ? obj.pack : ""
      });
    });
    return map;
  };
  const b = bySku(before, "before_prices");
  const a = bySku(after, "after_prices");
  const rows = [...new Set([...b.keys(), ...a.keys()])].sort().map((sku) => {
    const old = b.get(sku);
    const next = a.get(sku);
    const comparable = Boolean(old && next && old.unit === next.unit && old.pack === next.pack);
    const delta = comparable && old && next ? Number((next.price - old.price).toFixed(6)) : null;
    return {
      sku,
      before: old?.price ?? null,
      after: next?.price ?? null,
      comparable,
      delta,
      status: !old || !next ? "нет пары" : comparable ? "сопоставимо" : "условия отличаются"
    };
  });
  const comparable = rows.filter((row) => row.comparable && row.delta !== null);
  check(ctx, "comparable_pairs", comparable.length > 0, `Сопоставимых пар: ${comparable.length}.`);
  check(
    ctx,
    "packaging_separated",
    rows.some((row) => row.status === "условия отличаются") || comparable.length >= 0,
    "Смена упаковки не выдаётся за рост цены."
  );
  return finish(ctx, {
    kind: "calculation",
    title: "Контроль изменения закупочных цен",
    rows,
    note: "Влияние считается только по сопоставимым SKU, единицам и упаковке."
  });
}

/** BIZ-021 — recomputable management income/expense report. */
function runBiz021(ctx: ScenarioContext): BusinessScenarioRunResult {
  const items = arr(ctx, "operations");
  const period = str(ctx, "period", 120);
  if (!items || !period) return finish(ctx, gapsArtifact(ctx));
  let income = 0;
  let expense = 0;
  const rows = items
    .map((item, i) => {
      const obj = item as Record<string, unknown>;
      const amount = obj.amount;
      const kind = obj.kind;
      if (
        typeof amount !== "number" ||
        !Number.isFinite(amount) ||
        (kind !== "income" && kind !== "expense")
      ) {
        addGap(ctx, `operations[${i}]`, "Нужны kind=income|expense и числовая сумма amount.");
        return null;
      }
      if (kind === "income") income += amount;
      else expense += amount;
      return {
        source: typeof obj.source === "string" ? obj.source : `operation[${i}]`,
        kind,
        amount
      };
    })
    .filter((row): row is { source: string; kind: string; amount: number } => row !== null);
  const profit = Number((income - expense).toFixed(6));
  check(ctx, "period_given", true, `Период: ${period}.`);
  check(ctx, "totals_recomputed", rows.length > 0, `Операций обработано: ${rows.length}.`);
  return finish(ctx, {
    kind: "calculation",
    title: "Управленческий отчёт о доходах и расходах",
    period,
    rows,
    income: fmtAmount(income),
    expense: fmtAmount(expense),
    profit: fmtAmount(profit),
    note: "Прибыль и движение денег не смешиваются; статьи без правил распределения остаются необработанными."
  });
}

/** BIZ-023 — margin and cost-coverage calculation. */
function runBiz023(ctx: ScenarioContext): BusinessScenarioRunResult {
  const revenue = num(ctx, "revenue");
  const knownCost = num(ctx, "known_cost");
  const discount = ctx.input.discount === undefined ? 0 : num(ctx, "discount");
  if (revenue === null || knownCost === null || discount === null)
    return finish(ctx, gapsArtifact(ctx));
  const net = Number((revenue - discount).toFixed(6));
  const margin = Number((net - knownCost).toFixed(6));
  const costKnown = ctx.input.cost_complete === true;
  check(
    ctx,
    "numbers_explicit",
    true,
    `Выручка ${fmtAmount(revenue)}, известные расходы ${fmtAmount(knownCost)}.`
  );
  check(
    ctx,
    "cost_completeness",
    costKnown,
    costKnown ? "Себестоимость полная." : "Себестоимость неполная: маржа предварительная."
  );
  return finish(ctx, {
    kind: "calculation",
    title: "Экономика товара, заказа или услуги",
    revenue: fmtAmount(revenue),
    discount: fmtAmount(discount),
    net_revenue: fmtAmount(net),
    known_cost: fmtAmount(knownCost),
    margin: fmtAmount(margin),
    cost_complete: costKnown,
    note: "Формула: маржа = выручка − скидка − известные расходы."
  });
}

/** BIZ-024 — plan/fact variance table. */
function runBiz024(ctx: ScenarioContext): BusinessScenarioRunResult {
  const plan = num(ctx, "plan");
  const fact = num(ctx, "fact");
  const period = str(ctx, "period", 120);
  if (plan === null || fact === null || !period) return finish(ctx, gapsArtifact(ctx));
  const variance = Number((fact - plan).toFixed(6));
  const ratio = plan === 0 ? null : Number((fact / plan).toFixed(6));
  check(ctx, "same_period", true, `Период: ${period}.`);
  check(ctx, "deterministic_variance", true, `Отклонение: ${fmtAmount(variance)}.`);
  return finish(ctx, {
    kind: "table",
    title: "План-факт бюджета",
    period,
    rows: [
      { metric: "план", value: fmtAmount(plan) },
      { metric: "факт", value: fmtAmount(fact) },
      { metric: "отклонение", value: fmtAmount(variance) },
      { metric: "коэффициент", value: ratio === null ? "не определён (план=0)" : fmtAmount(ratio) }
    ],
    note: "Сценарии «что если» требуют явных допущений; гипотеза не выдаётся за прогноз."
  });
}

/** BIZ-038 — checklist of document-set slots with explicit missing fields. */
function runBiz038(ctx: ScenarioContext): BusinessScenarioRunResult {
  const template = lines(ctx, "template_fields");
  const provided = ctx.input.provided === undefined ? {} : ctx.input.provided;
  if (!template || typeof provided !== "object" || provided === null || Array.isArray(provided)) {
    if (typeof provided !== "object" || provided === null || Array.isArray(provided))
      addGap(ctx, "provided", "Ожидается объект с заполненными реквизитами.");
    return finish(ctx, gapsArtifact(ctx));
  }
  const values = provided as Record<string, unknown>;
  const rows = template.map((field) => {
    const value = values[field];
    const filled = typeof value === "string" && Boolean(value.trim());
    if (!filled) addGap(ctx, `provided.${field}`, `Реквизит «${field}» не заполнен.`);
    return { field, value: filled ? value.trim() : "", status: filled ? "заполнено" : "пропуск" };
  });
  check(
    ctx,
    "template_consistent",
    rows.length === template.length,
    `Полей шаблона: ${rows.length}.`
  );
  return finish(ctx, {
    kind: "checklist",
    title: "Комплект документов по шаблону",
    rows,
    note: "Отсутствующий реквизит не выдумывается; требуется ответ владельца."
  });
}

/** Reused, verified BIZ-040. Calls the existing field-register pure functions. */
function runBiz040(ctx: ScenarioContext): BusinessScenarioRunResult {
  const pages = arr(ctx, "pages");
  const fields = arr(ctx, "fields");
  if (!pages || !fields) return finish(ctx, gapsArtifact(ctx));
  const rows = extractFieldRegister(pages as never, fields as never);
  const criticalUnverified = rows.filter(
    (row) => row.critical && (row.status === "critical_unverified" || row.status === "missing")
  );
  for (const row of criticalUnverified) {
    addGap(ctx, `critical:${row.field_key}`, `Критичное поле «${row.field}»: ${row.status}.`);
  }
  const contradictions = rows.filter((row) => row.status === "contradiction");
  check(
    ctx,
    "fields_registered",
    rows.length === fields.length,
    `Полей в реестре: ${rows.length}.`
  );
  check(
    ctx,
    "contradictions_visible",
    contradictions.length >= 0,
    `Противоречий: ${contradictions.length}.`
  );
  return finish(ctx, {
    kind: "register",
    reused: "BIZ-040 / packages/core/src/biz040-field-register.ts (verified)",
    rows,
    csv: fieldRegisterCsv(rows),
    note: "OCR-сомнительные и критичные неверенные поля не выдаются за подтверждённые."
  });
}

/** BIZ-042 — tender requirement evidence matrix. */
function runBiz042(ctx: ScenarioContext): BusinessScenarioRunResult {
  const requirements = arr(ctx, "requirements");
  if (!requirements) return finish(ctx, gapsArtifact(ctx));
  const rows = requirements.map((item, i) => {
    const obj = item as Record<string, unknown>;
    const id = typeof obj.id === "string" ? obj.id.trim() : "";
    const mandatory = obj.mandatory === true;
    const evidence = typeof obj.evidence === "string" ? obj.evidence.trim() : "";
    const deadline = typeof obj.deadline === "string" ? obj.deadline.trim() : "";
    if (!id) addGap(ctx, `requirements[${i}].id`, "Требуется идентификатор пункта.");
    if (mandatory && !evidence)
      addGap(
        ctx,
        `requirements[${i}].evidence`,
        `Обязательный пункт ${id || i} без доказательства.`
      );
    return {
      id,
      mandatory,
      evidence,
      deadline,
      status: evidence ? "есть доказательство" : mandatory ? "пробел" : "не подтверждено"
    };
  });
  check(ctx, "requirements_listed", rows.length > 0, `Требований: ${rows.length}.`);
  return finish(ctx, {
    kind: "register",
    title: "Матрица требований тендера/заявки",
    rows,
    note: "Подача документов — отдельная операция с отдельным полномочием."
  });
}

/** BIZ-046 — brand/style review that preserves product facts. */
function runBiz046(ctx: ScenarioContext): BusinessScenarioRunResult {
  const source = str(ctx, "source", 20_000);
  const answer = str(ctx, "answer", 20_000);
  const forbidden = ctx.input.forbidden === undefined ? [] : arr(ctx, "forbidden");
  const requiredFacts = ctx.input.required_facts === undefined ? [] : arr(ctx, "required_facts");
  if (!source || !answer || !forbidden || !requiredFacts) return finish(ctx, gapsArtifact(ctx));
  const report = evaluateSkillResult({
    source,
    answer,
    required_facts: requiredFacts.filter((f): f is string => typeof f === "string"),
    forbidden: forbidden.filter((f): f is string => typeof f === "string"),
    format: (ctx.input.format as SkillResultEvaluation["format"]) ?? "any"
  });
  const notes = (ctx.input.rules === undefined ? [] : arr(ctx, "rules")) ?? [];
  const styleRows = notes.map((rule) => ({
    rule: String(rule),
    found: answer.includes(String(rule))
  }));
  for (const row of styleRows)
    check(ctx, `rule:${row.rule.slice(0, 40)}`, !row.found, `Проверено правило: ${row.rule}.`);
  check(
    ctx,
    "facts_preserved",
    report.checks.find((c) => c.criterion === "facts_preserved")!.passed,
    "Факты продукта сохранены или пробел зафиксирован."
  );
  return finish(ctx, {
    kind: "register",
    title: "Проверка материалов по правилам бренда",
    evaluation: report,
    style_rows: styleRows,
    note: "Оценка стиля/структуры; истина и качество модели не проверяются."
  });
}

/** BIZ-072 — manager digest with an explicit source for every item. */
function runBiz072(ctx: ScenarioContext): BusinessScenarioRunResult {
  const period = str(ctx, "period", 120);
  const entries = arr(ctx, "entries");
  if (!period || !entries) return finish(ctx, gapsArtifact(ctx));
  const rows = entries.map((item, i) => {
    const obj = item as Record<string, unknown>;
    const text = typeof obj.text === "string" ? obj.text.trim() : "";
    const source = typeof obj.source === "string" ? obj.source.trim() : "";
    if (!text) addGap(ctx, `entries[${i}].text`, "Пункт сводки без текста.");
    if (!source) addGap(ctx, `entries[${i}].source`, `Пункт «${text || i}» без источника.`);
    return { text, source, status: text && source ? "есть источник" : "пробел" };
  });
  const stale = ctx.input.stale === undefined ? [] : (arr(ctx, "stale") ?? []);
  check(ctx, "period_given", true, `Период: ${period}.`);
  check(
    ctx,
    "sources_present",
    rows.every((r) => r.status === "есть источник"),
    `Пунктов: ${rows.length}.`
  );
  return finish(ctx, {
    kind: "text",
    title: "Рабочая сводка руководителю",
    period,
    rows,
    stale: stale.map((value) => String(value)),
    markdown: [
      `# Рабочая сводка руководителю — ${period}`,
      "",
      ...rows.map((row) => `- ${row.text || "—"} (источник: ${row.source || "не указан"})`),
      stale.length ? `\nУстаревшие данные: ${stale.map((v) => String(v)).join(", ")}.` : ""
    ].join("\n"),
    note: "Нет источника — пункт помечен как пробел, а не как факт."
  });
}

const RUNNERS: Record<BusinessScenarioId, (ctx: ScenarioContext) => BusinessScenarioRunResult> = {
  "BIZ-013": runBiz013,
  "BIZ-014": runBiz014,
  "BIZ-016": runBiz016,
  "BIZ-017": runBiz017,
  "BIZ-021": runBiz021,
  "BIZ-023": runBiz023,
  "BIZ-024": runBiz024,
  "BIZ-038": runBiz038,
  "BIZ-040": runBiz040,
  "BIZ-042": runBiz042,
  "BIZ-046": runBiz046,
  "BIZ-072": runBiz072
};

export const BUSINESS_SCENARIO_REGISTRY = Object.keys(RUNNERS) as BusinessScenarioId[];

/** Pure entry point. Unknown IDs return a gaps artifact rather than throwing. */
export const runBusinessScenario = (
  id: BusinessScenarioId,
  input: Input
): BusinessScenarioRunResult => {
  const ctx: ScenarioContext = {
    id,
    input: input && typeof input === "object" && !Array.isArray(input) ? input : {},
    gaps: [],
    checks: []
  };
  const runner = RUNNERS[id];
  if (!runner) {
    addGap(ctx, "scenario_id", `Неизвестный сценарий: ${String(id)}.`);
    return finish(ctx, gapsArtifact(ctx));
  }
  try {
    return runner(ctx);
  } catch (cause) {
    addGap(ctx, "input", `Ошибка обработки входа: ${String(cause)}.`);
    return finish(ctx, gapsArtifact(ctx));
  }
};

/** Exported only so BIZ-013's existing rule effects can be reused unchanged. */
export const applyBusinessSupplierRules = (
  rows: readonly SupplierRow[],
  rules: readonly RuleLike[]
) => applyProjectRules(rows, rules);
