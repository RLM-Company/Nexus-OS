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
 * Independent parts run concurrently with at most four active calls. The caller
 * supplies routing. A repaired result must be reviewed again before PASS.
 */
export async function runParallelRoute(options: {
  text: string;
  execute: ParallelExecute;
  signal: AbortSignal;
  now?: () => number;
}): Promise<ParallelRouteResult | null> {
  options.signal.throwIfAborted();
  const parts = splitParallelParts(options.text);
  if (!parts.length) return null;
  const now = options.now ?? (() => Date.now());
  const started = now();
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(options.signal.reason);
  options.signal.addEventListener("abort", forwardAbort, { once: true });
  const signal = controller.signal;
  const attempts = new Array<ParallelAttempt>(parts.length);
  let next = 0;
  let workers: Promise<void>[] = [];
  try {
    workers = Array.from({ length: Math.min(4, parts.length) }, async () => {
      while (next < parts.length) {
        signal.throwIfAborted();
        const index = next++;
        const part = parts[index]!;
        const partStart = now();
        const result = await options.execute({ part, prompt: part.text, signal });
        signal.throwIfAborted();
        attempts[index] = {
          part_id: part.id,
          output: result.text,
          sha256: sha256(result.text),
          started_at: partStart,
          ended_at: now(),
          retried: false
        };
      }
    });
    await Promise.all(workers);
    const reviewResult = async () => {
      signal.throwIfAborted();
      const labelled = attempts
        .map((attempt) => `${attempt.part_id}: ${attempt.output}`)
        .join("\n");
      const result = await options.execute({
        part: { id: "review", text: labelled },
        prompt: `Проверь все части по исходному заданию. Ответ начни с PASS или RETRY part-N.\nЗадание:\n${options.text}\nРезультаты:\n${labelled}`,
        signal
      });
      signal.throwIfAborted();
      return result;
    };
    let review = await reviewResult();
    const flagged =
      review.verdict === "RETRY"
        ? attempts.find((attempt) => new RegExp(`\\b${attempt.part_id}\\b`, "u").test(review.text))
        : undefined;
    if (flagged) {
      const original = parts.find((part) => part.id === flagged.part_id)!;
      const retried = await options.execute({
        part: original,
        prompt: `Исправь только ${original.id}.\nИсходное задание: ${original.text}\nПредыдущий ответ: ${flagged.output}\nЗамечания: ${review.text}`,
        signal
      });
      signal.throwIfAborted();
      flagged.output = retried.text;
      flagged.sha256 = sha256(retried.text);
      flagged.ended_at = now();
      flagged.retried = true;
      review = await reviewResult();
    }
    return {
      answer: attempts.map((attempt) => attempt.output).join("\n"),
      parts: attempts,
      review: {
        verdict: review.verdict === "PASS" ? "PASS" : "RETRY",
        reviewer_output: review.text
      },
      total_ms: Math.max(0, now() - started)
    };
  } catch (error) {
    controller.abort(error);
    await Promise.allSettled(workers);
    throw error;
  } finally {
    options.signal.removeEventListener("abort", forwardAbort);
  }
}
