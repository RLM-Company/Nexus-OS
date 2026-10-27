import type { ContextChange } from "./context-comparison";

const labels = { metadata: "Снимок", node: "Запись", edge: "Связь", conflict: "Противоречие" };
export function ContextComparisonView({
  changes,
  savedRevision,
  proposedRevision
}: {
  changes: ContextChange[];
  savedRevision: number;
  proposedRevision: number;
}) {
  const added = changes.filter((c) => c.before === null).length;
  const removed = changes.filter((c) => c.after === null).length;
  return (
    <section aria-label="Сравнение контекста" style={{ marginBlock: 16, overflowWrap: "anywhere" }}>
      <h3>
        Сохранено: v{savedRevision} → просмотрено: v{proposedRevision}
      </h3>
      {changes.length === 0 ? (
        <p>Изменений в содержимом снимка нет.</p>
      ) : (
        <p>
          Добавлено: {added}. Убрано: {removed}. Изменено: {changes.length - added - removed}.
          Ссылки на разные версии записей сравниваются отдельно.
        </p>
      )}
      <p>
        Сравнение ничего не сохраняет. Изменение статуса или связи не доказывает истинность
        утверждения.
      </p>
      {changes.map((change) => (
        <details key={`${change.kind}:${change.label}`} style={{ marginBlock: 8 }}>
          <summary>
            {labels[change.kind]} · {change.label} ·{" "}
            {change.before === null ? "добавлено" : change.after === null ? "убрано" : "изменено"}
          </summary>
          {(
            [
              ["Сохранено", change.before],
              ["Просмотрено", change.after]
            ] as const
          ).map(([title, content]) => (
            <div key={title}>
              <strong>{title}</strong>
              {content === null ? (
                <p>Отсутствует в этом снимке.</p>
              ) : (
                <pre
                  style={{
                    whiteSpace: "pre-wrap",
                    maxHeight: 260,
                    overflow: "auto",
                    background: "#f5f5f5",
                    padding: 10
                  }}
                >
                  {content}
                </pre>
              )}
            </div>
          ))}
        </details>
      ))}
    </section>
  );
}
