import { createHash } from "node:crypto";

export type ParallelPart = { id: string; text: string };
export type ParallelAttempt = {
  part_id: string;
  output: string;
  sha256: string;
  started_at: number;
  ended_at: number;
  retried: boolean;
};
export type ParallelRouteResult = {
  answer: string;
  parts: ParallelAttempt[];
  review: { verdict: "PASS" | "RETRY"; reviewer_output: string };
  total_ms: number;
};

export type ParallelExecute = (input: {
  part: ParallelPart;
  prompt: string;
  signal: AbortSignal;
}) => Promise<{ text: string; verdict?: "PASS" | "RETRY" }>;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Split only explicitly opted-in, sufficiently large inputs; never automatic. */
export function splitParallelParts(text: string, minParts = 2): ParallelPart[] {
  const lines = text
    .split(/\n+/u)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < minParts) return [];
  return lines.map((line, index) => ({
    id: `part-${index + 1}`,
    text: line
  }));
}

/**
 * Fast executors work on independent parts; a strong reviewer checks the merged
 * result; only a flagged part is retried once. No paid fan-out for small tasks.
 */
export async function runParallelRoute(options: {
  text: string;
  execute: ParallelExecute;
  signal: AbortSignal;
  now?: () => number;
}): Promise<ParallelRouteResult | null> {
  const parts = splitParallelParts(options.text);
  if (!parts.length) return null;
  const now = options.now ?? (() => Date.now());
  const started = now();
  const attempts: ParallelAttempt[] = [];
  for (const part of parts) {
    const partStart = now();
    const result = await options.execute({ part, prompt: part.text, signal: options.signal });
    attempts.push({
      part_id: part.id,
      output: result.text,
      sha256: sha256(result.text),
      started_at: partStart,
      ended_at: now(),
      retried: false
    });
  }
  const merged = attempts.map((attempt) => attempt.output).join("\n");
  const review = await options.execute({
    part: { id: "review", text: merged },
    prompt: `Проверь итог по частям и ответь PASS или RETRY с указанием части: ${merged}`,
    signal: options.signal
  });
  const flagged =
    review.verdict === "RETRY" ? attempts.find((a) => review.text.includes(a.part_id)) : undefined;
  if (flagged) {
    const retryStart = now();
    const retried = await options.execute({
      part: { id: flagged.part_id, text: flagged.output },
      prompt: `Повтори только часть ${flagged.part_id}: ${flagged.output}`,
      signal: options.signal
    });
    flagged.output = retried.text;
    flagged.sha256 = sha256(retried.text);
    flagged.ended_at = now();
    flagged.retried = true;
    void retryStart;
  }
  const answer = attempts.map((attempt) => attempt.output).join("\n");
  return {
    answer,
    parts: attempts,
    review: {
      verdict: review.verdict === "RETRY" ? "RETRY" : "PASS",
      reviewer_output: review.text
    },
    total_ms: Math.max(0, now() - started)
  };
}
