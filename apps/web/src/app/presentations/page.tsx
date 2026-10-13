"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPptx } from "./pptx";
import {
  newSlide,
  slideOverflow,
  type Deck,
  type DeckSummary,
  type Layout,
  type Slide,
  type Theme
} from "./model";
import styles from "./presentations.module.css";

const layouts: { value: Layout; label: string }[] = [
  { value: "title", label: "Титульный" },
  { value: "content", label: "Текст" },
  { value: "two-column", label: "Две колонки" },
  { value: "quote", label: "Цитата" }
];
const themes: { value: Theme; label: string }[] = [
  { value: "paper", label: "Бумага" },
  { value: "night", label: "Ночь" },
  { value: "ocean", label: "Графит" }
];
const endpoint = "/api/v1/presentations";

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...options });
  if (!response.ok) {
    const result = (await response.json().catch(() => ({}))) as { error?: { code?: string } };
    if (response.status === 409) throw Error("CONFLICT");
    if (response.status === 401) throw Error("Сеанс завершён. Войдите снова.");
    if (response.status === 423) throw Error("Данные аккаунта временно закрыты для изменений.");
    if (response.status === 413) throw Error("Превышен лимит презентаций или объёма текста.");
    throw Error(result.error?.code ?? "Не удалось сохранить данные.");
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}
const json = (value: unknown) => ({
  headers: { "content-type": "application/json" },
  body: JSON.stringify(value)
});
function download(name: string, data: BlobPart, mime: string) {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
const fileName = (name: string) =>
  name.replace(/[^\p{L}\p{N}_.-]+/gu, "-").slice(0, 80) || "presentation";

function SlidePreview({ slide, theme, number }: { slide: Slide; theme: Theme; number: number }) {
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

export default function PresentationsPage() {
  const [items, setItems] = useState<DeckSummary[]>([]);
  const [deck, setDeck] = useState<Deck | null>(null);
  const [selected, setSelected] = useState(0);
  const [title, setTitle] = useState("Новая презентация");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [presenting, setPresenting] = useState(false);
  const [fullScreenSlide, setFullScreenSlide] = useState(0);
  const editRevision = useRef(0);
  const refresh = useCallback(async () => {
    const result = await api<{ items: DeckSummary[] }>(endpoint);
    setItems(result.items);
  }, []);
  useEffect(() => {
    refresh()
      .catch((cause) => setError(String(cause)))
      .finally(() => setLoading(false));
  }, [refresh]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const selectedSlide = deck?.slides[selected];
  const warnings = useMemo(
    () =>
      deck?.slides.flatMap((slide, index) =>
        slideOverflow(slide).map((field) => `Слайд ${index + 1}: ${field}`)
      ) ?? [],
    [deck]
  );
  const edit = (modify: (value: Deck) => Deck) => {
    editRevision.current++;
    setDeck((previous) => (previous ? modify(previous) : null));
    setDirty(true);
    setError("");
  };
  const modifySlide = (patch: Partial<Slide>) =>
    edit((value) => ({
      ...value,
      slides: value.slides.map((slide, index) =>
        index === selected ? { ...slide, ...patch } : slide
      )
    }));
  const open = async (id: string) => {
    if (dirty && !window.confirm("Есть несохранённые изменения. Открыть другую презентацию?"))
      return;
    setBusy(true);
    setError("");
    try {
      setDeck(await api<Deck>(`${endpoint}/${id}`));
      setSelected(0);
      setDirty(false);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  const create = async () => {
    if (!title.trim()) return;
    if (dirty && !window.confirm("Есть несохранённые изменения. Создать другую презентацию?"))
      return;
    setBusy(true);
    setError("");
    try {
      const created = await api<Deck>(endpoint, {
        method: "POST",
        ...json({ title: title.trim() })
      });
      setDeck(created);
      setSelected(0);
      setDirty(false);
      await refresh();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (!deck || !dirty || busy) return;
    const savingRevision = editRevision.current;
    setBusy(true);
    setError("");
    try {
      const updated = await api<Deck>(`${endpoint}/${deck.id}`, {
        method: "PUT",
        ...json({
          version: deck.version,
          title: deck.title,
          theme: deck.theme,
          slides: deck.slides
        })
      });
      if (editRevision.current === savingRevision) {
        setDeck(updated);
        setDirty(false);
      } else {
        setDeck((current) =>
          current?.id === updated.id
            ? { ...current, version: updated.version, updated_at: updated.updated_at }
            : current
        );
      }
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message === "CONFLICT"
          ? "Презентация изменена в другом окне. Сохранение остановлено; откройте её заново после копирования своих правок."
          : String(cause)
      );
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!deck || !window.confirm(`Удалить «${deck.title}»? Это действие нельзя отменить.`)) return;
    setBusy(true);
    setError("");
    try {
      await api<void>(`${endpoint}/${deck.id}?version=${deck.version}`, { method: "DELETE" });
      setDeck(null);
      setDirty(false);
      await refresh();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  const add = (layout: Layout) => {
    if (!deck) return;
    if (deck.slides.length >= 50) {
      setError("Допускается не более 50 слайдов.");
      return;
    }
    const next = newSlide(layout);
    edit((value) => ({
      ...value,
      slides: [...value.slides.slice(0, selected + 1), next, ...value.slides.slice(selected + 1)]
    }));
    setSelected(selected + 1);
  };
  const move = (direction: -1 | 1) => {
    if (!deck || selected + direction < 0 || selected + direction >= deck.slides.length) return;
    edit((value) => {
      const slides = [...value.slides];
      [slides[selected], slides[selected + direction]] = [
        slides[selected + direction]!,
        slides[selected]!
      ];
      return { ...value, slides };
    });
    setSelected(selected + direction);
  };
  const duplicate = () => {
    if (!deck || !selectedSlide || deck.slides.length >= 50) return;
    const next = { ...selectedSlide, id: crypto.randomUUID() };
    edit((value) => ({
      ...value,
      slides: [...value.slides.slice(0, selected + 1), next, ...value.slides.slice(selected + 1)]
    }));
    setSelected(selected + 1);
  };
  const removeSlide = () => {
    if (!deck || deck.slides.length <= 1) return;
    edit((value) => ({ ...value, slides: value.slides.filter((_, index) => index !== selected) }));
    setSelected(Math.max(0, selected - 1));
  };
  const exportDeck = (kind: "pptx" | "json") => {
    if (!deck) return;
    if (kind === "pptx" && warnings.length) {
      setError("Сократите текст в отмеченных полях перед экспортом PPTX.");
      return;
    }
    try {
      const name = fileName(deck.title);
      if (kind === "json")
        download(`${name}.json`, JSON.stringify(deck, null, 2), "application/json");
      else
        download(
          `${name}.pptx`,
          new Uint8Array(createPptx(deck)),
          "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        );
    } catch (cause) {
      setError(String(cause));
    }
  };

  return (
    <main className={styles.root}>
      <header className={styles.header}>
        <div>
          <Link href="/">← Kosmora</Link>
          <span className={styles.eyebrow}>STUDIO / PRESENTATIONS</span>
          <h1>Презентации</h1>
          <p>Соберите структуру, проверьте каждый слайд и скачайте редактируемый PPTX.</p>
        </div>
        {deck && (
          <div className={styles.headerActions}>
            <button
              type="button"
              onClick={() => {
                setPresenting(true);
                setFullScreenSlide(0);
              }}
            >
              Просмотр
            </button>
            <button type="button" onClick={() => exportDeck("json")}>
              JSON
            </button>
            <button type="button" onClick={() => exportDeck("pptx")}>
              Скачать PPTX
            </button>
            <button
              type="button"
              className={styles.primary}
              onClick={save}
              disabled={!dirty || busy}
            >
              Сохранить
            </button>
          </div>
        )}
      </header>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.workspace}>
        <aside className={styles.library}>
          <h2>Мои презентации</h2>
          <div className={styles.create}>
            <label htmlFor="new-deck">Название</label>
            <input
              id="new-deck"
              value={title}
              maxLength={160}
              onChange={(event) => setTitle(event.target.value)}
            />
            <button type="button" onClick={create} disabled={busy || !title.trim()}>
              + Создать
            </button>
          </div>
          {loading && <p>Загружаем…</p>}
          <div className={styles.deckList}>
            {items.map((item) => (
              <button
                type="button"
                key={item.id}
                className={deck?.id === item.id ? styles.active : ""}
                onClick={() => void open(item.id)}
                disabled={busy}
              >
                <strong>{item.title}</strong>
                <small>
                  {item.slide_count} слайдов ·{" "}
                  {new Date(item.updated_at).toLocaleDateString("ru-RU")}
                </small>
              </button>
            ))}
          </div>
        </aside>
        {deck && selectedSlide ? (
          <section className={styles.editor} aria-label="Редактор презентации">
            <div className={styles.deckBar}>
              <label>
                Название презентации
                <input
                  value={deck.title}
                  maxLength={160}
                  onChange={(event) => edit((value) => ({ ...value, title: event.target.value }))}
                />
              </label>
              <label>
                Тема
                <select
                  value={deck.theme}
                  onChange={(event) =>
                    edit((value) => ({ ...value, theme: event.target.value as Theme }))
                  }
                >
                  {themes.map((theme) => (
                    <option key={theme.value} value={theme.value}>
                      {theme.label}
                    </option>
                  ))}
                </select>
              </label>
              <span className={styles.saveState}>{dirty ? "Не сохранено" : "Сохранено"}</span>
              <button type="button" className={styles.danger} onClick={remove} disabled={busy}>
                Удалить презентацию
              </button>
            </div>
            <div className={styles.editGrid}>
              <div className={styles.slidesPanel}>
                <h2>
                  Слайды <span>{deck.slides.length}/50</span>
                </h2>
                <ol>
                  {deck.slides.map((slide, index) => (
                    <li key={slide.id}>
                      <button
                        type="button"
                        className={index === selected ? styles.selected : ""}
                        onClick={() => setSelected(index)}
                        aria-current={index === selected ? "true" : undefined}
                      >
                        <span>{index + 1}</span>
                        <strong>{slide.title || "Без названия"}</strong>
                        {slideOverflow(slide).length > 0 && (
                          <em aria-label="Текст не помещается">!</em>
                        )}
                      </button>
                    </li>
                  ))}
                </ol>
                <label>
                  Добавить слайд
                  <select
                    value=""
                    onChange={(event) => {
                      if (event.target.value) add(event.target.value as Layout);
                    }}
                  >
                    <option value="">Выберите макет…</option>
                    {layouts.map((layout) => (
                      <option key={layout.value} value={layout.value}>
                        {layout.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className={styles.canvas}>
                <SlidePreview slide={selectedSlide} theme={deck.theme} number={selected + 1} />
                <div className={styles.slideTools}>
                  <button type="button" onClick={() => move(-1)} disabled={selected === 0}>
                    ↑ Выше
                  </button>
                  <button
                    type="button"
                    onClick={() => move(1)}
                    disabled={selected === deck.slides.length - 1}
                  >
                    ↓ Ниже
                  </button>
                  <button type="button" onClick={duplicate} disabled={deck.slides.length >= 50}>
                    Дублировать
                  </button>
                  <button type="button" onClick={removeSlide} disabled={deck.slides.length === 1}>
                    Удалить слайд
                  </button>
                </div>
                <div className={styles.fields}>
                  <label>
                    Макет
                    <select
                      value={selectedSlide.layout}
                      onChange={(event) => modifySlide({ layout: event.target.value as Layout })}
                    >
                      {layouts.map((layout) => (
                        <option key={layout.value} value={layout.value}>
                          {layout.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Заголовок
                    <input
                      value={selectedSlide.title}
                      maxLength={180}
                      onChange={(event) => modifySlide({ title: event.target.value })}
                    />
                  </label>
                  <label>
                    Основной текст
                    <textarea
                      value={selectedSlide.body}
                      maxLength={4000}
                      rows={5}
                      onChange={(event) => modifySlide({ body: event.target.value })}
                    />
                  </label>
                  {selectedSlide.layout === "two-column" && (
                    <label>
                      Вторая колонка
                      <textarea
                        value={selectedSlide.aside}
                        maxLength={4000}
                        rows={5}
                        onChange={(event) => modifySlide({ aside: event.target.value })}
                      />
                    </label>
                  )}
                  <label>
                    Заметки докладчика <small>Сохраняются в Kosmora и JSON</small>
                    <textarea
                      value={selectedSlide.notes}
                      maxLength={4000}
                      rows={3}
                      onChange={(event) => modifySlide({ notes: event.target.value })}
                    />
                  </label>
                </div>
                {warnings.length > 0 && (
                  <div className={styles.warnings} role="status">
                    <strong>Проверьте размещение текста</strong>
                    <ul>
                      {warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </section>
        ) : (
          <section className={styles.empty}>
            <h2>Начните с первого слайда</h2>
            <p>
              Создайте презентацию или откройте сохранённую. Файлы доступны только в вашем аккаунте.
            </p>
          </section>
        )}
      </div>
      {presenting && deck && (
        <div
          className={styles.presenter}
          role="dialog"
          aria-modal="true"
          aria-label="Просмотр презентации"
          onKeyDown={(event) => {
            if (event.key === "Escape") setPresenting(false);
            if (event.key === "ArrowRight")
              setFullScreenSlide((n) => Math.min(n + 1, deck.slides.length - 1));
            if (event.key === "ArrowLeft") setFullScreenSlide((n) => Math.max(n - 1, 0));
          }}
          tabIndex={-1}
          ref={(element) => element?.focus()}
        >
          <button type="button" className={styles.close} onClick={() => setPresenting(false)}>
            Закрыть ×
          </button>
          <SlidePreview
            slide={deck.slides[fullScreenSlide]!}
            theme={deck.theme}
            number={fullScreenSlide + 1}
          />
          <nav>
            <button
              type="button"
              onClick={() => setFullScreenSlide((n) => Math.max(n - 1, 0))}
              disabled={fullScreenSlide === 0}
            >
              ← Назад
            </button>
            <span>
              {fullScreenSlide + 1} / {deck.slides.length}
            </span>
            <button
              type="button"
              onClick={() => setFullScreenSlide((n) => Math.min(n + 1, deck.slides.length - 1))}
              disabled={fullScreenSlide === deck.slides.length - 1}
            >
              Далее →
            </button>
          </nav>
        </div>
      )}
    </main>
  );
}
