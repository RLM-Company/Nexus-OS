import type { ManagerWork } from "@cosmora/contracts";
import { compareSupplierOffers, extractSupplierInput } from "@cosmora/core";

type Input = Parameters<typeof compareSupplierOffers>[0];

function supplierPart(text: string): Partial<Input> {
  const part = JSON.parse(text) as Partial<Input> | null;
  if (
    !part ||
    typeof part !== "object" ||
    Array.isArray(part) ||
    Object.keys(part).some((key) => key !== "requirements" && key !== "offers") ||
    (part.requirements !== undefined && !Array.isArray(part.requirements)) ||
    (part.offers !== undefined && !Array.isArray(part.offers))
  )
    throw Error("INVALID_SUPPLIER_ANSWER");
  return part;
}

export function supplierQuestion(work: ManagerWork): string | undefined {
  if (work.request.output_contract?.kind !== "supplier_comparison" || work.supplier_clarification)
    return;
  try {
    const input = supplierPart(work.request.goal);
    if (!input.requirements?.length && !input.offers?.length) return;
    if (!input.requirements?.length || (input.offers?.length ?? 0) < 2)
      return extractSupplierInput([input])
        .gaps.filter((gap) => gap.path === "requirements" || gap.path === "offers")
        .map((gap) => gap.question)
        .filter(Boolean)
        .join(" ");
  } catch {
    // Invalid JSON takes the existing business-input error path.
  }
}

function mergeAnswer(original: string, answer: string): string {
  const input = supplierPart(original);
  const part = supplierPart(answer);
  const requirements = input.requirements ?? [];
  const offers = input.offers ?? [];
  if (
    (!part.requirements?.length && !part.offers?.length) ||
    (requirements.length > 0 && part.requirements?.length) ||
    (offers.length >= 2 && part.offers?.length)
  )
    throw Error("INVALID_SUPPLIER_ANSWER");
  return JSON.stringify({
    requirements: [...requirements, ...(part.requirements ?? [])],
    offers: [...offers, ...(part.offers ?? [])]
  });
}

export function validateSupplierAnswer(work: ManagerWork, answer: string): void {
  const merged = mergeAnswer(work.request.goal, answer);
  if (merged.length > 8000) throw Error("INVALID_SUPPLIER_ANSWER");
  compareSupplierOffers(JSON.parse(merged) as Input);
}

export function supplierWorkInput(work: ManagerWork): string {
  const answer = work.supplier_clarification?.answer;
  return answer === undefined ? work.request.goal : mergeAnswer(work.request.goal, answer);
}
