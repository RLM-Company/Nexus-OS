import React from "react";
import { ResearchWorkspaceClient } from "./research-workspace-client.js";
import { buildResearchWorkspaceViewModel } from "./view-model.js";
import type { ResearchRunView } from "../../../../api/src/research/research-store.js";

const EMPTY_RUN_VIEW: ResearchRunView = {
  id: "res_run_empty",
  ownerId: "local-owner",
  projectId: null,
  query: "Исследовательская задача",
  normalizedQuery: "исследовательская задача",
  clientRequestId: null,
  status: "queued",
  progress: {
    currentStepIndex: 0,
    totalSteps: 0,
    completedSteps: 0,
    pendingSteps: 0,
    failedSteps: 0,
    percent: 0
  },
  budgets: {
    maxDepth: 2,
    maxSources: 6,
    maxRuntimeMs: 15000,
    elapsedMs: 0,
    depthReached: 0,
    sourcesRead: 0
  },
  steps: [],
  sources: [],
  confirmedClaims: [],
  conflictingClaims: [],
  unconfirmedClaims: [],
  reportMarkdown: null,
  errorCode: null,
  errorMessage: null,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString()
};

export default function ResearchWorkspacePage() {
  const vm = buildResearchWorkspaceViewModel(EMPTY_RUN_VIEW);
  return (
    <main className="mx-auto max-w-6xl p-6">
      <ResearchWorkspaceClient viewModel={vm} />
    </main>
  );
}
