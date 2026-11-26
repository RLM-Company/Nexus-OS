import type { ResearchSourceReceipt } from "@cosmora/core";
import type { SourceExclusionsView } from "@cosmora/contracts";
import { useRef, useState } from "react";

export function ResearchReceipts({
  projectId,
  receipts
}: {
  projectId: string;
  receipts: ResearchSourceReceipt[];
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  async function exclude(id: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    const url = `/api/v1/projects/${encodeURIComponent(projectId)}/sources/exclusions`;
    try {
      const current = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
      if (!current.ok) throw Error("Не удалось прочитать исключения проекта.");
      const state = (await current.json()) as SourceExclusionsView;
      if (
        !state.items.some((item) => item.source_kind === "research_page" && item.source_id === id)
      ) {
        const result = await fetch(url, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            expected_version: state.version,
            exclusions: [
              ...state.items,
              {
                source_kind: "research_page",
                source_id: id,
                excluded_at: new Date().toISOString(),
                reason: "Исключён владельцем из будущих исследований"
              }
            ]
          }),
          signal: AbortSignal.timeout(8000)
        });
        if (!result.ok) throw Error("Исключение не подтверждено. Повторите действие.");
      }
      setMessage("Источник исключён из новых исследований.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Исключение не подтверждено.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <details>
      <summary>Квитанции источников</summary>
      <ul>
        {receipts.map((receipt, index) => (
          <li key={index}>
            <a href={receipt.url} target="_blank" rel="noopener noreferrer">
              {receipt.title}
            </a>
            <p>{receipt.claim}</p>
            <blockquote>{receipt.quote}</blockquote>
            <p>
              Проверено <time dateTime={receipt.checked_at}>{receipt.checked_at}</time>
            </p>
            <p>
              SHA-256 выдержки <code>{receipt.excerpt_sha256}</code>
            </p>
            {receipt.project_source_id && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void exclude(receipt.project_source_id!)}
              >
                Исключить из новых исследований
              </button>
            )}
          </li>
        ))}
      </ul>
      {message && <p role="status">{message}</p>}
    </details>
  );
}
