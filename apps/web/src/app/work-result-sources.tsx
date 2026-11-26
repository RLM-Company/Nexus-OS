"use client";

import type { RunSourcesView } from "@cosmora/contracts";
import { useEffect, useState } from "react";

export function WorkResultSources({ projectId, runIds }: { projectId: string; runIds: string[] }) {
  const revision = runIds.join(",");
  const [result, setResult] = useState<{
    revision: string;
    receipts: RunSourcesView[];
    unavailable: boolean;
  } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const ids = revision ? revision.split(",") : [];
    const load = async () => {
      const replies = await Promise.allSettled(
        ids.map(async (runId) => {
          const response = await fetch(
            "/api/v1/projects/" +
              encodeURIComponent(projectId) +
              "/sources/run/" +
              encodeURIComponent(runId),
            {
              cache: "no-store",
              signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)])
            }
          );
          if (response.status === 404) return null;
          if (!response.ok) throw Error("Чтение источников недоступно");
          const receipt = (await response.json()) as RunSourcesView;
          if (receipt.project_id !== projectId || receipt.run_id !== runId)
            throw Error("Неверная квитанция");
          return receipt;
        })
      );
      if (!controller.signal.aborted)
        setResult({
          revision,
          receipts: replies.flatMap((reply) =>
            reply.status === "fulfilled" && reply.value ? [reply.value] : []
          ),
          unavailable: replies.some((reply) => reply.status === "rejected")
        });
    };
    void load();
    return () => controller.abort();
  }, [projectId, revision]);

  const current = result?.revision === revision ? result : null;
  const receipts = current?.receipts ?? [];
  const items = new Map(
    receipts.flatMap((receipt) =>
      receipt.sources.map(
        (source) =>
          [
            JSON.stringify([source.reference, source.version, source.sha256]),
            { source, excluded: receipt.excluded_now.includes(source.source_id) }
          ] as const
      )
    )
  );
  return (
    <section aria-label="Источники запуска">
      <p>
        <strong>Источники запуска</strong>
      </p>
      {items.size > 0 ? (
        <ul>
          {[...items].map(([key, { source, excluded }]) => (
            <li key={key}>
              {source.label ?? source.reference}
              {source.version !== null ? ` · версия ${source.version}` : ""}
              {excluded ? " · сейчас исключён" : ""}
              {" · "}
              <code style={{ overflowWrap: "anywhere" }}>SHA‑256 {source.sha256}</code>
              {source.quote && <blockquote>{source.quote}</blockquote>}
            </li>
          ))}
        </ul>
      ) : (
        <p>
          {!current
            ? "Загружаем источники."
            : receipts.length
              ? "В квитанции нет дополнительных источников."
              : "Сохранённая квитанция источников отсутствует."}
        </p>
      )}
      {current?.unavailable && <p role="status">Часть квитанций источников недоступна.</p>}
    </section>
  );
}
