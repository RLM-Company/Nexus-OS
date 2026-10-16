"use client";
import { useEffect, useState } from "react";
import { api, endpoint } from "./client";
import type { DeckRevision, DeckRevisionSummary } from "./model";
import { SlidePreview } from "./slide-preview";
import styles from "./presentations.module.css";

const sources = {
  create: "Создана",
  save: "Сохранена",
  import: "Импортирована",
  restore: "Восстановлена",
  migration: "До включения истории"
};
export function PresentationHistory({
  id,
  version,
  busy,
  onRestore
}: {
  id: string;
  version: number;
  busy: boolean;
  onRestore: (version: number) => Promise<boolean>;
}) {
  const [opened, setOpened] = useState(false);
  const [items, setItems] = useState<DeckRevisionSummary[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [preview, setPreview] = useState<DeckRevision | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!opened) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api<{ items: DeckRevisionSummary[] }>(`${endpoint}/${id}/versions`, {
      signal: controller.signal
    })
      .then((result) => {
        if (!controller.signal.aborted) setItems(result.items);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(String(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [id, version, opened, refresh]);
  useEffect(() => {
    setPreview(null);
    if (selected === null || !opened) return;
    const controller = new AbortController();
    api<DeckRevision>(`${endpoint}/${id}/versions/${selected}`, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setPreview(result);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(String(cause));
      });
    return () => controller.abort();
  }, [id, selected, opened, refresh]);
  return (
    <div className={styles.history}>
      <button
        type="button"
        aria-expanded={opened}
        aria-controls="presentation-history"
        onClick={() => setOpened(!opened)}
      >
        История версий
      </button>
      {opened && (
        <section id="presentation-history" aria-label="История версий">
          <p>Последние 20 сохранений. Восстановление создаёт новую версию.</p>
          {loading && <p role="status">Загружаем историю…</p>}
          {error && (
            <p role="alert">
              {error}{" "}
              <button type="button" onClick={() => setRefresh((n) => n + 1)}>
                Повторить
              </button>
            </p>
          )}
          {!loading && !items.length && !error && <p>Сохранённых версий пока нет.</p>}
          <ol className={styles.versionList}>
            {items.map((item) => (
              <li key={item.version}>
                <div>
                  <strong>
                    Версия {item.version}
                    {item.version === version ? " · текущая" : ""}
                  </strong>
                  <span>
                    {sources[item.source]}
                    {item.source_version !== null ? ` из версии ${item.source_version}` : ""} ·{" "}
                    {item.slide_count} слайдов
                  </span>
                  <time dateTime={item.created_at}>
                    {new Date(item.created_at).toLocaleString("ru-RU")}
                  </time>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setError("");
                    setSelected(item.version);
                  }}
                >
                  Посмотреть версию {item.version}
                </button>
              </li>
            ))}
          </ol>
          {selected !== null && !preview && !error && <p role="status">Загружаем версию…</p>}
          {preview && (
            <div
              className={styles.revisionPreview}
              aria-label={`Предпросмотр версии ${preview.version}`}
            >
              <h3>
                {preview.title} · версия {preview.version}
              </h3>
              <button
                type="button"
                disabled={busy || preview.version === version}
                onClick={() => {
                  void onRestore(preview.version)
                    .then((done) => {
                      if (done) setSelected(null);
                    })
                    .catch((cause) => setError(String(cause)));
                }}
              >
                Восстановить версию {preview.version}
              </button>
              {preview.slides.map((slide, i) => (
                <div key={slide.id}>
                  <SlidePreview slide={slide} theme={preview.theme} number={i + 1} />
                  {slide.notes && <p className={styles.notes}>Заметки: {slide.notes}</p>}
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
