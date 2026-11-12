import React from "react";
import type { ResearchWorkspaceViewModel } from "./view-model.js";

export interface ResearchWorkspaceClientProps {
  viewModel: ResearchWorkspaceViewModel;
  onCancel?: () => void;
  onResume?: () => void;
  onExport?: () => void;
  onResolveConflict?: (
    claimId: string,
    winningSourceId: string,
    resolutionNote?: string
  ) => void;
}

export function ResearchWorkspaceClient({
  viewModel,
  onCancel,
  onResume,
  onExport,
  onResolveConflict
}: ResearchWorkspaceClientProps) {
  return (
    <section
      aria-label="Поверхность исследовательской задачи"
      className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">{viewModel.query}</h1>
          <p className="mt-1 text-xs text-slate-500">
            {viewModel.progressLabelRu} · {viewModel.budgetSummaryRu}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-800">
            {viewModel.statusLabelRu}
          </span>
          {viewModel.canCancel && onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700"
            >
              Остановить
            </button>
          ) : null}
          {viewModel.canResume && onResume ? (
            <button
              type="button"
              onClick={onResume}
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white"
            >
              Продолжить с контрольной точки
            </button>
          ) : null}
          {viewModel.canExport && onExport ? (
            <button
              type="button"
              onClick={onExport}
              className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white"
            >
              Экспортировать отчёт с доказательствами
            </button>
          ) : null}
        </div>
      </header>

      <div className="mt-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Проверенные источники ({viewModel.sources.length})
        </h2>
        <ul className="mt-2 space-y-1 text-xs text-slate-700">
          {viewModel.sources.map((src) => (
            <li key={src.sourceId}>
              <a
                href={src.originalUrl}
                target="_blank"
                rel="noreferrer"
                className="font-medium underline"
              >
                {src.title}
              </a>{" "}
              <span className="text-slate-500">
                (версия: {src.pageVersion}
                {src.pageChanged ? `, обновлена с ${src.previousPageVersion}` : ""}, получено:{" "}
                {src.fetchedAt})
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-4">
          <h3 className="text-sm font-semibold text-emerald-950">
            1. Подтверждённые утверждения ({viewModel.confirmedClaims.length})
          </h3>
          <ul className="mt-2 space-y-3 text-xs text-slate-800">
            {viewModel.confirmedClaims.map((claim) => (
              <li key={claim.claimId}>
                <div className="font-semibold">
                  {claim.subject} — {claim.criterion}: {claim.resolvedValue}
                </div>
                {claim.resolutionAudit ? (
                  <p className="mt-0.5 text-[11px] text-emerald-800">
                    Разрешён конфликт: выбрана версия {claim.resolutionAudit.winningPageVersion} (
                    {claim.resolutionAudit.resolutionNote})
                  </p>
                ) : null}
                {claim.citations.map((cit, idx) => (
                  <blockquote
                    key={idx}
                    className="mt-1 border-l-2 border-emerald-400 pl-2 text-slate-600"
                  >
                    «{cit.verbatimQuote}» —{" "}
                    <a href={cit.originalUrl} className="underline">
                      {cit.sourceTitle}
                    </a>{" "}
                    ({cit.pageVersion}, {cit.fetchedAt})
                  </blockquote>
                ))}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-4">
          <h3 className="text-sm font-semibold text-amber-950">
            2. Противоречащие утверждения ({viewModel.conflictingClaims.length})
          </h3>
          <ul className="mt-2 space-y-3 text-xs text-slate-800">
            {viewModel.conflictingClaims.map((claim) => (
              <li key={claim.claimId}>
                <div className="font-semibold text-amber-900">
                  {claim.subject} — {claim.criterion}
                </div>
                <p className="mt-0.5 text-amber-800">{claim.conflictSummary}</p>
                {claim.citations.map((cit, idx) => (
                  <blockquote
                    key={idx}
                    className="mt-1 border-l-2 border-amber-400 pl-2 text-slate-600"
                  >
                    [{cit.claimedValue}] «{cit.verbatimQuote}» —{" "}
                    <a href={cit.originalUrl} className="underline">
                      {cit.sourceTitle}
                    </a>{" "}
                    ({cit.pageVersion}, {cit.fetchedAt})
                    {onResolveConflict ? (
                      <button
                        type="button"
                        onClick={() => onResolveConflict(claim.claimId, cit.sourceId)}
                        className="ml-2 rounded border border-amber-500 px-1.5 py-0.5 text-[11px] font-medium text-amber-900"
                      >
                        Принять версию ({cit.claimedValue})
                      </button>
                    ) : null}
                  </blockquote>
                ))}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <h3 className="text-sm font-semibold text-slate-900">
            3. Неподтверждённые утверждения ({viewModel.unconfirmedClaims.length})
          </h3>
          <ul className="mt-2 space-y-2 text-xs text-slate-600">
            {viewModel.unconfirmedClaims.map((claim) => (
              <li key={claim.claimId}>
                <span className="font-medium text-slate-800">
                  {claim.subject} — {claim.criterion}:
                </span>{" "}
                <span className="italic">{claim.resolvedValue}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
