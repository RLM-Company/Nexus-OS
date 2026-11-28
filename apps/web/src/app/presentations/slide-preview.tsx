import type { Slide, Theme } from "./model";
import styles from "./presentations.module.css";

export function SlidePreview({
  slide,
  theme,
  number
}: {
  slide: Slide;
  theme: Theme;
  number: number;
}) {
  return (
    <div className={`${styles.slide} ${styles[theme]} ${styles[slide.layout]}`}>
      <span className={styles.slideAccent} />
      <h2>{slide.title || "Заголовок"}</h2>
      <div className={styles.slideColumns}>
        <p>{slide.body || "Текст слайда"}</p>
        {slide.layout === "two-column" && <p>{slide.aside || "Вторая колонка"}</p>}
      </div>
      {slide.visual?.kind === "image" && (
        <img
          className={styles.slideVisual}
          alt={slide.visual.alt}
          src={`data:${slide.visual.mime};base64,${slide.visual.data_base64}`}
        />
      )}
      {slide.visual?.kind === "table" && (
        <div className={styles.slideVisual}>
          <table className={styles.visualTable} aria-label="Таблица на слайде">
            <tbody>
              {slide.visual.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) =>
                    i === 0 ? (
                      <th key={j} scope="col">
                        {cell}
                      </th>
                    ) : (
                      <td key={j}>{cell}</td>
                    )
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <small>{number}</small>
    </div>
  );
}
