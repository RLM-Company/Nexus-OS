"use client";
import { useState } from "react";
import type { OfficeOperation } from "@cosmora/contracts";
import { officeCellValue, rangeTypes } from "./office-range";
import { officeCellDraft, editedOfficeRange, type OfficeCellDraft } from "./office-plan";
const typeLabels = {
  string: "Текст",
  number: "Число",
  boolean: "true/false",
  formula: "Формула без вычисления",
  null: "Очистить"
};
function description(op: OfficeOperation) {
  if (op.kind === "replace_text") return `${op.target}: «${op.find}» → «${op.replace}»`;
  if (op.kind === "add_sheet") return `Добавить лист «${op.name}»`;
  if (op.kind === "set_range")
    return `${op.target}: диапазон ${op.start}, ${op.rows.length} × ${op.rows[0]?.length ?? 0}`;
  const cell = officeCellDraft(op.value);
  return `${op.target}/${op.address}: ${typeLabels[cell.type]} ${cell.text}`;
}
function CellEditor({
  cell,
  label,
  onChange
}: {
  cell: OfficeCellDraft;
  label: string;
  onChange: (value: OfficeCellDraft) => void;
}) {
  return (
    <>
      <label>
        Тип {label}{" "}
        <select
          aria-label={`Тип ${label}`}
          value={cell.type}
          onChange={(e) => onChange({ ...cell, type: e.target.value as OfficeCellDraft["type"] })}
        >
          {rangeTypes.map((type) => (
            <option key={type} value={type}>
              {typeLabels[type]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Значение {label}{" "}
        <textarea
          aria-label={`Значение ${label}`}
          value={cell.text}
          disabled={cell.type === "null"}
          onChange={(e) => onChange({ ...cell, text: e.target.value })}
        />
      </label>
    </>
  );
}
function OperationEditor({
  operation,
  onSave,
  onCancel
}: {
  operation: OfficeOperation;
  onSave: (op: OfficeOperation) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(() => structuredClone(operation));
  const [cells, setCells] = useState<OfficeCellDraft[][]>(() =>
    operation.kind === "set_range"
      ? operation.rows.map((row) => row.map(officeCellDraft))
      : operation.kind === "set_cell"
        ? [[officeCellDraft(operation.value)]]
        : []
  );
  const [error, setError] = useState("");
  return (
    <fieldset style={{ minWidth: 0 }}>
      <legend>Редактирование правки</legend>
      {draft.kind === "add_sheet" ? (
        <label>
          Название листа правки{" "}
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
      ) : (
        <label>
          Адрес объекта правки{" "}
          <input
            value={draft.target}
            onChange={(e) => setDraft({ ...draft, target: e.target.value })}
          />
        </label>
      )}
      {draft.kind === "replace_text" && (
        <>
          <label>
            Искомый текст правки{" "}
            <textarea
              aria-label="Искомый текст правки"
              value={draft.find}
              onChange={(e) => setDraft({ ...draft, find: e.target.value })}
            />
          </label>
          <label>
            Новый текст правки{" "}
            <textarea
              aria-label="Новый текст правки"
              value={draft.replace}
              onChange={(e) => setDraft({ ...draft, replace: e.target.value })}
            />
          </label>
        </>
      )}
      {draft.kind === "set_cell" && (
        <>
          <label>
            Адрес ячейки правки{" "}
            <input
              value={draft.address}
              onChange={(e) => setDraft({ ...draft, address: e.target.value })}
            />
          </label>
          <CellEditor cell={cells[0]![0]!} label="ячейки" onChange={(cell) => setCells([[cell]])} />
        </>
      )}
      {draft.kind === "set_range" && (
        <>
          <label>
            Начальная ячейка правки{" "}
            <input
              value={draft.start}
              onChange={(e) => setDraft({ ...draft, start: e.target.value })}
            />
          </label>
          <p>
            Тип и значение редактируются для каждой ячейки отдельно. Размер диапазона сохраняется.
            Для другого размера удалите эту правку и добавьте новый диапазон; остальные правки
            останутся.
          </p>
          <div
            role="region"
            aria-label="Ячейки правки диапазона"
            tabIndex={0}
            style={{ overflowX: "auto" }}
          >
            <table>
              <tbody>
                {cells.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, c) => (
                      <td key={c}>
                        <CellEditor
                          cell={cell}
                          label={`ячейки ${r + 1}:${c + 1}`}
                          onChange={(next) =>
                            setCells(
                              cells.map((oldRow, ri) =>
                                oldRow.map((oldCell, ci) => (ri === r && ci === c ? next : oldCell))
                              )
                            )
                          }
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <button
        type="button"
        onClick={() => {
          try {
            const replacement =
              draft.kind === "set_range"
                ? editedOfficeRange(draft.target, draft.start, cells)
                : draft.kind === "set_cell"
                  ? { ...draft, value: officeCellValue(cells[0]![0]!.text, cells[0]![0]!.type) }
                  : draft;
            setError("");
            onSave(replacement);
          } catch (error) {
            setError(error instanceof Error ? error.message : "Правка отклонена");
          }
        }}
      >
        Сохранить правку в плане
      </button>
      <button type="button" onClick={onCancel}>
        Отменить редактирование правки
      </button>
      {error && <p role="alert">{error}</p>}
    </fieldset>
  );
}
export function OfficePlanEditor({
  operations,
  editingIndex,
  onStart,
  onSave,
  onRemove,
  onCancel
}: {
  operations: OfficeOperation[];
  editingIndex: number | null;
  onStart: (index: number) => void;
  onSave: (index: number, replacement: OfficeOperation) => void;
  onRemove: (index: number) => void;
  onCancel: () => void;
}) {
  return (
    <>
      <ol aria-label="План правок">
        {operations.map((op, i) => (
          <li key={i}>
            <span>{description(op)}</span>{" "}
            <button
              type="button"
              disabled={editingIndex !== null}
              aria-label={`Изменить правку ${i + 1}`}
              onClick={() => onStart(i)}
            >
              Изменить
            </button>{" "}
            <button
              type="button"
              disabled={editingIndex !== null}
              aria-label={`Удалить правку ${i + 1}`}
              onClick={() => onRemove(i)}
            >
              Удалить
            </button>
          </li>
        ))}
      </ol>
      {editingIndex !== null && operations[editingIndex] && (
        <OperationEditor
          key={editingIndex}
          operation={operations[editingIndex]}
          onSave={(op) => onSave(editingIndex, op)}
          onCancel={onCancel}
        />
      )}
    </>
  );
}
