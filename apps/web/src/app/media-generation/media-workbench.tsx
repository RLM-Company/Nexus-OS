"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { CHAT_ATTACHMENT_LIMITS, type ChatImageAttachment } from "@cosmora/contracts";
import { prepareChatImage } from "../prepare-chat-image";
import { WorkspaceIcon } from "../workspace-icons";
import {
  MediaGenerationPanel,
  mediaAssetUrl,
  useMediaCapabilities,
  type MediaJob
} from "./media-panel";
import { IMAGE_SIZE_FOR_RATIO, resolveImageOptions } from "./media-image-options";
import { SpeechStudio } from "../voice/voice-playback";
import { CreativeMediaPanel } from "./creative-media-panel";
import { VideoStoryboard } from "./video-storyboard";
import styles from "./media-workbench.module.css";

type Reference = ChatImageAttachment & { id: string; url: string };
export function MediaWorkbench({ surface }: { surface: "images" | "video" | "sound" | "music" }) {
  const video = surface === "video";
  const [prompt, setPrompt] = useState("");
  const [ratio, setRatio] = useState("1:1");
  const [quality, setQuality] = useState("low");
  const [format, setFormat] = useState("png");
  const capabilities = useMediaCapabilities();
  const [style, setStyle] = useState("Авто");
  const [duration, setDuration] = useState("5");
  const [clipScene, setClipScene] = useState<{
    id: string;
    version: number;
    prompt: string;
    seconds: number;
  }>();
  const [source, setSource] = useState<{ id: string; name: string }>();
  const sourceId = source?.id;
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
        if (typeof value.ratio === "string" && ["1:1", "3:2", "2:3"].includes(value.ratio))
          setRatio(value.ratio);
        if (
          typeof value.style === "string" &&
          ["Авто", "Фотореализм", "Иллюстрация", "Кино", "Минимализм"].includes(value.style)
        )
          setStyle(value.style);
        if (typeof value.duration === "string" && ["5", "10", "15"].includes(value.duration))
          setDuration(value.duration);
        if (
          typeof value.quality === "string" &&
          ["low", "medium", "high", "auto"].includes(value.quality)
        )
          setQuality(value.quality);
        if (typeof value.format === "string" && ["png", "jpeg", "webp"].includes(value.format))
          setFormat(value.format);
      }
    } catch {
      /* The workspace also works when browser storage is unavailable. */
    }
    setHydrated(true);
  }, [draftKey]);
  useEffect(() => {
    if (!hydrated) return;
    try {
      sessionStorage.setItem(
        draftKey,
        JSON.stringify({ prompt, ratio, style, duration, quality, format })
      );
    } catch {
      /* No generation or network request is triggered by saving a local draft. */
    }
  }, [draftKey, hydrated, prompt, ratio, style, duration, quality, format]);
  useEffect(
    () => () => {
      epoch.current++;
      refs.current.forEach((file) => URL.revokeObjectURL(file.url));
    },
    []
  );
  const read = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      const sequence = ++epoch.current;
      setError("");
      setReading(true);
      try {
        if (files.length + refs.current.length + Number(Boolean(sourceId)) > 2)
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
        refs.current = [...refs.current, ...added];
        setReferences(refs.current);
      } catch (cause) {
        if (sequence === epoch.current)
          setError(cause instanceof Error ? cause.message : "Не удалось прочитать референсы.");
      } finally {
        if (sequence === epoch.current) setReading(false);
      }
    },
    [sourceId]
  );
  const selectSource = useCallback((job: MediaJob) => {
    epoch.current++;
    refs.current.forEach((file) => URL.revokeObjectURL(file.url));
    refs.current = [];
    setReferences([]);
    setReading(false);
    setError("");
    setSource({
      id: job.id,
      name: `kosmora-${job.id}.${job.asset?.mime === "image/jpeg" ? "jpg" : "png"}`
    });
  }, []);
  useEffect(() => {
    if (surface !== "images" || capabilities?.image_editing?.ready !== true) return;
    const id = new URLSearchParams(window.location.search).get("reference");
    if (!id || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id)) return;
    const controller = new AbortController();
    void fetch(`/api/v1/media/jobs/${id}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw Error();
        const job = (await response.json()) as MediaJob;
        if (
          job.kind !== "image" ||
          job.status !== "done" ||
          !["image/png", "image/jpeg"].includes(job.asset?.mime ?? "") ||
          (job.asset?.bytes ?? Infinity) > CHAT_ATTACHMENT_LIMITS.imageBytes
        )
          throw Error();
        if (job.id !== id) throw Error();
        if (!controller.signal.aborted) selectSource(job);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("Исходное изображение недоступно для правки.");
      });
    return () => controller.abort();
  }, [surface, capabilities?.image_editing?.ready, selectSource]);
  if (surface === "music")
    return (
      <section className={styles.workbench}>
        <header className={styles.header}>
          <span>
            <WorkspaceIcon name="sound" />
            Kosmora Studio
          </span>
          <h2>Music</h2>
          <p>Создавайте и сохраняйте композиции по описанию.</p>
        </header>
        <CreativeMediaPanel kind="music" capability={capabilities?.music_generation} />
      </section>
    );
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
        <CreativeMediaPanel kind="sfx" capability={capabilities?.sound_effects} />
      </section>
    );
  const imageConstraints = capabilities?.image_generation.constraints;
  const imageOptions = resolveImageOptions(imageConstraints, {
    aspect_ratio: ratio,
    quality,
    format
  });
  const blocked = reading
    ? "Проверяем референсы…"
    : !video && !imageOptions
      ? "Сервер не объявил доступные параметры изображения. Запуск заблокирован."
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
            ? "Видеопровайдер не подключён. Составьте текстовую раскадровку из нескольких сцен."
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
          {!video && (
            <div className={styles.references}>
              <div className={styles.sectionTitle}>
                <h3>Референсы</h3>
                <span>{references.length + Number(Boolean(sourceId))} / 2</span>
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
                disabled={
                  reading ||
                  references.length + Number(Boolean(sourceId)) >= 2 ||
                  capabilities?.image_editing?.ready !== true
                }
                onClick={() => input.current?.click()}
              >
                <WorkspaceIcon name="paperclip" />
                {reading ? "Проверяем…" : "Добавить референсы"}
                <small>PNG, JPEG · до 20 МБ</small>
              </button>
              {source && (
                <div>
                  <img src={mediaAssetUrl(source.id)} alt="Исходник для правки" width={96} />
                  <button
                    type="button"
                    aria-label={`Убрать референс ${source.name}`}
                    onClick={() => setSource(undefined)}
                  >
                    Убрать исходник
                  </button>
                </div>
              )}
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
                {capabilities?.image_editing?.ready === true
                  ? "Референсы передаются только после явного запуска редактирования; исходные файлы остаются у вас."
                  : "Редактирование по референсам пока не объявлено сервером и отключено."}
              </p>
              {error && <p role="alert">{error}</p>}
            </div>
          )}
          {!video && imageOptions && imageConstraints && (
            <>
              <fieldset className={styles.ratios}>
                <legend>Соотношение сторон</legend>
                <div>
                  {imageConstraints.aspectRatios.map((value) => (
                    <button
                      type="button"
                      key={value}
                      aria-pressed={imageOptions.aspect_ratio === value}
                      onClick={() => setRatio(value)}
                    >
                      {value} · {IMAGE_SIZE_FOR_RATIO[value].replace("x", " × ")}
                    </button>
                  ))}
                </div>
              </fieldset>
              <label className={styles.field}>
                Качество
                <select
                  aria-label="Качество изображения"
                  value={imageOptions.quality}
                  onChange={(event) => setQuality(event.target.value)}
                >
                  {imageConstraints.qualities.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                Формат результата
                <select
                  aria-label="Формат результата"
                  value={imageOptions.format}
                  onChange={(event) => setFormat(event.target.value)}
                >
                  {imageConstraints.formats.map((value) => (
                    <option key={value} value={value}>
                      {value.toUpperCase()}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
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
              ? capabilities?.video_generation?.ready
                ? "Создайте отдельный клип из черновика или выберите сохранённую версию сцены."
                : "Видеогенерация не подключена. Черновик не запускает провайдера."
              : imageOptions
                ? `Маршрут: ${imageOptions.format.toUpperCase()} · ${IMAGE_SIZE_FOR_RATIO[imageOptions.aspect_ratio].replace("x", " × ")}. Стиль передаётся в описании.`
                : "Параметры появятся только после подтверждения от API."}
          </p>
        </section>
        <section className={styles.result} aria-label="Результат генерации">
          {video ? (
            <>
              <VideoStoryboard
                description={prompt}
                duration={duration}
                onSelect={(next, seconds) => {
                  setPrompt(next);
                  setDuration(seconds);
                  setClipScene(undefined);
                }}
                {...(capabilities?.video_generation?.ready
                  ? {
                      onSelectClip: (
                        scene: { id: string; version: number },
                        next: string,
                        seconds: number
                      ) => setClipScene({ ...scene, prompt: next, seconds })
                    }
                  : {})}
              />
              {clipScene && (
                <button type="button" onClick={() => setClipScene(undefined)}>
                  Использовать текущий черновик для клипа
                </button>
              )}
              <CreativeMediaPanel
                kind="video"
                capability={capabilities?.video_generation}
                clip={
                  clipScene
                    ? {
                        prompt: clipScene.prompt,
                        seconds: clipScene.seconds,
                        scene: { id: clipScene.id, version: clipScene.version }
                      }
                    : { prompt, seconds: Number(duration) }
                }
              />
            </>
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
              onUseResult={selectSource}
              sourceId={sourceId}
              onRestoreParameters={(saved) => {
                setRatio(saved.aspect_ratio);
                setQuality(saved.quality);
                setFormat(saved.format);
              }}
              capabilities={capabilities}
              options={imageOptions}
            />
          )}
        </section>
      </div>
    </section>
  );
}
