export type SubQuestionSourceKind =
  | "vault_document"
  | "context_memory"
  | "sql_database"
  | "web_search"
  | "code_synthesis"
  | "analytical_comparison";

export interface AtomicSubQuestionHop {
  hopId: string;
  questionText: string;
  sourceKind: SubQuestionSourceKind;
  dependsOnHopIds: string[];
  waveIndex: number;
}

export interface MultiHopDecompositionPlan {
  isMultiHop: boolean;
  originalQuery: string;
  hops: AtomicSubQuestionHop[];
  waves: AtomicSubQuestionHop[][];
}

/**
 * Semantic Multi-Hop Query Decomposer & Parallel Sub-Question Wave Planner.
 * Splits compound user queries into a DAG of atomic sub-questions and groups independent
 * lookups into parallel execution waves (Wave 0, Wave 1, ...).
 */
export class MultiHopQueryDecomposer {
  public static inferSourceKind(clause: string): SubQuestionSourceKind {
    const lower = clause.toLowerCase();
    if (/(sql|таблиц|миграци|sqlite|индекс|баз[аеуы]\s+данных)/i.test(lower)) {
      return "sql_database";
    }
    if (/(код|скрипт|функци|класс|реализуй|напиши\s+модуль|typescript|node)/i.test(lower)) {
      return "code_synthesis";
    }
    if (/(документ|файл|отчёт|презентаци|таблиц[ауе]\s+excel|docx|xlsx|pptx|pdf|vault)/i.test(lower)) {
      return "vault_document";
    }
    if (/(найди\s+в\s+сети|поищи|веб|сайт|ссылк|новости|search\s+web)/i.test(lower)) {
      return "web_search";
    }
    if (/(сравни|сопоставь|проанализируй\s+разниц|compare|contrast|variance)/i.test(lower)) {
      return "analytical_comparison";
    }
    return "context_memory";
  }

  public static decomposeQuery(userQuery: string): MultiHopDecompositionPlan {
    const trimmed = userQuery.trim();

    // Split on coordinating/sequential conjunctions ("и затем", "после чего", "а также", "а потом", "and then", ";")
    const rawClauses = trimmed
      .split(
        /\s+(?:и\s+затем|после\s+чего|а\s+потом|затем|а\s+также|и\s+сравни|и\s+собери|и\s+сгенерируй|and\s+then|after\s+that|then\s+compare|;)\s+/i
      )
      .map((c) => c.trim())
      .filter((c) => c.length >= 6);

    if (rawClauses.length <= 1) {
      const singleHop: AtomicSubQuestionHop = {
        hopId: "hop_1",
        questionText: trimmed,
        sourceKind: MultiHopQueryDecomposer.inferSourceKind(trimmed),
        dependsOnHopIds: [],
        waveIndex: 0
      };
      return {
        isMultiHop: false,
        originalQuery: trimmed,
        hops: [singleHop],
        waves: [[singleHop]]
      };
    }

    const hops: AtomicSubQuestionHop[] = [];
    const retrievalHopIds: string[] = [];

    for (let i = 0; i < rawClauses.length; i++) {
      const clause = rawClauses[i]!;
      const hopId = `hop_${i + 1}`;
      const sourceKind = MultiHopQueryDecomposer.inferSourceKind(clause);

      // Synthesis and comparison hops depend on all preceding retrieval hops
      const isSynthesisOrComparison =
        sourceKind === "analytical_comparison" || sourceKind === "code_synthesis";

      const dependsOnHopIds =
        isSynthesisOrComparison && retrievalHopIds.length > 0 ? [...retrievalHopIds] : [];

      const waveIndex = dependsOnHopIds.length === 0 ? 0 : 1;

      hops.push({
        hopId,
        questionText: clause,
        sourceKind,
        dependsOnHopIds,
        waveIndex
      });

      if (!isSynthesisOrComparison) {
        retrievalHopIds.push(hopId);
      }
    }

    const wavesMap = new Map<number, AtomicSubQuestionHop[]>();
    for (const h of hops) {
      const w = wavesMap.get(h.waveIndex) ?? [];
      w.push(h);
      wavesMap.set(h.waveIndex, w);
    }

    const waves = Array.from(wavesMap.keys())
      .sort((a, b) => a - b)
      .map((idx) => wavesMap.get(idx)!);

    return {
      isMultiHop: hops.length > 1,
      originalQuery: trimmed,
      hops,
      waves
    };
  }
}
