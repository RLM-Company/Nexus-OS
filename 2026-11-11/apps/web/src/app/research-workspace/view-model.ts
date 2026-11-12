import type { ResearchRunView } from "../../../../api/src/research/research-store.js";
import {
  renderDeterministicResearchReportMarkdown,
  type SynthesizedResearchClaim
} from "../../../../api/src/research/research-synthesis.js";

export interface ResearchWorkspaceSourceLinkView {
  sourceId: string;
  title: string;
  originalUrl: string;
  canonicalUrl: string;
  fetchedAt: string;
  pageVersion: string;
  previousPageVersion: string | null;
  pageChanged: boolean;
}

export interface ResearchWorkspaceViewModel {
  runId: string;
  query: string;
  status: ResearchRunView["status"];
  statusLabelRu: string;
  progressPercent: number;
  progressLabelRu: string;
  canCancel: boolean;
  canResume: boolean;
  canExport: boolean;
  budgetSummaryRu: string;
  sources: ResearchWorkspaceSourceLinkView[];
  confirmedClaims: SynthesizedResearchClaim[];
  conflictingClaims: SynthesizedResearchClaim[];
  unconfirmedClaims: SynthesizedResearchClaim[];
  reportMarkdown: string | null;
}

const STATUS_LABELS_RU: Record<ResearchRunView["status"], string> = {
  queued: "В очереди",
  running: "Выполняется чтение источников",
  paused: "Приостановлено",
  cancelled: "Остановлено пользователем (доступно продолжение)",
  failed: "Сбой выполнения (доступно восстановление с последнего шага)",
  completed: "Исследование завершено"
};

/**
 * Builds the local UI view-model for the research workspace surface
 * without touching general chat or sidebar state.
 */
export function buildResearchWorkspaceViewModel(
  run: ResearchRunView
): ResearchWorkspaceViewModel {
  const canCancel = run.status === "running" || run.status === "queued";
  const canResume =
    run.status === "cancelled" || run.status === "failed" || run.status === "paused";
  const canExport = run.status === "completed" && Boolean(run.reportMarkdown);

  return {
    runId: run.id,
    query: run.query,
    status: run.status,
    statusLabelRu: STATUS_LABELS_RU[run.status] ?? run.status,
    progressPercent: run.progress.percent,
    progressLabelRu: `Шагов выполнено: ${run.progress.completedSteps} из ${run.progress.totalSteps} (${run.progress.percent}%)`,
    canCancel,
    canResume,
    canExport,
    budgetSummaryRu: `Источников: ${run.budgets.sourcesRead}/${run.budgets.maxSources} · Глубина: ${run.budgets.depthReached}/${run.budgets.maxDepth} · Время: ${run.budgets.elapsedMs}/${run.budgets.maxRuntimeMs} мс`,
    sources: run.sources.map((s) => ({
      sourceId: s.sourceId,
      title: s.title,
      originalUrl: s.originalUrl,
      canonicalUrl: s.canonicalUrl,
      fetchedAt: s.fetchedAt,
      pageVersion: s.pageVersion,
      previousPageVersion: s.previousPageVersion,
      pageChanged: s.pageChanged
    })),
    confirmedClaims: run.confirmedClaims,
    conflictingClaims: run.conflictingClaims,
    unconfirmedClaims: run.unconfirmedClaims,
    reportMarkdown: run.reportMarkdown
  };
}

/**
 * Exports the research report directly from the UI view-model, guaranteeing that the UI report
 * contains the exact same links (`originalUrl`), versions (`pageVersion`), dates (`fetchedAt`),
 * and verbatim quotes (`verbatimQuote`) as the stored backend result.
 */
export function exportResearchReportFromViewModel(vm: ResearchWorkspaceViewModel): {
  runId: string;
  reportMarkdown: string;
  links: string[];
  quotes: string[];
} {
  const markdown =
    vm.reportMarkdown ??
    renderDeterministicResearchReportMarkdown({
      runId: vm.runId,
      query: vm.query,
      status: vm.status,
      sources: vm.sources,
      confirmedClaims: vm.confirmedClaims,
      conflictingClaims: vm.conflictingClaims,
      unconfirmedClaims: vm.unconfirmedClaims
    });

  const allCitations = [
    ...vm.confirmedClaims.flatMap((c) => c.citations),
    ...vm.conflictingClaims.flatMap((c) => c.citations)
  ];

  const links = Array.from(
    new Set([
      ...allCitations.map((c) => c.originalUrl),
      ...vm.sources.map((s) => s.originalUrl)
    ])
  );
  const quotes = allCitations.map((c) => c.verbatimQuote);

  return {
    runId: vm.runId,
    reportMarkdown: markdown,
    links,
    quotes
  };
}
