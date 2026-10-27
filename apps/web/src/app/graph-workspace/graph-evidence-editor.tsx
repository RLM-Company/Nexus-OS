"use client";
import { useState } from "react";
import type { GraphForComparison } from "./revision-diff";
import { resolveGraphQuote } from "./graph-quote";

const control = {
  border: "1px solid #aaa",
  borderRadius: 7,
  padding: 9,
  font: "inherit",
  background: "#fff",
  color: "#111"
};
const live = (status: string) => !["deleted", "superseded"].includes(status);
export function GraphEvidenceEditor({
  graph,
  busy,
  onEdit
}: {
  graph: GraphForComparison;
  busy: boolean;
  onEdit: (operation: object) => Promise<void>;
}) {
  const [edgeId, setEdgeId] = useState(""),
    [sourceId, setSourceId] = useState(""),
    [location, setLocation] = useState(""),
    [excerpt, setExcerpt] = useState(""),
    [reviewed, setReviewed] = useState(false);
  const edges = graph.edges.filter((e) => live(e.verification_status));
  const sources = graph.nodes.filter(
    (n) => live(n.verification_status) && ["Source", "Document"].includes(n.kind)
  );
  const source = sources.find((n) => n.node_id === sourceId);
  const record = (id: string, version: number) =>
    graph.records.find((r) => r.node.id === id && r.node.version === version);
  const sourceText = source ? (record(source.node_id, source.node_version)?.excerpt ?? "") : "";
  const label = (ref: { id: string; version: number }) =>
    record(ref.id, ref.version)?.text ?? ref.id;
  const quote = resolveGraphQuote(sourceText, excerpt);
  const valid =
    !!edgeId &&
    !!source &&
    !!location.trim() &&
    !!excerpt.trim() &&
    excerpt.length <= 1000 &&
    quote !== null;
  return (
    <section
      aria-label="Источники связей"
      style={{ border: "1px solid #ccc", borderRadius: 8, padding: 14, marginBlock: 14 }}
    >
      <h3>Цитаты и источники</h3>
      <p>
        Цитата должна точно совпадать с фрагментом сохранённого источника. Она фиксирует основание
        ручной связи и не делает её проверенной.
      </p>
      <ul>
        {edges
          .filter((e) => e.evidence_excerpt !== undefined)
          .map((edge) => {
            const ref = edge.evidence_ref;
            const sourceNode = ref
              ? graph.nodes.find(
                  (n) => n.node_id === ref.source_id && n.node_version === ref.source_version
                )
              : null;
            return (
              <li key={edge.edge_id}>
                <strong>
                  {label(edge.from)} → {edge.type} → {label(edge.to)}
                </strong>
                <p>
                  {ref
                    ? label({ id: ref.source_id, version: ref.source_version })
                    : "Источник не найден"}{" "}
                  · v{ref?.source_version} · {ref?.location}
                </p>
                <blockquote style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                  {edge.evidence_excerpt}
                </blockquote>
                {sourceNode?.verification_status === "superseded" && (
                  <p>
                    Источник обновлён: цитата относится к прежней сохранённой версии. Перепроверьте
                    её перед заменой.
                  </p>
                )}
                <button
                  type="button"
                  style={control}
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm("Снять текущую цитату? Предыдущая версия останется в истории.")
                    )
                      void onEdit({ kind: "clear_edge_evidence", edge_id: edge.edge_id });
                  }}
                >
                  Снять цитату
                </button>
              </li>
            );
          })}
      </ul>
      <form
        style={{ display: "grid", gap: 8 }}
        onSubmit={(event) => {
          event.preventDefault();
          if (!source || !valid || !reviewed) return;
          void onEdit({
            kind: "cite_edge",
            edge_id: edgeId,
            source: { id: source.node_id, version: source.node_version },
            location,
            excerpt: quote
          });
        }}
      >
        <select
          aria-label="Связь для цитаты"
          style={control}
          value={edgeId}
          disabled={busy}
          onChange={(event) => {
            setEdgeId(event.target.value);
            setReviewed(false);
          }}
          required
        >
          <option value="">Выберите связь</option>
          {edges.map((e) => (
            <option value={e.edge_id} key={e.edge_id}>
              {label(e.from)} → {e.type} → {label(e.to)}
            </option>
          ))}
        </select>
        <select
          aria-label="Источник цитаты"
          style={control}
          value={sourceId}
          disabled={busy}
          onChange={(event) => {
            setSourceId(event.target.value);
            setReviewed(false);
          }}
          required
        >
          <option value="">Выберите Source или Document</option>
          {sources.map((n) => (
            <option value={n.node_id} key={n.node_id}>
              {label({ id: n.node_id, version: n.node_version })} · v{n.node_version}
            </option>
          ))}
        </select>
        {source && (
          <div>
            <strong>Текст выбранного источника</strong>
            <pre style={{ whiteSpace: "pre-wrap", maxHeight: 230, overflow: "auto" }}>
              {sourceText}
            </pre>
          </div>
        )}
        <input
          aria-label="Место в источнике"
          placeholder="Страница, строки или адрес источника"
          style={control}
          maxLength={256}
          value={location}
          disabled={busy}
          onChange={(event) => {
            setLocation(event.target.value);
            setReviewed(false);
          }}
          required
        />
        <textarea
          aria-label="Точная цитата"
          placeholder="Скопируйте точный фрагмент сохранённого текста"
          style={control}
          maxLength={1000}
          rows={3}
          value={excerpt}
          disabled={busy}
          onChange={(event) => {
            setExcerpt(event.target.value);
            setReviewed(false);
          }}
          required
        />
        {!!excerpt && !!source && quote === null && (
          <p role="alert">
            Цитата не найдена в выбранной версии источника. Проверьте символы и переносы строк.
          </p>
        )}
        <label>
          <input
            type="checkbox"
            checked={reviewed}
            disabled={busy || !valid}
            onChange={(event) => setReviewed(event.target.checked)}
          />{" "}
          Источник, место и цитата просмотрены
        </label>
        <button type="submit" style={control} disabled={busy || !valid || !reviewed}>
          Прикрепить цитату новой версией
        </button>
        {sources.length === 0 && (
          <p>Сначала добавьте узел Source или Document с текстом источника.</p>
        )}
      </form>
    </section>
  );
}
