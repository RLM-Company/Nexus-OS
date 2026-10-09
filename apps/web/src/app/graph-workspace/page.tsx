"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Ref = { id: string; version: number };
type Node = { node_id: string; node_version: number; kind: string; verification_status: string };
type Edge = {
  edge_id: string; edge_version: number; type: string;
  from: Ref; to: Ref; verification_status: string
};
type RecordEntry = { node: Ref; text: string; excerpt: string };
type Graph = {
  graph_id: string; title: string; revision: number; updated_at: string;
  restored_from_revision: number | null;
  nodes: Node[]; edges: Edge[]; records: RecordEntry[]
};
type History = { revision: number; summary: string; restored_from_revision: number | null };
type Explanation = {
  readiness: "grounded_context" | "review_required" | "abstain";
  explanation: string; truncated: boolean;
  matched_nodes: { id: string; label: string; detail: string | null; status: string }[];
  relationships: { edge_id: string; description: string; status: string; note: string }[]
};
const panel: React.CSSProperties = {
  border: "1px solid #d1d1d1", borderRadius: 12, padding: 18, background: "#fff"
};
const button: React.CSSProperties = {
  border: "1px solid #999", borderRadius: 8, padding: "9px 14px",
  background: "#fff", color: "#171717", font: "inherit"
};
const field: React.CSSProperties = {
  width: "100%", minWidth: 0, borderRadius: 8, border: "1px solid #aaa",
  padding: 10, font: "inherit", background: "#fff", color: "#171717"
};

const request = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(url, { ...init, headers });
  if (!response.ok) {
    if (response.status === 404) throw new Error("Граф не найден либо функция ещё не подключена.");
    if (response.status === 409) throw new Error("Версия графа изменилась. Обновите его перед сохранением.");
    if (response.status === 401 || response.status === 403) throw new Error("Требуется вход владельца.");
    if (response.status === 400) throw new Error("Проверьте введённые данные.");
    throw new Error("Сервис графов сейчас недоступен.");
  }
  return await response.json() as T;
};

export default function GraphWorkspacePage() {
  const [projectId, setProjectId] = useState("");
  const [graphs, setGraphs] = useState<Graph[]>([]);
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
  const [query, setQuery] = useState("");
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("projectId") ?? "";
    setProjectId(id);
  }, []);
  const root = `/api/v1/projects/${encodeURIComponent(projectId)}/intelligence-graphs`;
  const graphUrl = selected ? `${root}/${encodeURIComponent(selected.graph_id)}` : "";
  const labels = new Map(selected?.records.map((record) => [`${record.node.id}@${record.node.version}`, record.text]) ?? []);
  const activeNodes = selected?.nodes.filter((node) =>
    node.verification_status !== "deleted" && node.verification_status !== "superseded"
  ) ?? [];
  const activeEdges = selected?.edges.filter((edge) =>
    edge.verification_status !== "deleted" && edge.verification_status !== "superseded"
  ) ?? [];
  const nodeLabel = (ref: Ref) => labels.get(`${ref.id}@${ref.version}`) ?? ref.id;
  const inputRef = (value: string): Ref => {
    const node = activeNodes.find((entry) => entry.node_id === value);
    if (!node) throw new Error("Выберите узел из текущего графа.");
    return { id: node.node_id, version: node.node_version };
  };

  const load = async (id: string, selectId?: string) => {
    if (!id.trim()) throw new Error("Укажите ID проекта.");
    const base = `/api/v1/projects/${encodeURIComponent(id.trim())}/intelligence-graphs`;
    const result = await request<{ items: Graph[] }>(base);
    setGraphs(result.items);
    const choice = selectId ?? selected?.graph_id;
    if (choice) {
      const graph = await request<Graph>(`${base}/${encodeURIComponent(choice)}`);
      setSelected(graph);
      const revisions = await request<{ items: History[] }>(
        `${base}/${encodeURIComponent(choice)}/revisions`
      );
      setHistory(revisions.items);
    } else {
      setSelected(null);
      setHistory([]);
    }
  };
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setNotice("");
    try { await action(); } catch (error) {
      setNotice(error instanceof Error ? error.message : "Неизвестная ошибка.");
    } finally { setBusy(false); }
  };
  const edit = (operation: object) => run(async () => {
    if (!selected) return;
    const changed = await request<Graph>(`${graphUrl}/edits`, {
      method: "POST",
      body: JSON.stringify({ expected_revision: selected.revision, operation })
    });
    await load(projectId, changed.graph_id);
    setExplanation(null);
  });

  return (
    <main style={{
      maxWidth: 1080, margin: "0 auto", padding: "28px 18px 80px",
      color: "#171717", background: "#fafafa", minHeight: "100vh", fontFamily: "system-ui"
    }}>
      <Link href="/" style={{ textDecoration: "underline" }}>← Kosmora / Проекты</Link>
      <h1 style={{ marginBottom: 4 }}>Граф знаний проекта</h1>
      <p style={{ color: "#555", lineHeight: 1.55 }}>
        Редактор фактов, гипотез и связей. Ручные записи не считаются проверенными:
        граф не делает автономных выводов и не исполняет задачи.
      </p>
      <section style={panel}>
        <label htmlFor="project-id">ID проекта</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          <input id="project-id" style={{ ...field, flex: "1 1 270px" }}
            value={projectId} onChange={(event) => setProjectId(event.target.value)}
            placeholder="Существующий ID проекта" />
          <button style={button} disabled={busy} onClick={() => void run(() => load(projectId, ""))}>
            Открыть графы
          </button>
        </div>
        {graphs.length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
            {graphs.map((graph) => (
              <button key={graph.graph_id} style={button}
                aria-pressed={selected?.graph_id === graph.graph_id}
                onClick={() => void run(() => load(projectId, graph.graph_id))}>
                {graph.title} · v{graph.revision}
              </button>
            ))}
          </div>
        )}
        <form onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            const created = await request<Graph>(root, {
              method: "POST", body: JSON.stringify({ title })
            });
            setTitle("");
            await load(projectId, created.graph_id);
          });
        }} style={{ display: "flex", gap: 8, marginTop: 18, flexWrap: "wrap" }}>
          <input style={{ ...field, flex: "1 1 220px" }}
            value={title} onChange={(event) => setTitle(event.target.value)}
            maxLength={80} placeholder="Название нового графа" required />
          <button style={button} disabled={busy || !title.trim()} type="submit">Создать пустой граф</button>
        </form>
      </section>
      {notice && <p role="alert" style={{ marginTop: 15, fontWeight: 600 }}>{notice}</p>}
      {busy && <p role="status">Сохранение или загрузка…</p>}
      {selected && (
        <div style={{ display: "grid", gap: 18, marginTop: 18 }}>
          <section style={panel}>
            <h2>{selected.title} <small style={{ color: "#666" }}>ревизия {selected.revision}</small></h2>
            <p>Узлов: {activeNodes.length}, активных связей: {activeEdges.length}.</p>
            <h3>Узлы</h3>
            <ul>
              {activeNodes.map((node) => (
                <li key={node.node_id}>
                  <strong>{nodeLabel({ id: node.node_id, version: node.node_version })}</strong>
                  {" "}· {node.kind} · {node.verification_status}
                </li>
              ))}
            </ul>
            {activeNodes.length === 0 && <p>Граф пуст. Добавьте первый узел вручную.</p>}
            <form onSubmit={(event) => {
              event.preventDefault();
              void edit({ kind: "add_node", node_kind: nodeKind, label, detail });
              setLabel(""); setDetail("");
            }} style={{ display: "grid", gap: 8 }}>
              <h3>Добавить узел</h3>
              <select aria-label="Тип узла" style={field} value={nodeKind}
                onChange={(event) => setNodeKind(event.target.value)}>
                {["Claim", "Entity", "Source", "Document", "Decision", "Goal", "Task"]
                  .map((kind) => <option key={kind}>{kind}</option>)}
              </select>
              <input style={field} value={label} maxLength={120}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="Название" required />
              <textarea style={field} value={detail} maxLength={1000}
                onChange={(event) => setDetail(event.target.value)}
                placeholder="Описание / ввод владельца" required rows={3} />
              <button type="submit" style={button} disabled={busy || !label.trim() || !detail.trim()}>
                Сохранить узел
              </button>
            </form>
          </section>
          <section style={panel}>
            <h2>Связи</h2>
            <ul>
              {activeEdges.map((edge) => (
                <li key={edge.edge_id}>
                  {nodeLabel(edge.from)} → <strong>{edge.type}</strong> → {nodeLabel(edge.to)}
                  {" "}({edge.verification_status}, v{edge.edge_version}){" "}
                  <button type="button" style={button}
                    onClick={() => void edit({ kind: "remove_edge", edge_id: edge.edge_id })}
                    disabled={busy}>Убрать</button>
                </li>
              ))}
            </ul>
            <h3>Добавить или изменить связь</h3>
            <form onSubmit={(event) => {
              event.preventDefault();
              if (!from || !to) { setNotice("Укажите оба узла."); return; }
              if (edgeToRevise) {
                void edit({ kind: "revise_edge", edge_id: edgeToRevise,
                  from: inputRef(from), to: inputRef(to) });
              } else {
                void edit({ kind: "add_edge", relation,
                  from: inputRef(from), to: inputRef(to) });
              }
            }} style={{ display: "grid", gap: 8 }}>
              <select style={field} aria-label="Редактируемая связь"
                value={edgeToRevise} onChange={(event) => setEdgeToRevise(event.target.value)}>
                <option value="">Новая связь</option>
                {activeEdges.map((edge) => (
                  <option key={edge.edge_id} value={edge.edge_id}>
                    {nodeLabel(edge.from)} → {edge.type} → {nodeLabel(edge.to)}
                  </option>
                ))}
              </select>
              {!edgeToRevise && <select aria-label="Тип связи" style={field}
                value={relation} onChange={(event) => setRelation(event.target.value)}>
                {["SUPPORTS", "CONTRADICTS", "DEPENDS_ON", "IMPLEMENTS", "REFERENCES"]
                  .map((type) => <option key={type}>{type}</option>)}
              </select>}
              <select aria-label="От узла" style={field} value={from}
                onChange={(event) => setFrom(event.target.value)} required>
                <option value="">Исходный узел</option>
                {activeNodes.map((node) => <option key={node.node_id} value={node.node_id}>
                  {nodeLabel({ id: node.node_id, version: node.node_version })}
                </option>)}
              </select>
              <select aria-label="К узлу" style={field} value={to}
                onChange={(event) => setTo(event.target.value)} required>
                <option value="">Связанный узел</option>
                {activeNodes.map((node) => <option key={node.node_id} value={node.node_id}>
                  {nodeLabel({ id: node.node_id, version: node.node_version })}
                </option>)}
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
                  {version.revision !== selected.revision &&
                    <button style={button} disabled={busy}
                      onClick={() => void run(async () => {
                        if (!window.confirm(`Вернуть содержимое версии ${version.revision}? Текущая версия сохранится в истории.`)) return;
                        await request(`${graphUrl}/restore`, {
                          method: "POST",
                          body: JSON.stringify({
                            expected_revision: selected.revision,
                            from_revision: version.revision
                          })
                        });
                        await load(projectId, selected.graph_id);
                      })}>Восстановить</button>}
                </li>
              ))}
            </ul>
          </section>
          <section style={panel}>
            <h2>Объяснение графа</h2>
            <form onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                const result = await request<Explanation>(
                  `${graphUrl}/explain?q=${encodeURIComponent(query)}`
                );
                setExplanation(result);
              });
            }} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input style={{ ...field, flex: "1 1 240px" }}
                value={query} onChange={(event) => setQuery(event.target.value)}
                placeholder="Что искать в графе?" maxLength={500} required />
              <button type="submit" style={button} disabled={busy || !query.trim()}>
                Объяснить
              </button>
            </form>
            {explanation && <div aria-live="polite" style={{ marginTop: 16 }}>
              <strong>Оценка: {explanation.readiness}</strong>
              <p>{explanation.explanation}</p>
              {explanation.truncated && <p>Выборка ограничена. Показана только часть графа.</p>}
              <ul>
                {explanation.relationships.map((relation) => (
                  <li key={relation.edge_id}>
                    {relation.description} — {relation.status}. {relation.note}
                  </li>
                ))}
              </ul>
              {explanation.relationships.length === 0 &&
                <p>Релевантных связей для этого запроса не найдено.</p>}
            </div>}
          </section>
        </div>
      )}
    </main>
  );
}
