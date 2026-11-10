import type { ResearchSessionRecord } from "../../../../api/src/research/contracts";

export interface ResearchWorkspaceCardViewModel {
  sessionId: string;
  title: string;
  goal: string;
  statusBadgeRu: string;
  queryBudgetSummaryRu: string;
  matrixRows: Array<{
    optionName: string;
    cells: Array<{
      criterion: string;
      displayValue: string;
      isUnconfirmed: boolean;
      hasConflict: boolean;
      conflictSummary: string | null;
      citations: Array<{
        sourceTitle: string;
        sourceUrl: string;
        verbatimQuote: string;
        fetchedAt: string;
        pageVersion: string;
      }>;
    }>;
  }>;
  unavailableSourcesBannerRu: string[];
  readingLimitationNotesRu: string[];
  canResumeFromCheckpoint: boolean;
  projectHandoffReady: boolean;
}

const STATUS_LABELS_RU: Record<ResearchSessionRecord["status"], string> = {
  draft: "Черновик",
  running: "Выполняется поиск и проверка источников",
  paused_for_user: "Ожидает подтверждения пользователя",
  cancelled: "Остановлено (доступно продолжение с контрольной точки)",
  completed: "Исследование завершено",
};

export function buildResearchWorkspaceViewModel(
  session: ResearchSessionRecord
): ResearchWorkspaceCardViewModel {
  const matrixRows = session.options.map((optionName) => {
    const cells = session.criteria.map((criterion) => {
      const group = session.contradictions.find(
        (item) => item.optionName === optionName && item.criterion === criterion
      );
      if (!group) {
        return {
          criterion,
          displayValue: "не удалось установить",
          isUnconfirmed: true,
          hasConflict: false,
          conflictSummary: null,
          citations: [],
        };
      }
      const citations = group.perspectives.flatMap((p) =>
        p.sources.map((s) => ({
          sourceTitle: s.sourceTitle,
          sourceUrl: s.sourceUrl,
          verbatimQuote: s.verbatimQuote,
          fetchedAt: s.fetchedAt,
          pageVersion: s.pageVersion,
        }))
      );
      return {
        criterion,
        displayValue: group.winningValue,
        isUnconfirmed: false,
        hasConflict: group.hasConflict,
        conflictSummary: group.conflictSummary,
        citations,
      };
    });
    return { optionName, cells };
  });

  const unavailableSourcesBannerRu = session.unavailableSources.map(
    (u) => `Источник ${u.url} недоступен (HTTP ${u.status}: ${u.reason})`
  );

  const readingLimitationNotesRu = session.sources.flatMap((s) =>
    s.readingLimitations.map((lim) => `${s.title} (${s.url}): ${lim}`)
  );

  return {
    sessionId: session.sessionId,
    title: session.title,
    goal: session.goal,
    statusBadgeRu: STATUS_LABELS_RU[session.status] || session.status,
    queryBudgetSummaryRu: `Поисковых запросов: ${session.queriesExecuted} из ${session.maxTotalQueries}`,
    matrixRows,
    unavailableSourcesBannerRu,
    readingLimitationNotesRu,
    canResumeFromCheckpoint: session.status === "cancelled" && Boolean(session.checkpoint),
    projectHandoffReady: Boolean(session.projectHandoff),
  };
}
