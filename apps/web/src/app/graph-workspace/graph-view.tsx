"use client";
import { useId, useState } from "react";
import type { GraphForComparison } from "./revision-diff";
import { layoutGraph, findGraphNavigationPath, inspectGraphStructure } from "./graph-layout";

const control = {
  border: "1px solid #999",
  borderRadius: 6,
  background: "#fff",
  color: "#111",
  padding: "7px 10px",
  font: "inherit"
};
export function IntelligenceGraphView({ graph }: { graph: GraphForComparison }) {
  const [focus, setFocus] = useState<string | null>(null);
  const [neighboursOnly, setNeighboursOnly] = useState(false);
  const [targetId, setTargetId] = useState("");
  const [direction, setDirection] = useState<"outgoing" | "either">("outgoing");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const arrow = useId().replaceAll(":", "");
  const model = layoutGraph(graph, focus, neighboursOnly);
  const full = layoutGraph(graph, null, false);
  const diagnostics = inspectGraphStructure(graph);
  const path =
    focus && targetId ? findGraphNavigationPath(graph, focus, targetId, direction) : null;
  const pathEdges = new Set(path?.steps.map((s) => s.edge.edge_id) ?? []);
  const choose = (id: string) => {
    setFocus(id);
    setTargetId("");
    setPan({ x: 0, y: 0 });
  };
  const positions = new Map(model.nodes.map((n) => [n.node_id, n]));
  const selected = model.nodes.find((n) => n.node_id === focus);
  const incident = model.edges.filter((e) => e.from.id === focus || e.to.id === focus);
  const move = (x: number, y: number) =>
    setPan((p) => ({
      x: Math.max(-1000, Math.min(1000, p.x + x / zoom)),
      y: Math.max(-680, Math.min(680, p.y + y / zoom))
    }));
  return (
    <section aria-label="Визуальный граф знаний">
      <h3>Карта связей</h3>
      <p>
        Выберите узел, чтобы увидеть его текст и связи. Стрелка показывает направление записанного
        отношения; расположение узлов не оценивает достоверность.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button
          type="button"
          style={control}
          aria-label="Увеличить граф"
          disabled={zoom >= 4}
          onClick={() => setZoom((z) => Math.min(4, z + 0.25))}
        >
          +
        </button>
        <button
          type="button"
          style={control}
          aria-label="Уменьшить граф"
          disabled={zoom <= 0.5}
          onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
        >
          −
        </button>
        <span aria-live="polite">{Math.round(zoom * 100)}%</span>
        <button
          type="button"
          style={control}
          aria-label="Сдвинуть граф влево"
          onClick={() => move(-100, 0)}
        >
          ←
        </button>
        <button
          type="button"
          style={control}
          aria-label="Сдвинуть граф вправо"
          onClick={() => move(100, 0)}
        >
          →
        </button>
        <button
          type="button"
          style={control}
          aria-label="Сдвинуть граф вверх"
          onClick={() => move(0, -80)}
        >
          ↑
        </button>
        <button
          type="button"
          style={control}
          aria-label="Сдвинуть граф вниз"
          onClick={() => move(0, 80)}
        >
          ↓
        </button>
        <button
          type="button"
          style={control}
          onClick={() => {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          }}
        >
          Показать целиком
        </button>
        <label>
          <input
            type="checkbox"
            disabled={!focus || !!targetId}
            checked={neighboursOnly}
            onChange={(e) => setNeighboursOnly(e.target.checked)}
          />{" "}
          Только выбранный узел и соседи
        </label>
      </div>
      <svg
        role="group"
        aria-label="Узлы и направленные связи"
        viewBox={`${500 - 500 / zoom + pan.x} ${340 - 340 / zoom + pan.y} ${1000 / zoom} ${680 / zoom}`}
        style={{
          width: "100%",
          height: "min(65vh, 540px)",
          minHeight: 260,
          border: "1px solid #ccc",
          background: "#fafafa",
          marginTop: 12
        }}
      >
        <defs>
          <marker
            id={arrow}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
          </marker>
        </defs>
        {model.edges.map((edge) => {
          const from = positions.get(edge.from.id)!,
            to = positions.get(edge.to.id)!;
          const dx = to.x - from.x,
            dy = to.y - from.y,
            length = Math.hypot(dx, dy) || 1;
          const relevant = path
            ? pathEdges.has(edge.edge_id)
            : !focus || edge.from.id === focus || edge.to.id === focus;
          return (
            <line
              key={`${edge.edge_id}@${edge.edge_version}`}
              x1={from.x + (dx / length) * 17}
              y1={from.y + (dy / length) * 17}
              x2={to.x - (dx / length) * 20}
              y2={to.y - (dy / length) * 20}
              stroke={relevant ? "#333" : "#bbb"}
              strokeWidth={pathEdges.has(edge.edge_id) ? 4 : relevant ? 2 : 1}
              markerEnd={`url(#${arrow})`}
              style={{ color: relevant ? "#333" : "#bbb" }}
            >
              <title>
                {from.label} → {edge.type} → {to.label} · {edge.verification_status}
              </title>
            </line>
          );
        })}
        {model.nodes.map((node) => (
          <g
            key={node.node_id}
            role="button"
            tabIndex={0}
            aria-label={`Выбрать узел: ${node.label}`}
            aria-pressed={node.node_id === focus}
            onClick={() => {
              choose(node.node_id);
            }}
            onKeyDown={(event) => {
              if (["Enter", " "].includes(event.key)) {
                event.preventDefault();
                choose(node.node_id);
              }
            }}
            style={{ cursor: "pointer" }}
          >
            <title>
              {node.label} · {node.kind} · {node.verification_status}
            </title>
            <circle
              cx={node.x}
              cy={node.y}
              r={node.node_id === focus ? 18 : 13}
              fill={node.node_id === focus ? "#111" : "#fff"}
              stroke="#222"
              strokeWidth={2}
              strokeDasharray={node.verification_status === "verified" ? undefined : "4 2"}
            />
            {(model.nodes.length <= 24 || node.node_id === focus) && (
              <text
                x={node.x}
                y={node.y + 34}
                textAnchor="middle"
                fontSize="15"
                fill="#111"
                stroke="#fafafa"
                strokeWidth="4"
                paintOrder="stroke"
              >
                {node.label.length > 32 ? node.label.slice(0, 31) + "…" : node.label}
              </text>
            )}
          </g>
        ))}
      </svg>
      <p>
        Пунктир — непроверенная запись. Узлов показано: {model.nodes.length}; связей:{" "}
        {model.edges.length}.{model.omitted > 0 ? ` Скрыто узлов: ${model.omitted}.` : ""}
      </p>
      {selected && (
        <aside aria-label="Выбранный узел">
          <h4>{selected.label}</h4>
          <p>
            {selected.kind} · {selected.verification_status} · v{selected.node_version}
          </p>
          <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{selected.detail}</p>
          <h4>Найти путь к другому узлу</h4>
          <label>
            Конечный узел{" "}
            <select
              aria-label="Конечный узел пути"
              value={targetId}
              onChange={(event) => {
                setTargetId(event.target.value);
                setNeighboursOnly(false);
              }}
            >
              <option value="">Выберите узел</option>
              {full.nodes
                .filter((n) => n.node_id !== focus)
                .map((n) => (
                  <option value={n.node_id} key={n.node_id}>
                    {n.label}
                  </option>
                ))}
            </select>
          </label>
          <select
            aria-label="Направление поиска пути"
            value={direction}
            onChange={(event) => setDirection(event.target.value as "outgoing" | "either")}
          >
            <option value="outgoing">По направлению стрелок</option>
            <option value="either">В обе стороны</option>
          </select>
          {targetId && (
            <div aria-live="polite">
              <p>
                Путь навигации до шести связей. Он не доказывает причинную или логическую связь
                между концами.
              </p>
              {path ? (
                <ol>
                  {path.steps.map((step) => (
                    <li key={step.edge.edge_id}>
                      {full.nodes.find((n) => n.node_id === step.edge.from.id)?.label} →{" "}
                      <strong>{step.edge.type}</strong> →{" "}
                      {full.nodes.find((n) => n.node_id === step.edge.to.id)?.label}
                      {step.backwards ? " · пройдено против стрелки" : " · пройдено по стрелке"}
                    </li>
                  ))}
                </ol>
              ) : (
                <p>Путь в выбранном направлении и пределах глубины не найден.</p>
              )}
            </div>
          )}
          <h4>Входящие и исходящие связи ({incident.length})</h4>
          <ul>
            {incident.map((e) => (
              <li key={e.edge_id}>
                {positions.get(e.from.id)?.label} → <strong>{e.type}</strong> →{" "}
                {positions.get(e.to.id)?.label} · {e.verification_status}
                <button
                  style={control}
                  type="button"
                  onClick={() => choose(e.from.id === focus ? e.to.id : e.from.id)}
                >
                  Перейти к соседу
                </button>
              </li>
            ))}
          </ul>
          {incident.length === 0 && <p>Действующих связей нет.</p>}
          <button
            type="button"
            style={control}
            onClick={() => {
              setFocus(null);
              setTargetId("");
              setNeighboursOnly(false);
            }}
          >
            Снять выбор узла
          </button>
        </aside>
      )}
      <details>
        <summary>Проверить структуру графа</summary>
        <p>
          Несвязанных групп: {diagnostics.components.length}. Изолированных узлов:{" "}
          {diagnostics.isolated.length}. Явных отношений CONTRADICTS:{" "}
          {diagnostics.contradictions.length}.
        </p>
        <p>Групп с циклическими зависимостями DEPENDS_ON: {diagnostics.dependencyCycles.length}.</p>
        {diagnostics.dependencyCycles.map((cycle, i) => (
          <p key={i}>
            Цикл:{" "}
            {cycle.map((id) => full.nodes.find((n) => n.node_id === id)?.label ?? id).join("; ")}
          </p>
        ))}
        <p>
          Тезисы без прямой связи с источником: {diagnostics.claimsWithoutSourceLinks.length}.
          Наличие связи с источником само по себе не подтверждает тезис.
        </p>
        <ul>
          {diagnostics.claimsWithoutSourceLinks.map((id) => (
            <li key={id}>
              <button type="button" style={control} onClick={() => choose(id)}>
                {full.nodes.find((n) => n.node_id === id)?.label ?? id}
              </button>
            </li>
          ))}
        </ul>
      </details>
      {model.nodes.length === 0 && <p>Нет действующих узлов для отображения.</p>}
    </section>
  );
}
