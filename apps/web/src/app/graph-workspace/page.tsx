"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  parseIntelligenceGraphPackage,
  INTELLIGENCE_GRAPH_PACKAGE_MAX_BYTES,
  type IntelligenceGraphPortablePackage
} from "@cosmora/contracts/intelligence-graph-package";
import type {
  IntelligenceGraphSummary,
  IntelligenceGraphWorkspaceExplanation,
  IntelligenceGraphWorkspaceReport
} from "@cosmora/contracts";
import { compareGraphRevisions, type GraphConflict } from "./revision-diff";
import { GraphConflictEditor } from "./graph-conflict-editor";
import { GraphExplanationView } from "./graph-explanation";
import { GraphContextPanel } from "./graph-context-panel";
import { IntelligenceGraphView } from "./graph-view";
import { GraphEvidenceEditor } from "./graph-evidence-editor";
import { GraphEvidenceAuditPanel } from "./graph-evidence-audit";
import { mergeGraphSummaryPages } from "./library-pages";
import {
  parseGraphImportAttempt,
  graphImportAttemptSlot,
  type GraphImportAttempt
} from "./import-attempt";

const digest = async (text: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
const download = (value: unknown, filename: string) => {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2) + "\n"], { type: "application/json;charset=utf-8" })
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

type Ref = { id: string; version: number };
type Node = {
  node_id: string;
  node_version: number;
  kind: string;
  verification_status: string;
  created_at?: string;
};
type Edge = {
  edge_id: string;
  edge_version: number;
  type: string;
  from: Ref;
  to: Ref;
  verification_status: string;
  evidence_ref?: { source_id: string; source_version: number; location: string };
  evidence_excerpt?: string;
};
type RecordEntry = { node: Ref; text: string; excerpt: string };
type Graph = {
  graph_id: string;
  title: string;
  revision: number;
  updated_at: string;
  restored_from_revision: number | null;
  nodes: Node[];
  edges: Edge[];
  records: RecordEntry[];
  conflicts?: GraphConflict[];
};
type History = { revision: number; summary: string; restored_from_revision: number | null };
type Explanation = IntelligenceGraphWorkspaceExplanation;
const panel: React.CSSProperties = {
  border: "1px solid #d1d1d1",
  borderRadius: 12,
  padding: 18,
  background: "#fff"
};
const button: React.CSSProperties = {
  border: "1px solid #999",
  borderRadius: 8,
  padding: "9px 14px",
  background: "#fff",
  color: "#171717",
  font: "inherit"
};
const field: React.CSSProperties = {
  width: "100%",
  minWidth: 0,
  borderRadius: 8,
  border: "1px solid #aaa",
  padding: 10,
  font: "inherit",
  background: "#fff",
  color: "#171717"
};

const request = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(url, { ...init, headers });
  if (!response.ok) {
    if (response.status === 404) throw new Error("Граф не найден либо функция ещё не подключена.");
    if (response.status === 409) {
      const failure: unknown = await response.json().catch(() => null);
      if (
        failure &&
        typeof failure === "object" &&
        "error" in failure &&
        failure.error === "IMPORT_KEY_CONFLICT"
      )
        throw new Error("Этот ключ импорта уже связан с другим JSON.");
      throw new Error("Версия графа изменилась. Обновите его перед сохранением.");
    }
    if (response.status === 423)
      throw new Error("Изменения временно заблокированы: идёт операция с данными аккаунта.");
    if (response.status === 410)
      throw new Error("Импортированный граф удалён. Этот ключ не создаст его заново.");
    if (response.status === 401 || response.status === 403)
      throw new Error("Требуется вход владельца.");
    if (response.status === 400) throw new Error("Проверьте введённые данные.");
    throw new Error("Сервис графов сейчас недоступен.");
  }
  return (await response.json()) as T;
};

export default function GraphWorkspacePage() {
  const [projectId, setProjectId] = useState("");
  const [availableProjects, setAvailableProjects] = useState<{ id: string; title: string }[]>([]);
  const [graphs, setGraphs] = useState<IntelligenceGraphSummary[]>([]);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [appliedLibraryQuery, setAppliedLibraryQuery] = useState("");
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<Graph | null>(null);
  const [history, setHistory] = useState<History[]>([]);
  const [title, setTitle] = useState("");
  const [label, setLabel] = useState("");
  const [detail, setDetail] = useState("");
  const [nodeKind, setNodeKind] = useState("Claim");
  const [relation, setRelation] = useState("SUPPORTS");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [edgeToRevise, setEdgeToRevise] = useState("");
  const [nodeToEdit, setNodeToEdit] = useState<Ref | null>(null);
  const [nodeLabelDraft, setNodeLabelDraft] = useState("");
  const [nodeDetailDraft, setNodeDetailDraft] = useState("");
  const [renameDraft, setRenameDraft] = useState("");
  const [nodeSearch, setNodeSearch] = useState("");
  const [query, setQuery] = useState("");
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [importPreview, setImportPreview] = useState<{
    package: IntelligenceGraphPortablePackage;
    sha256: string;
    projectId: string;
    creation_key: string;
  } | null>(null);
  const [storageCorrupt, setStorageCorrupt] = useState(false);
  const [pendingImport, setPendingImport] = useState<GraphImportAttempt | null>(null);
  const [importReviewed, setImportReviewed] = useState(false);
  const [importUncertain, setImportUncertain] = useState(false);
  const [restorePreview, setRestorePreview] = useState<{
    source: Graph;
    base: Graph;
    projectId: string;
  } | null>(null);
  const [restoreReviewed, setRestoreReviewed] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("projectId") ?? "";
    setProjectId(id);
    let alive = true;
    void request<{ items: { id: string; title: string; status: string }[] }>("/api/v1/projects")
      .then(({ items }) => {
        if (alive) setAvailableProjects(items.filter((project) => project.status === "ACTIVE"));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!projectId) {
      setPendingImport(null);
      return;
    }
    setStorageCorrupt(false);
    try {
      setPendingImport(
        parseGraphImportAttempt(sessionStorage.getItem(graphImportAttemptSlot(projectId)))
      );
    } catch {
      setPendingImport(null);
      setStorageCorrupt(true);
      setNotice(
        "Сохранённая попытка импорта недоступна. Проверьте список графов перед новым импортом."
      );
    }
  }, [projectId]);
  const root = `/api/v1/projects/${encodeURIComponent(projectId)}/intelligence-graphs`;
  const graphUrl = selected ? `${root}/${encodeURIComponent(selected.graph_id)}` : "";
  const labels = new Map(
    selected?.records.map((record) => [`${record.node.id}@${record.node.version}`, record.text]) ??
      []
  );
  const activeNodes =
    selected?.nodes.filter(
      (node) => node.verification_status !== "deleted" && node.verification_status !== "superseded"
    ) ?? [];
  const activeEdges =
    selected?.edges.filter(
      (edge) => edge.verification_status !== "deleted" && edge.verification_status !== "superseded"
    ) ?? [];
  const nodeLabel = (ref: Ref) => labels.get(`${ref.id}@${ref.version}`) ?? ref.id;
  const inputRef = (value: string): Ref => {
    const node = activeNodes.find((entry) => entry.node_id === value);
    if (!node) throw new Error("Выберите узел из текущего графа.");
    return { id: node.node_id, version: node.node_version };
  };

  const openGraph = async (id: string, choice: string) => {
    const base = `/api/v1/projects/${encodeURIComponent(id.trim())}/intelligence-graphs`;
    if (choice) {
      const graph = await request<Graph>(`${base}/${encodeURIComponent(choice)}`);
      setSelected(graph);
      setNodeToEdit(null);
      setRestorePreview(null);
      setRestoreReviewed(false);
      setRenameDraft(graph.title);
      setFrom("");
      setTo("");
      setEdgeToRevise("");
      setExplanation(null);
      const revisions = await request<{ items: History[] }>(
        `${base}/${encodeURIComponent(choice)}/revisions`
      );
      setHistory(revisions.items);
    } else {
      setSelected(null);
      setHistory([]);
    }
  };
  const load = async (
    id: string,
    selectId?: string,
    search = appliedLibraryQuery,
    refreshSelection = true
  ) => {
    if (!id.trim()) throw new Error("Укажите ID проекта.");
    const base = `/api/v1/projects/${encodeURIComponent(id.trim())}/intelligence-graphs`;
    const q = search.trim();
    const result = await request<{ items: IntelligenceGraphSummary[]; next_cursor: string | null }>(
      `${base}/library?${new URLSearchParams({ limit: "20", q })}`
    );
    setGraphs(result.items);
    setNextCursor(result.next_cursor ?? null);
    setAppliedLibraryQuery(q);
    setLibraryLoaded(true);
    if (refreshSelection) await openGraph(id, selectId ?? selected?.graph_id ?? "");
  };
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      await action();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Неизвестная ошибка.");
    } finally {
      setBusy(false);
    }
  };
  const edit = (operation: object, after?: () => void) =>
    run(async () => {
      if (!selected) return;
      const changed = await request<Graph>(`${graphUrl}/edits`, {
        method: "POST",
        body: JSON.stringify({ expected_revision: selected.revision, operation })
      });
      // Accept the write before auxiliary history/list reads, which can fail independently.
      setSelected(changed);
      setExplanation(null);
      after?.();
      await load(projectId, changed.graph_id);
    });

  return (
    <main
      style={{
        maxWidth: 1080,
        margin: "0 auto",
        padding: "28px 18px 80px",
        color: "#171717",
        background: "#fafafa",
        minHeight: "100vh",
        fontFamily: "system-ui"
      }}
    >
      <Link href="/" style={{ textDecoration: "underline" }}>
        ← Kosmora / Проекты
      </Link>
      <h1 style={{ marginBottom: 4 }}>Граф знаний проекта</h1>
      <p style={{ color: "#555", lineHeight: 1.55 }}>
        Редактор фактов, гипотез и связей. Ручные записи не считаются проверенными: граф не делает
        автономных выводов и не исполняет задачи.
      </p>
      <section style={panel}>
        {availableProjects.length > 0 && (
          <label style={{ display: "grid", gap: 8, marginBottom: 16 }}>
            Проект графа
            <select
              aria-label="Проект графа"
              style={field}
              disabled={busy}
              value={availableProjects.some((project) => project.id === projectId) ? projectId : ""}
              onChange={(event) => {
                const id = event.target.value;
                setProjectId(id);
                setSelected(null);
                setGraphs([]);
                setNextCursor(null);
                setLibraryLoaded(false);
                setAppliedLibraryQuery("");
                setLibraryQuery("");
                setHistory([]);
                setNodeToEdit(null);
                setExplanation(null);
              }}
            >
              <option value="">Выберите проект</option>
              {availableProjects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.title}
                </option>
              ))}
            </select>
          </label>
        )}
        <label htmlFor="project-id">ID проекта</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          <input
            id="project-id"
            style={{ ...field, flex: "1 1 270px" }}
            value={projectId}
            disabled={busy}
            onChange={(event) => {
              setProjectId(event.target.value);
              setSelected(null);
              setGraphs([]);
              setNextCursor(null);
              setLibraryLoaded(false);
              setAppliedLibraryQuery("");
              setLibraryQuery("");
              setHistory([]);
              setNodeToEdit(null);
              setExplanation(null);
            }}
            placeholder="Существующий ID проекта"
          />
          <button
            style={button}
            disabled={busy}
            onClick={() => void run(() => load(projectId, "", libraryQuery))}
          >
            Открыть графы
          </button>
        </div>
        <form
          style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}
          onSubmit={(event) => {
            event.preventDefault();
            void run(() => load(projectId, selected?.graph_id ?? "", libraryQuery, false));
          }}
        >
          <input
            style={{ ...field, flex: "1 1 240px" }}
            aria-label="Поиск графов по названию"
            value={libraryQuery}
            maxLength={120}
            disabled={busy}
            onChange={(event) => setLibraryQuery(event.target.value)}
            placeholder="Название графа"
          />
          <button style={button} disabled={busy || !projectId.trim()} type="submit">
            Найти графы
          </button>
        </form>
        {libraryLoaded && (
          <p>
            Загружено графов: {graphs.length}
            {appliedLibraryQuery ? ` · поиск: ${appliedLibraryQuery}` : ""}
          </p>
        )}
        {libraryLoaded && graphs.length === 0 && <p>Графов с таким названием не найдено.</p>}
        {graphs.length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
            {graphs.map((graph) => (
              <button
                key={graph.graph_id}
                style={button}
                aria-pressed={selected?.graph_id === graph.graph_id}
                onClick={() => void run(() => openGraph(projectId, graph.graph_id))}
              >
                {graph.title} · v{graph.revision}
              </button>
            ))}
          </div>
        )}
        {nextCursor && (
          <button
            style={{ ...button, marginTop: 14 }}
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const page = await request<{
                  items: IntelligenceGraphSummary[];
                  next_cursor: string | null;
                }>(
                  `${root}/library?${new URLSearchParams({ limit: "20", q: appliedLibraryQuery, after: nextCursor })}`
                );
                setGraphs((current) => mergeGraphSummaryPages(current, page.items));
                setNextCursor(page.next_cursor ?? null);
              })
            }
          >
            Загрузить ещё графы
          </button>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              const created = await request<Graph>(root, {
                method: "POST",
                body: JSON.stringify({ title })
              });
              setTitle("");
              await load(projectId, created.graph_id);
            });
          }}
          style={{ display: "flex", gap: 8, marginTop: 18, flexWrap: "wrap" }}
        >
          <input
            style={{ ...field, flex: "1 1 220px" }}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={80}
            placeholder="Название нового графа"
            required
          />
          <button style={button} disabled={busy || !title.trim()} type="submit">
            Создать пустой граф
          </button>
        </form>
      </section>
      <section style={{ ...panel, marginTop: 18 }}>
        <h2>Перенос графа</h2>
        <p>
          JSON переносит текущий текст и связи. Новый граф получит отдельную историю; все записи
          останутся непроверенными.
        </p>
        <input
          type="file"
          accept=".json,application/json"
          aria-label="Импорт графа JSON"
          disabled={busy || !projectId.trim()}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (!file || !projectId.trim() || busy) return;
            const targetProject = projectId;
            void run(async () => {
              setImportPreview(null);
              setImportReviewed(false);
              if (file.size > INTELLIGENCE_GRAPH_PACKAGE_MAX_BYTES)
                throw new Error("Файл превышает 800 000 байт.");
              const text = new TextDecoder("utf-8", { fatal: true }).decode(
                await file.arrayBuffer()
              );
              const portable = parseIntelligenceGraphPackage(text);
              const sha256 = await digest(JSON.stringify(portable));
              if (pendingImport && pendingImport.sha256 !== sha256)
                throw new Error(
                  "Выберите исходный JSON незавершённой попытки либо сначала проверьте её результат."
                );
              setImportUncertain(false);
              setImportPreview({
                package: portable,
                sha256,
                projectId: targetProject,
                creation_key: pendingImport?.creation_key ?? crypto.randomUUID()
              });
            });
          }}
        />
        {importPreview && (
          <div>
            <p>
              Проект: {importPreview.projectId}. Узлов: {importPreview.package.nodes.length},
              связей: {importPreview.package.edges.length}, разборов противоречий:{" "}
              {importPreview.package.conflicts?.length ?? 0}.
            </p>
            <p style={{ overflowWrap: "anywhere" }}>SHA-256: {importPreview.sha256}</p>
            <pre style={{ whiteSpace: "pre-wrap", maxHeight: 340, overflow: "auto" }}>
              {JSON.stringify(importPreview.package, null, 2)}
            </pre>
            <label>
              <input
                type="checkbox"
                checked={importReviewed}
                disabled={busy || importUncertain}
                onChange={(event) => setImportReviewed(event.target.checked)}
              />{" "}
              Текст, связи и решения просмотрены
            </label>
            <button
              style={button}
              disabled={
                busy ||
                storageCorrupt ||
                importUncertain ||
                !importReviewed ||
                importPreview.projectId !== projectId
              }
              onClick={() =>
                void run(async () => {
                  const attempt = {
                    creation_key: importPreview.creation_key,
                    sha256: importPreview.sha256
                  };
                  const slot = graphImportAttemptSlot(projectId);
                  sessionStorage.setItem(slot, JSON.stringify(attempt));
                  if (sessionStorage.getItem(slot) !== JSON.stringify(attempt))
                    throw new Error("Не удалось сохранить ключ до отправки импорта.");
                  setPendingImport(attempt);
                  setImportUncertain(true);
                  let created: Graph;
                  try {
                    created = await request<Graph>(root + "/import", {
                      method: "POST",
                      body: JSON.stringify({
                        package: importPreview.package,
                        expected_sha256: importPreview.sha256,
                        creation_key: importPreview.creation_key
                      })
                    });
                  } catch (error) {
                    setNotice(
                      "Ответ импорта не подтверждён. Проверьте список графов перед новым импортом."
                    );
                    throw error;
                  }
                  sessionStorage.removeItem(slot);
                  setPendingImport(null);
                  setImportUncertain(false);
                  setImportPreview(null);
                  setImportReviewed(false);
                  setSelected(created);
                  await load(projectId, created.graph_id);
                })
              }
            >
              Создать отдельный граф
            </button>
            <button
              style={button}
              disabled={busy}
              onClick={() => {
                if (
                  importUncertain &&
                  !window.confirm(
                    "Закрыть только предпросмотр? Ключ сохранится; результат можно проверить без повторной записи."
                  )
                )
                  return;
                setImportPreview(null);
                setImportReviewed(false);
                setImportUncertain(false);
              }}
            >
              Закрыть предпросмотр
            </button>
            {importUncertain && (
              <p role="alert">
                Результат импорта неизвестен. Проверьте сохранённый ключ ниже. Автоматического
                повтора записи нет.
              </p>
            )}
          </div>
        )}
        {storageCorrupt && (
          <p role="alert">
            Не удалось прочитать сохранённый ключ.
            <button
              style={button}
              disabled={busy}
              onClick={() => {
                if (
                  !window.confirm(
                    "Локальный ключ недоступен. Вы проверили список графов перед очисткой?"
                  )
                )
                  return;
                try {
                  sessionStorage.removeItem(graphImportAttemptSlot(projectId));
                  setStorageCorrupt(false);
                } catch {
                  setNotice("Хранилище вкладки недоступно.");
                }
              }}
            >
              Очистить недоступную локальную запись
            </button>
          </p>
        )}
        {pendingImport && (
          <div role="status">
            <h3>Незавершённая попытка импорта</h3>
            <p style={{ overflowWrap: "anywhere" }}>
              Ключ: {pendingImport.creation_key}. SHA-256: {pendingImport.sha256}.
            </p>
            <p>
              Ключ переживает перезагрузку этой вкладки. Текст JSON не хранится: для явного повтора
              выберите исходный файл. Повтор с тем же ключом вернёт тот же граф.
            </p>
            <button
              style={button}
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const recovered = await request<{ graph: Graph; sha256: string }>(
                    root + "/imports/" + encodeURIComponent(pendingImport.creation_key)
                  );
                  if (recovered.sha256 !== pendingImport.sha256)
                    throw new Error("Хеш сохранённой попытки не совпал.");
                  sessionStorage.removeItem(graphImportAttemptSlot(projectId));
                  setPendingImport(null);
                  setImportPreview(null);
                  setImportReviewed(false);
                  setImportUncertain(false);
                  setSelected(recovered.graph);
                  await load(projectId, recovered.graph.graph_id);
                })
              }
            >
              Проверить результат импорта
            </button>
            <button
              style={button}
              disabled={busy}
              onClick={() => {
                if (
                  !window.confirm(
                    "Забыть только локальный ключ? Уже созданный граф останется на сервере. Перед новым импортом проверьте список."
                  )
                )
                  return;
                sessionStorage.removeItem(graphImportAttemptSlot(projectId));
                setPendingImport(null);
                setImportPreview(null);
                setImportReviewed(false);
                setImportUncertain(false);
              }}
            >
              Забыть локальную попытку
            </button>
          </div>
        )}
        {selected && (
          <button
            style={button}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const exported = await request<{ package: unknown; sha256: string }>(
                  graphUrl + "/package"
                );
                const portable = parseIntelligenceGraphPackage(exported.package);
                if ((await digest(JSON.stringify(portable))) !== exported.sha256)
                  throw new Error("Хеш выгрузки не совпал.");
                download(portable, `graph-${selected.graph_id}-v${selected.revision}.json`);
              })
            }
          >
            Скачать текущий граф JSON
          </button>
        )}
      </section>
      {notice && (
        <p role="alert" style={{ marginTop: 15, fontWeight: 600 }}>
          {notice}
        </p>
      )}
      {busy && <p role="status">Сохранение или загрузка…</p>}
      {selected && (
        <div style={{ display: "grid", gap: 18, marginTop: 18 }}>
          <section style={panel}>
            <h2>
              {selected.title} <small style={{ color: "#666" }}>ревизия {selected.revision}</small>
            </h2>
            <p>
              Узлов: {activeNodes.length}, активных связей: {activeEdges.length}.
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void edit({ kind: "rename", title: renameDraft });
              }}
              style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
            >
              <input
                aria-label="Новое название графа"
                style={{ ...field, flex: 1 }}
                maxLength={80}
                value={renameDraft}
                disabled={busy}
                onChange={(event) => setRenameDraft(event.target.value)}
                required
              />
              <button
                style={button}
                disabled={busy || !renameDraft.trim() || renameDraft === selected.title}
              >
                Переименовать
              </button>
            </form>
            <IntelligenceGraphView
              key={`${selected.graph_id}:${selected.revision}`}
              graph={selected}
            />
            <h3>Узлы</h3>
            <input
              aria-label="Поиск узлов"
              style={field}
              value={nodeSearch}
              maxLength={200}
              onChange={(event) => setNodeSearch(event.target.value)}
              placeholder="Поиск по названию, описанию и типу"
            />
            <ul>
              {activeNodes
                .filter((node) => {
                  const record = selected.records.find(
                    (r) => r.node.id === node.node_id && r.node.version === node.node_version
                  );
                  return [record?.text, record?.excerpt, node.kind]
                    .join(" ")
                    .toLocaleLowerCase()
                    .includes(nodeSearch.toLocaleLowerCase());
                })
                .map((node) => (
                  <li key={node.node_id}>
                    <strong>{nodeLabel({ id: node.node_id, version: node.node_version })}</strong> ·{" "}
                    {node.kind} · {node.verification_status}
                    <button
                      style={button}
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (
                          nodeToEdit &&
                          !window.confirm("Оставить несохранённый текст выбранного узла?")
                        )
                          return;
                        const record = selected.records.find(
                          (r) => r.node.id === node.node_id && r.node.version === node.node_version
                        );
                        setNodeToEdit({ id: node.node_id, version: node.node_version });
                        setNodeLabelDraft(record?.text ?? "");
                        setNodeDetailDraft(record?.excerpt ?? "");
                      }}
                    >
                      Изменить
                    </button>
                  </li>
                ))}
            </ul>
            {activeNodes.length === 0 && <p>Граф пуст. Добавьте первый узел вручную.</p>}
            {nodeToEdit && (
              <form
                style={{ display: "grid", gap: 8 }}
                onSubmit={(event) => {
                  event.preventDefault();
                  void edit(
                    {
                      kind: "revise_node",
                      node: nodeToEdit,
                      label: nodeLabelDraft,
                      detail: nodeDetailDraft
                    },
                    () => setNodeToEdit(null)
                  );
                }}
              >
                <h3>Изменить узел · v{nodeToEdit.version}</h3>
                <p>
                  Текст и связи получат новые непроверенные версии. Предыдущие версии сохранятся.
                </p>
                <input
                  aria-label="Название выбранного узла"
                  style={field}
                  value={nodeLabelDraft}
                  maxLength={120}
                  disabled={busy}
                  onChange={(event) => setNodeLabelDraft(event.target.value)}
                  required
                />
                <textarea
                  aria-label="Описание выбранного узла"
                  style={field}
                  rows={4}
                  value={nodeDetailDraft}
                  maxLength={1000}
                  disabled={busy}
                  onChange={(event) => setNodeDetailDraft(event.target.value)}
                  required
                />
                <button
                  style={button}
                  disabled={busy || !nodeLabelDraft.trim() || !nodeDetailDraft.trim()}
                >
                  Сохранить новую версию узла
                </button>
                <button
                  style={button}
                  type="button"
                  disabled={busy}
                  onClick={() => setNodeToEdit(null)}
                >
                  Закрыть правку
                </button>
                <button
                  style={button}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    const count = activeEdges.filter(
                      (e) => e.from.id === nodeToEdit.id || e.to.id === nodeToEdit.id
                    ).length;
                    if (
                      window.confirm(
                        `Удалить узел и его действующие связи (${count})? Прежние версии сохранятся.`
                      )
                    )
                      void edit({ kind: "remove_node", node: nodeToEdit }, () =>
                        setNodeToEdit(null)
                      );
                  }}
                >
                  Удалить узел и связи
                </button>
              </form>
            )}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void edit({ kind: "add_node", node_kind: nodeKind, label, detail }, () => {
                  setLabel("");
                  setDetail("");
                });
              }}
              style={{ display: "grid", gap: 8 }}
            >
              <h3>Добавить узел</h3>
              <select
                aria-label="Тип узла"
                style={field}
                value={nodeKind}
                onChange={(event) => setNodeKind(event.target.value)}
              >
                {["Claim", "Entity", "Source", "Document", "Decision", "Goal", "Task"].map(
                  (kind) => (
                    <option key={kind} value={kind}>
                      {
                        (
                          {
                            Claim: "Утверждение",
                            Entity: "Сущность",
                            Source: "Источник",
                            Document: "Документ",
                            Decision: "Решение",
                            Goal: "Цель",
                            Task: "Задача"
                          } as Record<string, string>
                        )[kind]
                      }
                    </option>
                  )
                )}
              </select>
              <input
                style={field}
                value={label}
                maxLength={120}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="Название"
                required
              />
              <textarea
                style={field}
                value={detail}
                maxLength={1000}
                onChange={(event) => setDetail(event.target.value)}
                placeholder="Описание / ввод владельца"
                required
                rows={3}
              />
              <button
                type="submit"
                style={button}
                disabled={busy || !label.trim() || !detail.trim()}
              >
                Сохранить узел
              </button>
            </form>
          </section>
          <section style={panel}>
            <h2>Связи</h2>
            <GraphConflictEditor
              key={`conflicts:${selected.graph_id}:${selected.revision}`}
              graph={selected}
              busy={busy}
              onEdit={edit}
            />
            <GraphEvidenceEditor
              key={`${selected.graph_id}:${selected.revision}`}
              graph={selected}
              busy={busy}
              onEdit={edit}
            />
            <ul>
              {activeEdges.map((edge) => (
                <li key={edge.edge_id}>
                  {nodeLabel(edge.from)} → <strong>{edge.type}</strong> → {nodeLabel(edge.to)} (
                  {edge.verification_status}, v{edge.edge_version}){" "}
                  <button
                    type="button"
                    style={button}
                    onClick={() => void edit({ kind: "remove_edge", edge_id: edge.edge_id })}
                    disabled={busy}
                  >
                    Убрать
                  </button>
                </li>
              ))}
            </ul>
            <h3>Добавить или изменить связь</h3>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!from || !to) {
                  setNotice("Укажите оба узла.");
                  return;
                }
                if (edgeToRevise) {
                  void edit({
                    kind: "revise_edge",
                    edge_id: edgeToRevise,
                    from: inputRef(from),
                    to: inputRef(to)
                  });
                } else {
                  void edit({ kind: "add_edge", relation, from: inputRef(from), to: inputRef(to) });
                }
              }}
              style={{ display: "grid", gap: 8 }}
            >
              <select
                style={field}
                aria-label="Редактируемая связь"
                value={edgeToRevise}
                onChange={(event) => setEdgeToRevise(event.target.value)}
              >
                <option value="">Новая связь</option>
                {activeEdges.map((edge) => (
                  <option key={edge.edge_id} value={edge.edge_id}>
                    {nodeLabel(edge.from)} → {edge.type} → {nodeLabel(edge.to)}
                  </option>
                ))}
              </select>
              {!edgeToRevise && (
                <select
                  aria-label="Тип связи"
                  style={field}
                  value={relation}
                  onChange={(event) => setRelation(event.target.value)}
                >
                  {["SUPPORTS", "CONTRADICTS", "DEPENDS_ON", "IMPLEMENTS", "REFERENCES"].map(
                    (type) => (
                      <option key={type}>{type}</option>
                    )
                  )}
                </select>
              )}
              <select
                aria-label="От узла"
                style={field}
                value={from}
                onChange={(event) => setFrom(event.target.value)}
                required
              >
                <option value="">Исходный узел</option>
                {activeNodes.map((node) => (
                  <option key={node.node_id} value={node.node_id}>
                    {nodeLabel({ id: node.node_id, version: node.node_version })}
                  </option>
                ))}
              </select>
              <select
                aria-label="К узлу"
                style={field}
                value={to}
                onChange={(event) => setTo(event.target.value)}
                required
              >
                <option value="">Связанный узел</option>
                {activeNodes.map((node) => (
                  <option key={node.node_id} value={node.node_id}>
                    {nodeLabel({ id: node.node_id, version: node.node_version })}
                  </option>
                ))}
              </select>
              <button style={button} disabled={busy || activeNodes.length < 2} type="submit">
                {edgeToRevise ? "Сохранить новую версию связи" : "Добавить связь"}
              </button>
            </form>
          </section>
          <section style={panel}>
            <h2>Версии и восстановление</h2>
            <ul>
              {history.map((version) => (
                <li key={version.revision}>
                  v{version.revision} — {version.summary}{" "}
                  {version.revision !== selected.revision && (
                    <button
                      style={button}
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const source = await request<Graph>(
                            `${graphUrl}/revisions/${version.revision}`
                          );
                          setRestorePreview({ source, base: selected, projectId });
                          setRestoreReviewed(false);
                        })
                      }
                    >
                      Сравнить перед восстановлением
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
          {restorePreview && (
            <section style={panel}>
              <h2>
                Восстановление v{restorePreview.source.revision} поверх v
                {restorePreview.base.revision}
              </h2>
              <p>Ниже изменения текущего содержимого. Предыдущие ревизии сохранятся.</p>
              {compareGraphRevisions(restorePreview.base, restorePreview.source).map((change) => (
                <div key={`${change.kind}:${change.id}`}>
                  <strong>
                    {change.kind} · {change.id}
                  </strong>
                  <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                    Сейчас: {change.before ?? "Отсутствует"}
                  </pre>
                  <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                    После: {change.after ?? "Отсутствует"}
                  </pre>
                </div>
              ))}
              {compareGraphRevisions(restorePreview.base, restorePreview.source).length === 0 && (
                <p>Текущее содержимое совпадает.</p>
              )}
              <label>
                <input
                  type="checkbox"
                  checked={restoreReviewed}
                  disabled={busy}
                  onChange={(event) => setRestoreReviewed(event.target.checked)}
                />{" "}
                Изменения просмотрены
              </label>
              <button
                style={button}
                disabled={
                  busy ||
                  !restoreReviewed ||
                  restorePreview.projectId !== projectId ||
                  restorePreview.base.graph_id !== selected.graph_id ||
                  restorePreview.base.revision !== selected.revision
                }
                onClick={() =>
                  void run(async () => {
                    const restored = await request<Graph>(graphUrl + "/restore", {
                      method: "POST",
                      body: JSON.stringify({
                        expected_revision: restorePreview.base.revision,
                        from_revision: restorePreview.source.revision
                      })
                    });
                    setSelected(restored);
                    setRestorePreview(null);
                    setRestoreReviewed(false);
                    await load(projectId, restored.graph_id);
                  })
                }
              >
                Подтвердить восстановление
              </button>
              <button
                style={button}
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const exported = await request<{ package: unknown; sha256: string }>(
                      `${graphUrl}/package?revision=${restorePreview.source.revision}`
                    );
                    const portable = parseIntelligenceGraphPackage(exported.package);
                    if ((await digest(JSON.stringify(portable))) !== exported.sha256)
                      throw new Error("Хеш выгрузки не совпал.");
                    download(
                      portable,
                      `graph-${selected.graph_id}-v${restorePreview.source.revision}.json`
                    );
                  })
                }
              >
                Скачать выбранную ревизию JSON
              </button>
            </section>
          )}
          <section style={panel}>
            <h2>Объяснение графа</h2>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  const result = await request<Explanation>(
                    `${graphUrl}/explain?q=${encodeURIComponent(query)}&revision=${selected.revision}`
                  );
                  setExplanation(result);
                });
              }}
              style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
            >
              <input
                style={{ ...field, flex: "1 1 240px" }}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Что искать в графе?"
                maxLength={500}
                required
              />
              <button type="submit" style={button} disabled={busy || !query.trim()}>
                Объяснить
              </button>
            </form>
            {explanation && (
              <GraphExplanationView
                explanation={explanation}
                busy={busy}
                onDownload={() =>
                  run(async () => {
                    const result = await request<{
                      report: IntelligenceGraphWorkspaceReport;
                      sha256: string;
                    }>(
                      `${root}/${encodeURIComponent(explanation.graph_id)}/report?q=${encodeURIComponent(explanation.query)}&revision=${explanation.revision}`
                    );
                    if (
                      result.report.format !== "kosmora.intelligence-graph-report.v1" ||
                      result.report.reading.graph_id !== explanation.graph_id ||
                      result.report.reading.revision !== explanation.revision ||
                      result.report.reading.query !== explanation.query ||
                      (await digest(JSON.stringify(result.report))) !== result.sha256
                    )
                      throw new Error("Отчёт не совпал с выбранной ревизией и запросом.");
                    download(
                      result.report,
                      `graph-${explanation.graph_id}-v${explanation.revision}-report.json`
                    );
                  })
                }
              />
            )}
          </section>
          <GraphEvidenceAuditPanel
            key={`evidence:${projectId}:${selected.graph_id}:${selected.revision}`}
            projectId={projectId}
            graphId={selected.graph_id}
            revision={selected.revision}
          />
          <GraphContextPanel
            key={`context:${projectId}:${selected.graph_id}:${selected.revision}`}
            projectId={projectId}
            graphId={selected.graph_id}
            revision={selected.revision}
          />
        </div>
      )}
    </main>
  );
}
