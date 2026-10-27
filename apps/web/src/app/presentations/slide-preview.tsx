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
      <small>{number}</small>
    </div>
  );
}
