import type { IntelligenceGraphVersionRef } from "@cosmora/contracts";
import {
  IntelligenceGraphIndex,
  type IntelligenceGraphQueryBudget,
  type IntelligenceGraphQueryMode
} from "./intelligence-graph-retrieval.js";

export interface IntelligenceGraphRetrievalEvaluationCase {
  case_id: string;
  query: string;
  expected_nodes: readonly IntelligenceGraphVersionRef[];
  as_of?: string | null;
  verified_only?: boolean;
  budget?: Partial<IntelligenceGraphQueryBudget>;
}

export interface IntelligenceGraphRetrievalCaseResult {
  case_id: string;
  mode: IntelligenceGraphQueryMode;
  expected_count: number;
  returned_count: number;
  matched_count: number;
  precision: number;
  recall: number;
  sufficient_evidence: boolean;
  truncated: boolean;
}

export interface IntelligenceGraphRetrievalModeSummary {
  mode: IntelligenceGraphQueryMode;
  cases: number;
  mean_precision: number;
  mean_recall: number;
  sufficient_evidence_rate: number;
  truncated_rate: number;
}

export interface IntelligenceGraphRetrievalEvaluationReport {
  case_results: IntelligenceGraphRetrievalCaseResult[];
  summaries: IntelligenceGraphRetrievalModeSummary[];
}

const refKey = (ref: IntelligenceGraphVersionRef): string => `${ref.id}@${ref.version}`;
const ratio = (numerator: number, denominator: number): number =>
  denominator === 0 ? 1 : numerator / denominator;
const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;

export const evaluateIntelligenceGraphRetrieval = (input: {
  index: IntelligenceGraphIndex;
  ownerId: string;
  projectId: string;
  cases: readonly IntelligenceGraphRetrievalEvaluationCase[];
  modes?: readonly IntelligenceGraphQueryMode[];
}): IntelligenceGraphRetrievalEvaluationReport => {
  const modes = input.modes ?? ["baseline", "local", "multi_hop"];
  const caseResults: IntelligenceGraphRetrievalCaseResult[] = [];

  for (const evaluationCase of input.cases) {
    if (!evaluationCase.case_id.trim()) {
      throw new Error("Intelligence Graph evaluation case_id is required");
    }
    if (evaluationCase.expected_nodes.length === 0) {
      throw new Error(
        `Intelligence Graph evaluation case ${evaluationCase.case_id} requires expected nodes`
      );
    }
    const expected = new Set(evaluationCase.expected_nodes.map(refKey));
    if (expected.size !== evaluationCase.expected_nodes.length) {
      throw new Error(
        `Intelligence Graph evaluation case ${evaluationCase.case_id} has duplicate expected nodes`
      );
    }

    for (const mode of modes) {
      if (mode === "temporal" && !evaluationCase.as_of) {
        throw new Error(
          `Temporal Intelligence Graph evaluation case ${evaluationCase.case_id} requires as_of`
        );
      }

      const packet = input.index.query({
        owner_id: input.ownerId,
        project_id: input.projectId,
        text: evaluationCase.query,
        mode,
        as_of: mode === "temporal" ? evaluationCase.as_of : null,
        verified_only: evaluationCase.verified_only,
        budget: evaluationCase.budget
      });

      const returned = new Set(
        packet.nodes.map(({ node }) => refKey({ id: node.node_id, version: node.node_version }))
      );
      let matched = 0;
      for (const key of expected) {
        if (returned.has(key)) matched += 1;
      }

      caseResults.push({
        case_id: evaluationCase.case_id,
        mode,
        expected_count: expected.size,
        returned_count: returned.size,
        matched_count: matched,
        precision: ratio(matched, returned.size),
        recall: ratio(matched, expected.size),
        sufficient_evidence: packet.sufficient_evidence,
        truncated: packet.budget.truncated
      });
    }
  }

  const summaries = modes.map((mode): IntelligenceGraphRetrievalModeSummary => {
    const results = caseResults.filter((result) => result.mode === mode);
    return {
      mode,
      cases: results.length,
      mean_precision: mean(results.map((result) => result.precision)),
      mean_recall: mean(results.map((result) => result.recall)),
      sufficient_evidence_rate: mean(
        results.map((result) => (result.sufficient_evidence ? 1 : 0))
      ),
      truncated_rate: mean(results.map((result) => (result.truncated ? 1 : 0)))
    };
  });

  return { case_results: caseResults, summaries };
};
