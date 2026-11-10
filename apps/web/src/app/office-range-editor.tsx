"use client";
import { useState } from "react";
import type { OfficeOperation } from "@cosmora/contracts";
import { officeRangeOperation, parseOfficeRange, rangeTypes, type RangeType } from "./office-range";

const labels: Record<RangeType, string> = {
  string: "Текст — сохраняет ведущие нули",
  number: "Число",
  boolean: "Логическое (true/false)",
  formula: "Формула без вычисления",
  null: "Очистить ячейки столбца"
};
export function OfficeRangeEditor({
  target,
  onAdd
}: {
  target: string;
  onAdd: (op: OfficeOperation) => void;
}) {
  const [source, setSource] = useState("");
  const [start, setStart] = useState("A1");
  const [rows, setRows] = useState<string[][] | null>(null);
  const [types, setTypes] = useState<RangeType[]>([]);
  const [error, setError] = useState("");
  return (
    <details>
      <summary>Диапазон ячеек XLSX</summary>
      <fieldset style={{ minWidth: 0 }}>
        <legend>Диапазон XLSX</legend>
        <p>
          Вставьте таблицу из Excel: столбцы разделены табуляцией, строки — переносом. До 10 × 10
          ячеек, первая строка тоже данные. По умолчанию всё сохраняется текстом, включая ведущие
          нули и строки с «=».
        </p>
        <label>
          Начальная ячейка диапазона{" "}
          <input value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label>
          Таблица диапазона{" "}
          <textarea
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
              setRows(null);
              setTypes([]);
              setError("");
            }}
          />
        </label>
        <button
          type="button"
          onClick={() => {
            try {
              const parsed = parseOfficeRange(source);
              setRows(parsed);
              setTypes(parsed[0]!.map(() => "string"));
              setError("");
            } catch (error) {
              setRows(null);
              setTypes([]);
              setError(error instanceof Error ? error.message : "Таблица не разобрана");
            }
          }}
        >
          Разобрать таблицу
        </button>
        {rows && (
          <>
            <div
              role="region"
              aria-label="Прокрутка диапазона"
              tabIndex={0}
              style={{ overflowX: "auto" }}
            >
              <table aria-label="Данные диапазона">
                <thead>
                  <tr>
                    {types.map((type, column) => (
                      <th key={column} scope="col">
                        <label>
                          Тип столбца {column + 1}{" "}
                          <select
                            aria-label={`Тип столбца ${column + 1}`}
                            value={type}
                            onChange={(e) => {
                              setTypes(
                                types.map((t, i) =>
                                  i === column ? (e.target.value as RangeType) : t
                                )
                              );
                              setError("");
                            }}
                          >
                            {rangeTypes.map((t) => (
                              <option key={t} value={t}>
                                {labels[t]}
                              </option>
                            ))}
                          </select>
                        </label>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, r) => (
                    <tr key={r}>
                      {row.map((cell, c) => (
                        <td key={c}>
                          <span style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                            {cell}
                          </span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              Тип выбирается для всего столбца. Формулы проверяются при preview и здесь не
              вычисляются. «Очистить» удаляет значения выбранного столбца после подтверждения.
              Вставляются значения из буфера, оформление не переносится. Для исключения в отдельной
              ячейке используйте правку ячейки после диапазона в том же плане. Для чисел
              поддерживается до 15 значащих цифр; длинные реквизиты сохраняйте текстом.
            </p>
            <button
              type="button"
              onClick={() => {
                try {
                  const operation = officeRangeOperation(target, start, rows, types);
                  setError("");
                  onAdd(operation);
                } catch (error) {
                  setError(error instanceof Error ? error.message : "Диапазон отклонён");
                }
              }}
            >
              Добавить диапазон в план
            </button>
          </>
        )}
        {error && <p role="alert">{error}</p>}
      </fieldset>
    </details>
  );
}
