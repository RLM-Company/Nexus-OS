"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { McpImportHistory } from "./mcp-import-history";
import { McpDocument } from "./mcp-document";

type Availability = {
  configured: boolean;
  stopped: boolean;
  document?: string;
  document_id?: string;
  documents?: { id: string; name: string }[];
};
type Discovery = { status: string; tools?: string[]; hasMore?: boolean; operation_id?: string };

export function McpIntegration({ project }: { project: string }) {
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [importsRefresh, refreshImports] = useState(0);
  const onImported = () => refreshImports((value) => value + 1);
  const [documentId, setDocumentId] = useState("");
  const [documentBusy, setDocumentBusy] = useState(false);
  const documents =
    availability?.documents ??
    (availability?.document
      ? [{ id: availability.document_id ?? "", name: availability.document }]
      : []);
  const selectedDocument = documents.find(({ id }) => id === documentId) ?? documents[0];
  const [result, setResult] = useState<Discovery | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const requestId = useRef<string | null>(null);
  const lifetime = useRef<AbortController | null>(null);
  const path = `/api/v1/projects/${encodeURIComponent(project)}/integrations/mcp`;
  const storageKey = `kosmora:mcp-discovery:${project}`;

  function rememberRequest(value: string | null) {
    requestId.current = value;
    try {
      if (value) sessionStorage.setItem(storageKey, value);
      else sessionStorage.removeItem(storageKey);
    } catch {
      // The current view can still recover its in-memory request.
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    try {
      requestId.current = sessionStorage.getItem(storageKey);
    } catch {
      requestId.current = null;
    }
    void fetch(path, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const status = (await response.json()) as Availability;
        if (!controller.signal.aborted) setAvailability(status);
      })
      .catch(() => {
        if (!controller.signal.aborted) setMessage("Статус MCP недоступен.");
      });
    return () => controller.abort();
  }, [path, storageKey]);

  async function discover() {
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted || busy) return;
    setBusy(true);
    setMessage("");
    setResult(null);
    if (!requestId.current) rememberRequest(crypto.randomUUID());
    try {
      const response = await fetch(path + "/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request_id: requestId.current }),
        signal
      });
      const outcome = (await response.json()) as Discovery;
      if (signal.aborted) return;
      if (!outcome.status) {
        rememberRequest(null);
        setMessage("MCP недоступен для этого проекта или остановлен.");
        return;
      }
      setResult(outcome);
      if (outcome.status !== "WAITING_CONFIRMATION") rememberRequest(null);
    } catch {
      if (!signal.aborted) setMessage("Ответ не получен. Проверку можно повторить вручную.");
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }

  return (
    <section aria-label="MCP">
      <h3>MCP</h3>
      {!availability && !message && <p>Проверяем настройки проекта…</p>}
      {availability && (
        <p>
          {availability.stopped
            ? "Операции остановлены."
            : availability.configured
              ? "Сервер настроен. Запросите список инструментов."
              : "Сервер MCP для проекта не настроен."}
        </p>
      )}
      {availability?.configured && (
        <button
          type="button"
          disabled={busy || availability.stopped}
          onClick={() => void discover()}
        >
          {busy ? "Проверяем…" : "Проверить MCP и показать инструменты"}
        </button>
      )}
      {availability?.configured && selectedDocument && (
        <>
          {documents.length > 1 && (
            <label>
              Документ для импорта
              <select
                value={selectedDocument.id}
                disabled={documentBusy}
                onChange={(event) => setDocumentId(event.target.value)}
              >
                {documents.map(({ id, name }) => (
                  <option value={id} key={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <McpDocument
            key={selectedDocument.id}
            project={project}
            name={selectedDocument.name}
            {...(selectedDocument.id ? { documentId: selectedDocument.id } : {})}
            stopped={availability.stopped}
            onBusy={setDocumentBusy}
            onImported={onImported}
          />
        </>
      )}
      <McpImportHistory path={path} refresh={importsRefresh} />
      {message && <p role="alert">{message}</p>}
      {result?.status === "WAITING_CONFIRMATION" && (
        <p role="status">
          Подтвердите чтение в{" "}
          <Link
            href={`/control-center?project=${encodeURIComponent(project)}#pending-confirmations`}
          >
            центре управления
          </Link>{" "}
          и повторите проверку.
        </p>
      )}
      {result?.status === "EXECUTED" && (
        <>
          <p role="status">
            {result.tools?.length ? "Сервер вернул инструменты." : "Сервер не объявил инструменты."}
            {result.hasMore && " Показана первая страница."}
          </p>
          {Boolean(result.tools?.length) && (
            <ul>
              {result.tools?.map((name) => (
                <li key={name}>
                  <code>{name}</code>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {result?.status === "RECOVERY_REQUIRED" && (
        <p role="alert">
          Ответ сервера MCP не подтверждён. Проверьте подключение перед новым запросом.
        </p>
      )}
      {result && ["DENIED", "PAUSED", "FAILED"].includes(result.status) && (
        <p role="alert">Политика проекта не разрешила проверку MCP.</p>
      )}
      {result?.operation_id && (
        <p>
          Операция в журнале: <code>{result.operation_id}</code>
        </p>
      )}
    </section>
  );
}
