"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type Preview = { preview_id: string; name: string; source: string; text: string };
type Reply = Partial<Preview> & {
  status?: string;
  operation_id?: string;
  version?: number;
  already_present?: boolean;
  error?: { code: string };
};

export function McpDocument({
  project,
  name,
  documentId,
  onBusy,
  onImported
}: {
  project: string;
  name: string;
  documentId?: string;
  onBusy?: (busy: boolean) => void;
  onImported?: () => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [message, setMessage] = useState("");
  const [operation, setOperation] = useState("");
  const pending = useRef<Partial<Record<"preview" | "save", string>>>({});
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function submit(mode: "preview" | "save") {
    if (request.current || (mode === "save" && !preview)) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    onBusy?.(true);
    setWaiting(false);
    setMessage("");
    setOperation("");
    if (mode === "preview") {
      setPreview(null);
      delete pending.current.save;
    }
    const requestId = (pending.current[mode] ??= crypto.randomUUID());
    try {
      const response = await fetch(
        `/api/v1/projects/${encodeURIComponent(project)}/integrations/mcp/document/${mode}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            request_id: requestId,
            ...(documentId ? { document_id: documentId } : {}),
            ...(mode === "save" ? { preview_id: preview?.preview_id } : {})
          })
        }
      );
      const outcome = (await response.json()) as Reply;
      if (controller.signal.aborted) return;
      setOperation(outcome.operation_id ?? "");
      if (outcome.status === "WAITING_CONFIRMATION") {
        setWaiting(true);
        return;
      }
      delete pending.current[mode];
      if (
        response.ok &&
        outcome.status === "EXECUTED" &&
        outcome.preview_id &&
        outcome.name &&
        outcome.source &&
        typeof outcome.text === "string"
      ) {
        setPreview({
          preview_id: outcome.preview_id,
          name: outcome.name,
          source: outcome.source,
          text: outcome.text
        });
      } else if (
        response.ok &&
        outcome.status === "EXECUTED" &&
        typeof outcome.version === "number"
      ) {
        setPreview(null);
        if (outcome.already_present) {
          setMessage(`Точная копия уже в материалах. Версия: ${outcome.version}.`);
        } else {
          onImported?.();
          setMessage(`Документ сохранён. Версия материалов: ${outcome.version}.`);
        }
      } else {
        const code = outcome.error?.code;
        if (code === "MCP_STOPPED" || code === "MCP_UNAVAILABLE" || outcome.status === "DENIED")
          setPreview(null);
        if (code === "MCP_MATERIALS_CHANGED") {
          setPreview(null);
          setMessage("Материалы изменились. Откройте новый предпросмотр.");
        } else if (code === "MCP_DOCUMENT_NAME_CONFLICT") {
          setPreview(null);
          setMessage("Файл с таким именем уже есть и отличается. Существующая копия сохранена.");
        } else if (code === "MCP_MATERIALS_LIMIT") {
          setMessage("Документ не помещается в материалы проекта.");
        } else if (code === "MCP_PREVIEW_EXPIRED") {
          setMessage("Предпросмотр устарел. Запросите его снова.");
        } else {
          setMessage("Документ недоступен. Проверьте разрешения проекта и подключение MCP.");
        }
      }
    } catch {
      if (!controller.signal.aborted)
        setMessage("Ответ потерян. Действие можно проверить повторным нажатием.");
    } finally {
      if (request.current === controller) request.current = null;
      if (!controller.signal.aborted) {
        setBusy(false);
        onBusy?.(false);
      }
    }
  }

  return (
    <section aria-label="Документ MCP">
      <h4>{name}</h4>
      <button type="button" disabled={busy} onClick={() => void submit("preview")}>
        Предпросмотр документа
      </button>
      {preview && (
        <>
          <p>
            Источник: <code>{preview.source}</code>
          </p>
          <pre style={{ whiteSpace: "pre-wrap" }}>{preview.text}</pre>
          <button type="button" disabled={busy} onClick={() => void submit("save")}>
            Подтвердить сохранение в материалы
          </button>
        </>
      )}
      {message && <p role="status">{message}</p>}
      {waiting && (
        <p role="status">
          После подтверждения в{" "}
          <Link
            href={`/control-center?project=${encodeURIComponent(project)}#pending-confirmations`}
            target="_blank"
            rel="noreferrer"
          >
            центре управления
          </Link>{" "}
          повторите действие в этой вкладке.
        </p>
      )}
      {operation && (
        <p>
          Операция в журнале: <code>{operation}</code>
        </p>
      )}
    </section>
  );
}
