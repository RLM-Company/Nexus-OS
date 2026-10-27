"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatImageAttachment } from "@cosmora/contracts";
import { prepareChatImage } from "../prepare-chat-image";
import { WorkspaceIcon } from "../workspace-icons";
import { MediaGenerationPanel } from "./media-panel";
import { SpeechStudio } from "../voice/voice-playback";
import styles from "./media-workbench.module.css";

type Reference = ChatImageAttachment & { id: string; url: string };
export function MediaWorkbench({ surface }: { surface: "images" | "video" | "sound" }) {
  const video = surface === "video";
  const [prompt, setPrompt] = useState("");
  const [ratio, setRatio] = useState("1:1");
  const [style, setStyle] = useState("Авто");
  const [duration, setDuration] = useState("5");
  const [references, setReferences] = useState<Reference[]>([]);
  const refs = useRef<Reference[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const epoch = useRef(0);
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const draftKey = `kosmora:studio-settings:${surface}`;
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(draftKey);
      const saved: unknown = raw && raw.length < 12000 ? JSON.parse(raw) : null;
      if (saved && typeof saved === "object") {
        const value = saved as Record<string, unknown>;
        if (typeof value.prompt === "string" && value.prompt.length <= 1800)
          setPrompt(value.prompt);
        if (typeof value.ratio === "string" && ["1:1", "16:9", "9:16", "4:3"].includes(value.ratio))
          setRatio(value.ratio);
        if (
          typeof value.style === "string" &&
          ["Авто", "Фотореализм", "Иллюстрация", "Кино", "Минимализм"].includes(value.style)
        )
          setStyle(value.style);
        if (typeof value.duration === "string" && ["5", "10", "15"].includes(value.duration))
          setDuration(value.duration);
      }
    } catch {
      /* The workspace also works when browser storage is unavailable. */
    }
    setHydrated(true);
  }, [draftKey]);
  useEffect(() => {
    if (!hydrated) return;
    try {
      sessionStorage.setItem(draftKey, JSON.stringify({ prompt, ratio, style, duration }));
    } catch {
      /* No generation or network request is triggered by saving a local draft. */
    }
  }, [draftKey, hydrated, prompt, ratio, style, duration]);
  useEffect(
    () => () => {
      epoch.current++;
      refs.current.forEach((file) => URL.revokeObjectURL(file.url));
    },
    []
  );
  const read = useCallback(async (files: File[], replace = false) => {
    if (!files.length) return;
    const sequence = ++epoch.current;
    setError("");
    setReading(true);
    try {
      if (files.length + (replace ? 0 : refs.current.length) > 2)
        throw new Error("Можно добавить до двух референсов.");
      const prepared = await Promise.all(files.map((file) => prepareChatImage(file)));
      if (sequence !== epoch.current) return;
      const added = prepared.map((file) => ({
        ...file,
        id: crypto.randomUUID(),
        url: URL.createObjectURL(
          new Blob(
            [Uint8Array.from(atob(file.data_base64), (character) => character.charCodeAt(0))],
            { type: file.media_type }
          )
        )
      }));
      if (replace) refs.current.forEach((file) => URL.revokeObjectURL(file.url));
      refs.current = [...(replace ? [] : refs.current), ...added];
      setReferences(refs.current);
    } catch (cause) {
      if (sequence === epoch.current)
        setError(cause instanceof Error ? cause.message : "Не удалось прочитать референсы.");
    } finally {
      if (sequence === epoch.current) setReading(false);
    }
  }, []);
  useEffect(() => {
    if (surface !== "images") return;
    const id = new URLSearchParams(window.location.search).get("reference");
    if (!id || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id)) return;
    const controller = new AbortController();
    void fetch(`/api/v1/media/assets/${id}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok || !response.headers.get("content-type")?.startsWith("image/png"))
          throw Error();
        const blob = await response.blob();
        if (!controller.signal.aborted)
          await read([new File([blob], `kosmora-${id}.png`, { type: "image/png" })], true);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("Не удалось открыть исходное изображение.");
      });
    return () => controller.abort();
  }, [surface, read]);
  if (surface === "sound")
    return (
      <section className={styles.workbench}>
        <header className={styles.header}>
          <span>
            <WorkspaceIcon name="sound" />
            Kosmora Studio
          </span>
          <h2>Sound</h2>
          <p>Озвучивание текста, прослушивание и сохранённые записи.</p>
        </header>
        <SpeechStudio />
      </section>
    );
  const blocked = reading
    ? "Проверяем референсы…"
    : ratio !== "1:1"
      ? "Текущий маршрут создаёт PNG 1024 × 1024. Для другого формата нужен соответствующий маршрут генерации."
      : undefined;
  const description = !prompt.trim()
    ? ""
    : style === "Авто"
      ? prompt
      : `${prompt}\nСтиль: ${style}.`;
  return (
    <section className={styles.workbench}>
      <header className={styles.header}>
        <span>
          <WorkspaceIcon name={surface} />
          Kosmora Studio
        </span>
        <h2>{video ? "Создание видео" : "Создание изображений"}</h2>
        <p>
          {video
            ? "Сцена, движение камеры и референсы в одном рабочем окне."
            : "Создавайте изображения по описанию, сохраняйте результат и возвращайтесь к нему в галерее."}
        </p>
      </header>
      <div className={styles.layout}>
        <section className={styles.controls} aria-label="Параметры генерации">
          <label className={styles.field}>
            {video ? "Описание сцены" : "Описание изображения"}
            <textarea
              aria-label={video ? "Описание сцены" : "Описание изображения"}
              rows={7}
              maxLength={1800}
              disabled={!hydrated}
              value={prompt}
              placeholder={
                video
                  ? "Что происходит в кадре, как движется камера…"
                  : "Что изобразить: объект, окружение, свет, настроение…"
              }
              onChange={(event) => setPrompt(event.target.value)}
            />
          </label>
          {!video && (
            <div className={styles.presets} aria-label="Идеи для изображения">
              {[
                [
                  "Постер",
                  "Минималистичный чёрно-белый постер: космонавт среди архитектурных форм, выразительный свет, без текста"
                ],
                [
                  "Предметная съёмка",
                  "Студийная предметная фотография чёрных наушников на белом фоне, мягкий боковой свет, реалистичные материалы"
                ],
                [
                  "Иллюстрация",
                  "Лаконичная изометрическая иллюстрация рабочего пространства будущего, монохромная палитра, чистые линии"
                ]
              ].map(([name, value]) => (
                <button
                  type="button"
                  key={name}
                  disabled={!hydrated}
                  onClick={() => setPrompt(value!)}
                >
                  {name}
                </button>
              ))}
            </div>
          )}
          <div className={styles.references}>
            <div className={styles.sectionTitle}>
              <h3>Референсы</h3>
              <span>{references.length} / 2</span>
            </div>
            <input
              ref={input}
              type="file"
              accept="image/png,image/jpeg"
              multiple
              hidden
              aria-label="Файлы референсов"
              onChange={(event) => {
                void read(Array.from(event.target.files ?? []));
                event.target.value = "";
              }}
            />
            <button
              className={styles.upload}
              type="button"
              disabled={reading || references.length >= 2}
              onClick={() => input.current?.click()}
            >
              <WorkspaceIcon name="paperclip" />
              {reading ? "Проверяем…" : "Добавить референсы"}
              <small>PNG, JPEG · до 20 МБ</small>
            </button>
            {references.length > 0 && (
              <div className={styles.thumbnails}>
                {references.map((file) => (
                  <figure key={file.id}>
                    {/* References leave the browser only after an explicit generation click. */}
                    <img src={file.url} alt={file.name} />
                    <figcaption title={file.name}>{file.name}</figcaption>
                    <button
                      type="button"
                      aria-label={`Убрать референс ${file.name}`}
                      onClick={() => {
                        URL.revokeObjectURL(file.url);
                        refs.current = refs.current.filter((item) => item.id !== file.id);
                        setReferences(refs.current);
                      }}
                    >
                      <WorkspaceIcon name="close" />
                    </button>
                  </figure>
                ))}
              </div>
            )}
            <p className={styles.hint}>
              Референсы используются при нажатии «Изменить изображение». Исходные файлы сохраняются
              у вас.
            </p>
            {error && <p role="alert">{error}</p>}
          </div>
          <fieldset className={styles.ratios}>
            <legend>Соотношение сторон</legend>
            <div>
              {["1:1", "16:9", "9:16", "4:3"].map((value) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={ratio === value}
                  onClick={() => setRatio(value)}
                >
                  {value}
                </button>
              ))}
            </div>
          </fieldset>
          <label className={styles.field}>
            Стиль
            <select
              aria-label="Стиль"
              value={style}
              onChange={(event) => setStyle(event.target.value)}
            >
              {["Авто", "Фотореализм", "Иллюстрация", "Кино", "Минимализм"].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          {video && (
            <label className={styles.field}>
              Длительность
              <select
                aria-label="Длительность"
                value={duration}
                onChange={(event) => setDuration(event.target.value)}
              >
                <option value="5">5 секунд</option>
                <option value="10">10 секунд</option>
                <option value="15">15 секунд</option>
              </select>
            </label>
          )}
          <p className={styles.hint}>
            {video
              ? "Параметры подготовлены для подключения видеомодели."
              : "Доступный маршрут: PNG · 1024 × 1024. Стиль передаётся в описании."}
          </p>
        </section>
        <section className={styles.result} aria-label="Результат генерации">
          {video ? (
            <div className={styles.empty}>
              <WorkspaceIcon name="video" />
              <h3>Здесь появится видео</h3>
              <p>
                Видеогенерация пока не подключена. Описание, параметры и референсы можно подготовить
                здесь.
              </p>
              <button type="button" disabled>
                Сгенерировать видео
              </button>
            </div>
          ) : (
            <MediaGenerationPanel
              prompt={description}
              blockedReason={blocked}
              references={references.map(({ kind, name, media_type, data_base64 }) => ({
                kind,
                name,
                media_type,
                data_base64
              }))}
              onUseResult={(file) => read([file], true)}
            />
          )}
        </section>
      </div>
    </section>
  );
}
