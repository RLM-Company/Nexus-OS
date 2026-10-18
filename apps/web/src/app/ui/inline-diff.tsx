import { diffRows } from "./inline-diff-model";
import styles from "./inline-diff.module.css";

export function InlineDiff({
  text,
  wrap = false,
  bare = false,
  label = "Изменения кода"
}: {
  text: string;
  wrap?: boolean;
  bare?: boolean;
  label?: string;
}) {
  const rich = text.length <= 300_000 && text.split("\n").length <= 4000;
  const rows = rich ? diffRows(text) : [];
  const added = rows.filter((row) => row.kind === "added").length;
  const removed = rows.filter((row) => row.kind === "removed").length;
  return (
    <div className={styles.diff} data-bare={bare || undefined} data-wrap={wrap || undefined}>
      {!bare && (
        <div className={styles.heading}>
          <span>{label}</span>
          {rich && (
            <span className={styles.counts} aria-label={`${added} добавлено, ${removed} удалено`}>
              +{added} <span>/</span> −{removed}
            </span>
          )}
        </div>
      )}
      {!text ? (
        <p className={styles.empty}>Нет выбранных изменений.</p>
      ) : (
        <pre className={styles.body} tabIndex={0} aria-label={label}>
          <code>
            {rich
              ? rows.map((row, index) => (
                  <span key={index} className={`${styles.row} ${styles[row.kind]}`}>
                    <span className={styles.number} aria-hidden="true">
                      {row.before ?? ""}
                    </span>
                    <span className={styles.number} aria-hidden="true">
                      {row.after ?? ""}
                    </span>
                    <span className={styles.text}>{row.text || "\u00a0"}</span>
                  </span>
                ))
              : text}
          </code>
        </pre>
      )}
    </div>
  );
}
