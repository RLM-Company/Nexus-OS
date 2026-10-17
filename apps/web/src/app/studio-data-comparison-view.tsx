import type { CanvasRevision } from "@cosmora/contracts/canvas-artifacts";
import type { DataComparison } from "./studio-data-comparison";
import styles from "./studio-data-workbench.module.css";

const literal = (value: string) =>
  value.length > 512
    ? JSON.stringify(value.slice(0, 512)) + " … [значение сокращено]"
    : JSON.stringify(value);

export function StudioDataComparison({
  before,
  after,
  comparison: d
}: {
  before: CanvasRevision;
  after: CanvasRevision;
  comparison: DataComparison;
}) {
  return (
    <section className={styles.historyComparison} aria-label="Сравнение версий таблицы">
      <h4>
        Серверная v{before.version} → выбранная v{after.version}
      </h4>
      <p>
        {before.title} → {after.title}
      </p>
      <p>
        Строки: {d.before.rows} → {d.after.rows}; столбцы: {d.before.columns} → {d.after.columns}.
      </p>
      <p>
        Название файла: {d.nameChanged ? "изменено" : "совпадает"}; разделитель:{" "}
        {d.delimiterChanged ? "изменён" : "совпадает"}; настройки анализа:{" "}
        {d.settingsChanged ? "изменены" : "совпадают"}.
      </p>
      <p>
        Строки и столбцы сравниваются по исходным позициям, начиная с 1. Перестановка строк
        считается изменением ячеек; идентификаторы строк не угадываются.
      </p>
      <p>
        SHA-256 v{before.version}: <code className={styles.historyHash}>{before.sha256}</code>
        <br />
        SHA-256 v{after.version}: <code className={styles.historyHash}>{after.sha256}</code>
      </p>
      {d.complete ? (
        <>
          <p>
            Изменено ячеек: {d.changedCells}; заголовков: {d.changedHeaders}. Добавлено строк:{" "}
            {d.addedRows}; удалено строк: {d.removedRows}. Добавлено столбцов: {d.addedColumns};
            удалено столбцов: {d.removedColumns}.
          </p>
          {!!d.samples.length && (
            <div
              className={styles.tableWrap}
              tabIndex={0}
              role="region"
              aria-label="Изменения ячеек таблицы"
            >
              <table>
                <thead>
                  <tr>
                    <th>Позиция</th>
                    <th>Сейчас на сервере</th>
                    <th>В выбранной версии</th>
                  </tr>
                </thead>
                <tbody>
                  {d.samples.map((change) => (
                    <tr key={`${change.kind}:${change.row}:${change.column}`}>
                      <th scope="row">
                        {change.kind === "header" ? "Заголовок" : `Строка ${change.row}`}, столбец{" "}
                        {change.column}
                      </th>
                      <td>
                        <pre>{literal(change.before)}</pre>
                      </td>
                      <td>
                        <pre>{literal(change.after)}</pre>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p>
            Показаны первые 100 изменений общих ячеек и заголовков; ещё не показано:{" "}
            {d.samplesOmitted}. Добавленные и удалённые строки/столбцы учтены отдельно. Длинные
            значения в списке сокращены до 512 символов; переводы строк показаны как в JSON. Полные
            данные доступны в скачанных снимках.
          </p>
        </>
      ) : (
        <p role="status">
          Таблица превышает лимит сравнения 100 000 общих ячеек. Подсчёт изменений не выполнялся.
          Скачайте обе версии и проверьте их перед восстановлением.
        </p>
      )}
    </section>
  );
}
