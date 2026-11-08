"use client";

import { useEffect, useState } from "react";

type Result = {
  run_id: string;
  definition_version: number;
  files: { id: string; name: string; version: number; bytes: number; sha256: string }[];
  expected: { missing: string[]; manual_review: { condition: string }[]; empty: boolean };
  archive_url: string;
};

/** Mounted only for APIs advertising workflow_run_results.v1. Scoped by key in
 * the parent; abort prevents an old run/project response replacing the new one. */
export function WorkflowRunResults({
  projectId,
  workflowId,
  runId,
  dagId
}: {
  projectId: string;
  workflowId: string;
  runId: string;
  dagId: string;
}) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!revision) return;
    const controller = new AbortController();
    setBusy(true);
    setResult(null);
    setError("");
    void (async () => {
      try {
        const response = await fetch(
          `/api/v1/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(workflowId)}/runs/${encodeURIComponent(runId)}/results`,
          {
            cache: "no-store",
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)])
          }
        );
        if (!response.ok) throw new Error("RESULTS_UNAVAILABLE");
        const next = (await response.json()) as Result;
        if (next.run_id !== runId) throw new Error("RESULTS_MISMATCH");
        if (!controller.signal.aborted) setResult(next);
      } catch {
        if (!controller.signal.aborted)
          setError("Не удалось проверить результаты. Повторите запрос.");
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    })();
    return () => controller.abort();
  }, [projectId, workflowId, runId, revision]);
  const archive = `/api/v1/projects/${encodeURIComponent(projectId)}/work-dags/${encodeURIComponent(dagId)}/results.zip`;
  return (
    <div>
      <button disabled={busy} onClick={() => setRevision((n) => n + 1)}>
        {busy ? "Проверка файлов…" : "Проверить результаты"}
      </button>
      {error && <p role="alert">{error}</p>}
      {result && (
        <div aria-live="polite">
          <p>Результаты запуска · версия сценария {result.definition_version}</p>
          <p>
            Проверены размер и SHA-256 опубликованных файлов. Это не подтверждает качество
            содержания, выполнение кода или принятие результата вами.
          </p>
          {!result.files.length && <p>Опубликованных файлов пока нет.</p>}
          <ul>
            {result.files.map((file) => (
              <li key={file.id}>
                {file.name} · версия {file.version} · {file.bytes} байт
              </li>
            ))}
          </ul>
          {result.expected.empty && (
            <p>Ожидаемые результаты не заданы: проверьте результат вручную.</p>
          )}
          {!!result.expected.missing.length && (
            <p>Пока не найдены: {result.expected.missing.join(", ")}.</p>
          )}
          {result.expected.manual_review.map(({ condition }) => (
            <p key={condition}>Проверить вручную: {condition}</p>
          ))}
          {!!result.files.length && result.archive_url === archive && (
            <a download href={archive}>
              Скачать архив результатов
            </a>
          )}
        </div>
      )}
    </div>
  );
}
