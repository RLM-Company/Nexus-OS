import React from "react";
import type { ResearchWorkspaceCardViewModel } from "./view-model";

export interface ResearchWorkspaceClientProps {
  viewModel: ResearchWorkspaceCardViewModel;
  onCancel?: () => void;
  onResume?: () => void;
}

export function ResearchWorkspaceClient({
  viewModel,
  onCancel,
  onResume,
}: ResearchWorkspaceClientProps) {
  return (
    <section
      aria-label="Рабочее пространство исследования"
      className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">{viewModel.title}</h1>
          <p className="text-sm text-slate-600">{viewModel.goal}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-800">
            {viewModel.statusBadgeRu}
          </span>
          <span className="text-xs text-slate-500">{viewModel.queryBudgetSummaryRu}</span>
          {viewModel.canResumeFromCheckpoint && onResume ? (
            <button
              type="button"
              onClick={onResume}
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white"
            >
              Продолжить исследование
            </button>
          ) : null}
          {!viewModel.canResumeFromCheckpoint && onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700"
            >
              Остановить
            </button>
          ) : null}
        </div>
      </header>

      {viewModel.unavailableSourcesBannerRu.length > 0 ? (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <strong className="block font-semibold">Недоступные источники:</strong>
          <ul className="mt-1 list-disc pl-4">
            {viewModel.unavailableSourcesBannerRu.map((msg, idx) => (
              <li key={idx}>{msg}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-5 overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
              <th className="py-2 pr-4">Вариант</th>
              {viewModel.matrixRows[0]?.cells.map((cell) => (
                <th key={cell.criterion} className="py-2 pr-4">
                  {cell.criterion}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {viewModel.matrixRows.map((row) => (
              <tr key={row.optionName} className="border-b border-slate-100 align-top">
                <td className="py-3 pr-4 font-medium text-slate-900">{row.optionName}</td>
                {row.cells.map((cell) => (
                  <td key={cell.criterion} className="py-3 pr-4">
                    <div
                      className={
                        cell.isUnconfirmed
                          ? "italic text-slate-400"
                          : "font-medium text-slate-900"
                      }
                    >
                      {cell.displayValue}
                    </div>
                    {cell.hasConflict && cell.conflictSummary ? (
                      <div className="mt-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
                        {cell.conflictSummary}
                      </div>
                    ) : null}
                    {cell.citations.map((cit, cIdx) => (
                      <blockquote
                        key={cIdx}
                        className="mt-1 border-l-2 border-slate-300 pl-2 text-xs text-slate-600"
                      >
                        «{cit.verbatimQuote}» —{" "}
                        <a
                          href={cit.sourceUrl}
                          className="underline"
                          target="_blank"
                          rel="noreferrer"
                        >
                          {cit.sourceTitle}
                        </a>{" "}
                        ({cit.pageVersion})
                      </blockquote>
                    ))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
