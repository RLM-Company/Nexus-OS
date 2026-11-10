import type { AiTaskProfileKind } from "./adaptive-ai-parameter-controller.js";

export interface FewShotExemplar {
  id: string;
  taskKind: AiTaskProfileKind;
  tags: string[];
  userPrompt: string;
  idealAssistantResponse: string;
  estimatedTokens: number;
}

export interface SelectedExemplarsResult {
  selected: FewShotExemplar[];
  totalTokensUsed: number;
  formattedPromptBlock: string;
}

const DEFAULT_GOLDEN_EXEMPLARS: FewShotExemplar[] = [
  {
    id: "ex_sql_idempotent_migration",
    taskKind: "deterministic_code_and_sql",
    tags: ["sql", "sqlite", "migration", "table", "trigger", "миграция", "таблица"],
    userPrompt: "Create an idempotent SQLite table for audit receipts with an owner index.",
    idealAssistantResponse:
      "CREATE TABLE IF NOT EXISTS kosmora_audit_receipts (\n  receipt_id TEXT PRIMARY KEY NOT NULL,\n  owner_id TEXT NOT NULL,\n  created_at TEXT NOT NULL\n);\nCREATE INDEX IF NOT EXISTS idx_audit_receipts_owner ON kosmora_audit_receipts(owner_id);",
    estimatedTokens: 64
  },
  {
    id: "ex_ts_zero_dep_module",
    taskKind: "deterministic_code_and_sql",
    tags: ["typescript", "node", "class", "algorithm", "код", "модуль", "функция"],
    userPrompt: "Write a deterministic token bucket rate limiter in TypeScript without external packages.",
    idealAssistantResponse:
      "export class TokenBucketLimiter {\n  private tokens: number;\n  private lastRefillMs: number;\n  constructor(private readonly capacity: number, private readonly refillPerSec: number) {\n    this.tokens = capacity;\n    this.lastRefillMs = Date.now();\n  }\n}",
    estimatedTokens: 68
  },
  {
    id: "ex_grounded_comparison_table",
    taskKind: "analytical_research_and_grounding",
    tags: ["compare", "table", "analysis", "сравни", "таблица", "анализ", "отчёт"],
    userPrompt: "Compare BM25 and Dense Vector search across latency and recall.",
    idealAssistantResponse:
      "| Method | Exact Keyword Recall | Semantic Synonym Recall | Typical Latency |\n| :--- | :--- | :--- | :--- |\n| **BM25 Lexical** | High (exact tokens) | Low | `< 5 ms` |\n| **Dense 64-Dim Vector** | Medium | High (paraphrases) | `< 15 ms` |",
    estimatedTokens: 62
  },
  {
    id: "ex_dag_plan_decomposition",
    taskKind: "manager_dag_planning",
    tags: ["plan", "dag", "workflow", "steps", "план", "воркфлоу", "этапы"],
    userPrompt: "Decompose a safe database backup and verification workflow into DAG waves.",
    idealAssistantResponse:
      "Wave 1 (Read-Only): Quiesce concurrent writes & compute SHA-256 snapshot digest.\nWave 2 (Spool): Write immutable archive to local spool.\nWave 3 (Verify): Run round-trip integrity check before marking complete.",
    estimatedTokens: 54
  }
];

function tokenizeSet(text: string): Set<string> {
  const words = text.toLowerCase().match(/[a-z0-9\u0400-\u04ff_]{2,}/g) ?? [];
  return new Set(words);
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const item of a) {
    if (b.has(item)) inter++;
  }
  return inter / (a.size + b.size - inter);
}

/**
 * Dynamic Few-Shot Exemplar Selector using Maximal Marginal Relevance (MMR).
 * Selects high-relevance, non-redundant In-Context Learning (ICL) examples within a token budget.
 */
export class DynamicFewShotSelector {
  private readonly bank: FewShotExemplar[];

  constructor(customExemplars?: FewShotExemplar[]) {
    this.bank = [...DEFAULT_GOLDEN_EXEMPLARS, ...(customExemplars ?? [])];
  }

  public registerExemplar(exemplar: FewShotExemplar): void {
    this.bank.push(exemplar);
  }

  /**
   * Selects up to `maxCount` exemplars within `maxTokensBudget` using MMR:
   * MMR = argmax_i [ lambda * Rel(i, query) - (1 - lambda) * max_{j in Selected} Sim(i, j) ]
   */
  public selectExemplarsMmr(params: {
    userQuery: string;
    taskKind: AiTaskProfileKind;
    maxCount?: number;
    maxTokensBudget?: number;
    lambdaDiversity?: number;
  }): SelectedExemplarsResult {
    const maxCount = params.maxCount ?? 2;
    const maxTokensBudget = params.maxTokensBudget ?? 250;
    const lambda = params.lambdaDiversity ?? 0.7;

    const queryTokens = tokenizeSet(params.userQuery);
    const candidates = this.bank.map((ex) => {
      const exTokens = tokenizeSet(`${ex.tags.join(" ")} ${ex.userPrompt}`);
      const lexicalSim = jaccardSimilarity(queryTokens, exTokens);
      const taskBonus = ex.taskKind === params.taskKind ? 0.35 : 0;
      return {
        exemplar: ex,
        tokenSet: exTokens,
        relevance: Math.min(1.0, lexicalSim + taskBonus)
      };
    });

    const selected: Array<{ exemplar: FewShotExemplar; tokenSet: Set<string> }> = [];
    const usedIds = new Set<string>();
    let totalTokensUsed = 0;

    while (selected.length < maxCount) {
      let bestCandidate: (typeof candidates)[0] | null = null;
      let bestMmrScore = -Infinity;

      for (const cand of candidates) {
        if (usedIds.has(cand.exemplar.id)) continue;
        if (totalTokensUsed + cand.exemplar.estimatedTokens > maxTokensBudget) continue;
        if (cand.relevance <= 0.05) continue;

        let maxRedundancy = 0;
        for (const already of selected) {
          const sim = jaccardSimilarity(cand.tokenSet, already.tokenSet);
          if (sim > maxRedundancy) maxRedundancy = sim;
        }

        const mmrScore = lambda * cand.relevance - (1 - lambda) * maxRedundancy;
        if (mmrScore > bestMmrScore) {
          bestMmrScore = mmrScore;
          bestCandidate = cand;
        }
      }

      if (!bestCandidate) break;
      usedIds.add(bestCandidate.exemplar.id);
      selected.push({
        exemplar: bestCandidate.exemplar,
        tokenSet: bestCandidate.tokenSet
      });
      totalTokensUsed += bestCandidate.exemplar.estimatedTokens;
    }

    const chosen = selected.map((s) => s.exemplar);
    const formattedPromptBlock =
      chosen.length === 0
        ? ""
        : [
            "[IN_CONTEXT_FEW_SHOT_EXEMPLARS]",
            ...chosen.map(
              (ex, idx) =>
                `Example ${idx + 1} (${ex.id}):\nUser: ${ex.userPrompt}\nIdeal Output:\n${ex.idealAssistantResponse}`
            )
          ].join("\n\n");

    return {
      selected: chosen,
      totalTokensUsed,
      formattedPromptBlock
    };
  }
}
