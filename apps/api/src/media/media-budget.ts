/**
 * Port for the shared AccountStore ownerBudget. There is deliberately no local ledger.
 * Each operationId is a stable idempotency key across crashes; implementations MUST
 * persist reserve/reconcile/uncertain in the canonical accounting database.
 * A missing adapter disables paid media entirely.
 */
export type MediaKind = "image" | "speech" | "transcription";
export type CanonicalMediaUsage = Readonly<{
  source: "provider";
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}>;
export interface OwnerMediaBudget {
  reserve(input: Readonly<{ ownerId: string; operationId: string; kind: MediaKind; model: string }>): Promise<void>;
  reconcile(input: Readonly<{ ownerId: string; operationId: string; usage: CanonicalMediaUsage }>): Promise<void>;
  uncertain(input: Readonly<{ ownerId: string; operationId: string; reason: string }>): Promise<void>;
}

/** Only authoritative provider usage, never inferred from file size or words. */
export function canonicalUsage(value: unknown): CanonicalMediaUsage | null {
  if (!value || typeof value !== "object") return null;
  const x = value as Record<string, unknown>;
  const valid = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
  if (x.source !== "provider" || !valid(x.input_tokens) || !valid(x.output_tokens) ||
      !valid(x.total_tokens) || x.input_tokens + x.output_tokens !== x.total_tokens) return null;
  return { source: "provider", input_tokens: x.input_tokens, output_tokens: x.output_tokens, total_tokens: x.total_tokens };
}
