export type ResearchSessionStatus =
  | "draft"
  | "running"
  | "paused_for_user"
  | "cancelled"
  | "completed";

export interface ResearchSubQuestion {
  id: string;
  optionName: string | null;
  criterion: string;
  queryText: string;
  status: "pending" | "answered" | "unconfirmed" | "exhausted";
  queriesExecuted: number;
  maxQueries: number;
  confirmedValue: string | null;
}

export interface ResearchSourceSnapshot {
  sourceId: string;
  url: string;
  canonicalUrl: string;
  title: string;
  domain: string;
  pageVersion: string;
  contentHash: string;
  contentFingerprint: string;
  fetchedAt: string;
  publishedDate: string | null;
  textContent: string;
  readingLimitations: string[];
}

export interface ResearchUnavailableSource {
  url: string;
  status: number;
  reason: string;
  recordedAt: string;
}

export interface ResearchEvidenceRecord {
  evidenceId: string;
  sourceId: string;
  sourceUrl: string;
  sourceTitle: string;
  optionName: string;
  criterion: string;
  claimedValue: string;
  verbatimQuote: string;
  startUtf16: number;
  endUtf16: number;
  quoteSha256: string;
  pageVersion: string;
  fetchedAt: string;
  publishedDate: string | null;
  readingLimitations: string[];
  claimEntailed: boolean;
  verified: boolean;
}

export interface ResearchContradictionGroup {
  optionName: string;
  criterion: string;
  hasConflict: boolean;
  conflictSummary: string | null;
  winningValue: string;
  resolutionReason: string;
  perspectives: Array<{
    normalizedValue: string;
    displayValue: string;
    sources: Array<{
      sourceId: string;
      sourceTitle: string;
      sourceUrl: string;
      publishedDate: string | null;
      verbatimQuote: string;
      pageVersion: string;
      fetchedAt: string;
    }>;
  }>;
}

export interface ResearchCheckpointState {
  phase: string;
  completedQuestionIds: string[];
  queriesExecuted: number;
  savedAt: string;
}

export interface ResearchProjectArtifactHandoff {
  artifactId: string;
  projectId: string;
  title: string;
  markdownReport: string;
  confirmedCount: number;
  unconfirmedCount: number;
  contradictionCount: number;
  exportedAt: string;
}

export interface ResearchSessionRecord {
  sessionId: string;
  projectId: string | null;
  title: string;
  goal: string;
  options: string[];
  criteria: string[];
  status: ResearchSessionStatus;
  maxQueriesPerQuestion: number;
  maxTotalQueries: number;
  queriesExecuted: number;
  subQuestions: ResearchSubQuestion[];
  sources: ResearchSourceSnapshot[];
  unavailableSources: ResearchUnavailableSource[];
  evidence: ResearchEvidenceRecord[];
  contradictions: ResearchContradictionGroup[];
  checkpoint: ResearchCheckpointState | null;
  projectHandoff: ResearchProjectArtifactHandoff | null;
  createdAt: string;
  updatedAt: string;
}
