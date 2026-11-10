import React from "react";
import { ResearchWorkspaceClient } from "./research-workspace-client";
import { buildResearchWorkspaceViewModel } from "./view-model";
import type { ResearchSessionRecord } from "../../../../api/src/research/contracts";

const INITIAL_EMPTY_SESSION: ResearchSessionRecord = {
  sessionId: "res-initial",
  projectId: null,
  title: "Исследование источников",
  goal: "Сопоставление проверяемых выдержек и позиций источников",
  options: [],
  criteria: [],
  status: "draft",
  maxQueriesPerQuestion: 2,
  maxTotalQueries: 10,
  queriesExecuted: 0,
  subQuestions: [],
  sources: [],
  unavailableSources: [],
  evidence: [],
  contradictions: [],
  checkpoint: null,
  projectHandoff: null,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

export default function ResearchWorkspacePage() {
  const vm = buildResearchWorkspaceViewModel(INITIAL_EMPTY_SESSION);
  return (
    <main className="mx-auto max-w-5xl p-6">
      <ResearchWorkspaceClient viewModel={vm} />
    </main>
  );
}
