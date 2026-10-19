"use client";
import { useState } from "react";
import type { GraphConflict, GraphForComparison } from "./revision-diff";

type Ref = { id: string; version: number };
const key = (r: Ref) => `${r.id}@${r.version}`;
const live = (status: string) => !["deleted", "superseded"].includes(status);
const control = {
  border: "1px solid #aaa",
  borderRadius: 7,
  padding: 9,
  font: "inherit",
  background: "#fff",
  color: "#111"
};

export function GraphConflictEditor({
  graph,
  busy,
  onEdit
}: {
  graph: GraphForComparison;
  busy: boolean;
  onEdit: (operation: object) => Promise<void>;
}) {
  const [editing, setEditing] = useState("");
  const [subject, setSubject] = useState("");
  const [positions, setPositions] = useState<string[]>([]);
  const [reviewed, setReviewed] = useState(false);
  const nodes = graph.nodes.filter((n) => live(n.verification_status));
  const refs = new Map(
    nodes.map((n) => [
      key({ id: n.node_id, version: n.node_version }),
      { id: n.node_id, version: n.node_version }
    ])
  );
  const record = (r: Ref) => graph.records.find((t) => key(t.node) === key(r));
  const label = (r: Ref) => `${record(r)?.text ?? r.id} · v${r.version}`;
  const active = (r: Ref) => refs.has(key(r));
  const detail = (r: Ref) => (
    <div key={key(r)} style={{ padding: 8, borderLeft: "2px solid #bbb", marginBlock: 6 }}>
      <strong>{label(r)}</strong>
      <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
        {record(r)?.excerpt ?? "Текст недоступен"}
      </p>
      {!active(r) && <p>Сохранённая версия изменена или удалена. Требуется пересмотр.</p>}
    </div>
  );
  const beginRevision = (c: GraphConflict) => {
    setEditing(c.conflict_id);
    setSubject(active(c.subject_ref) ? key(c.subject_ref) : "");
    setPositions(c.position_refs.filter(active).map(key));
    setReviewed(false);
  };
  return (
    <section
      aria-label="Разбор противоречий"
      style={{ border: "1px solid #ccc", borderRadius: 8, padding: 14, marginBlock: 14 }}
    >
      <h3>Разбор противоречий</h3>
      <p>
        Сопоставьте утверждения по одной теме и зафиксируйте решение отдельным узлом «Решение».
        Статус разбора не подтверждает достоверность утверждений.
      </p>
      {(graph.conflicts ?? []).length === 0 && <p>Противоречия пока не добавлены.</p>}
      {(graph.conflicts ?? []).map((c) => (
        <ConflictCard
          key={c.conflict_id}
          conflict={c}
          graph={graph}
          busy={busy}
          detail={detail}
          label={label}
          active={active}
          onRevise={() => beginRevision(c)}
          onEdit={onEdit}
        />
      ))}
      <form
        style={{ display: "grid", gap: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (
            !reviewed ||
            !refs.has(subject) ||
            positions.length < 2 ||
            positions.length > 20 ||
            positions.some((p) => !refs.has(p))
          )
            return;
          void onEdit({
            kind: editing ? "revise_conflict" : "open_conflict",
            ...(editing ? { conflict_id: editing } : {}),
            subject: refs.get(subject),
            positions: positions.map((p) => refs.get(p))
          });
        }}
      >
        <h4>{editing ? "Пересмотреть позиции" : "Новое противоречие"}</h4>
        <select
          aria-label="Тема противоречия"
          style={control}
          disabled={busy}
          value={subject}
          onChange={(e) => {
            setSubject(e.target.value);
            setReviewed(false);
          }}
          required
        >
          <option value="">Выберите тему</option>
          {nodes.map((n) => {
            const r = { id: n.node_id, version: n.node_version };
            return (
              <option key={key(r)} value={key(r)}>
                {label(r)}
              </option>
            );
          })}
        </select>
        {refs.has(subject) && detail(refs.get(subject)!)}
        <fieldset disabled={busy}>
          <legend>Позиции — от 2 до 20 утверждений</legend>
          {nodes
            .filter((n) => n.kind === "Claim")
            .map((n) => {
              const r = { id: n.node_id, version: n.node_version };
              return (
                <label key={key(r)} style={{ display: "block", marginBlock: 6 }}>
                  <input
                    type="checkbox"
                    checked={positions.includes(key(r))}
                    disabled={!positions.includes(key(r)) && positions.length >= 20}
                    onChange={(e) => {
                      setPositions(
                        e.target.checked
                          ? [...positions, key(r)]
                          : positions.filter((p) => p !== key(r))
                      );
                      setReviewed(false);
                    }}
                  />{" "}
                  {label(r)}
                </label>
              );
            })}
        </fieldset>
        {positions
          .map((p) => refs.get(p))
          .filter((r): r is Ref => !!r)
          .map(detail)}
        <label>
          <input
            type="checkbox"
            disabled={busy}
            checked={reviewed}
            onChange={(e) => setReviewed(e.target.checked)}
          />{" "}
          Тема и точные версии позиций просмотрены
        </label>
        <button
          style={control}
          disabled={busy || !reviewed || !subject || positions.length < 2}
          type="submit"
        >
          {editing ? "Сохранить пересмотр" : "Открыть противоречие"}
        </button>
        {editing && (
          <button
            style={control}
            type="button"
            disabled={busy}
            onClick={() => {
              setEditing("");
              setSubject("");
              setPositions([]);
              setReviewed(false);
            }}
          >
            Отменить пересмотр
          </button>
        )}
      </form>
    </section>
  );
}

function ConflictCard({
  conflict: c,
  graph,
  busy,
  detail,
  label,
  active,
  onRevise,
  onEdit
}: {
  conflict: GraphConflict;
  graph: GraphForComparison;
  busy: boolean;
  detail: (r: Ref) => React.ReactNode;
  label: (r: Ref) => string;
  active: (r: Ref) => boolean;
  onRevise: () => void;
  onEdit: (o: object) => Promise<void>;
}) {
  const [resolution, setResolution] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const decisions = graph.nodes.filter(
    (n) =>
      n.kind === "Decision" &&
      live(n.verification_status) &&
      "created_at" in n &&
      typeof n.created_at === "string" &&
      Date.parse(n.created_at) >= Date.parse(c.created_at)
  );
  const decision = decisions.find(
    (n) => key({ id: n.node_id, version: n.node_version }) === resolution
  );
  const stale = !active(c.subject_ref) || c.position_refs.some((p) => !active(p));
  return (
    <article style={{ borderBottom: "1px solid #ccc", paddingBlock: 12 }}>
      <h4>
        {label(c.subject_ref)} — {c.status === "open" ? "Открыто" : "Решение записано"}
      </h4>
      {detail(c.subject_ref)}
      {c.position_refs.map(detail)}
      {stale && (
        <p>Тема или позиции изменились. Пересмотрите точные версии перед записью решения.</p>
      )}
      {c.resolution_ref && (
        <div>
          <strong>Решение владельца</strong>
          {detail(c.resolution_ref)}
        </div>
      )}
      {c.status === "resolved" ? (
        <button
          style={control}
          disabled={busy}
          type="button"
          onClick={() => void onEdit({ kind: "reopen_conflict", conflict_id: c.conflict_id })}
        >
          Вернуть на разбор
        </button>
      ) : (
        <>
          <button style={control} disabled={busy} type="button" onClick={onRevise}>
            Пересмотреть позиции
          </button>
          <form
            style={{ display: "grid", gap: 8, marginBlock: 12 }}
            onSubmit={(e) => {
              e.preventDefault();
              if (!decision || !reviewed || stale) return;
              void onEdit({
                kind: "resolve_conflict",
                conflict_id: c.conflict_id,
                resolution: { id: decision.node_id, version: decision.node_version }
              });
            }}
          >
            <select
              style={control}
              aria-label={`Решение для ${label(c.subject_ref)}`}
              disabled={busy || stale}
              value={resolution}
              onChange={(e) => {
                setResolution(e.target.value);
                setReviewed(false);
              }}
              required
            >
              <option value="">Выберите решение, созданное после открытия разбора</option>
              {decisions.map((n) => {
                const r = { id: n.node_id, version: n.node_version };
                return (
                  <option key={key(r)} value={key(r)}>
                    {label(r)}
                  </option>
                );
              })}
            </select>
            {decisions.length === 0 && (
              <p>Добавьте узел типа «Решение» после открытия этого разбора.</p>
            )}
            {decision && detail({ id: decision.node_id, version: decision.node_version })}
            <label>
              <input
                type="checkbox"
                disabled={busy || stale}
                checked={reviewed}
                onChange={(e) => setReviewed(e.target.checked)}
              />{" "}
              Позиции и текст решения просмотрены
            </label>
            <button
              style={control}
              disabled={busy || stale || !decision || !reviewed}
              type="submit"
            >
              Записать решение
            </button>
          </form>
        </>
      )}
    </article>
  );
}
