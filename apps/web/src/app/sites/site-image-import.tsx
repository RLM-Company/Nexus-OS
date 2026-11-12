"use client";

import { useEffect, useRef, useState } from "react";
import { embedSiteImage, SITE_IMAGE_MAX_BYTES } from "./site-inline-image";
import styles from "./sites.module.css";

export function SiteImageImport({
  content,
  disabled,
  onChange
}: {
  content: string;
  disabled: boolean;
  onChange: (updated: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [alt, setAlt] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const current = useRef(content);
  const active = useRef(true);
  current.current = content;
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const insert = async () => {
    if (disabled || working || !file) return;
    const source = current.current;
    setWorking(true);
    setError("");
    try {
      if (file.size > SITE_IMAGE_MAX_BYTES) throw new Error("Изображение превышает 64 КиБ.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!active.current) return;
      if (current.current !== source) {
        throw new Error("HTML изменился во время чтения файла. Выберите изображение повторно.");
      }
      const updated = embedSiteImage(source, bytes, alt);
      if (!active.current || current.current !== source) return;
      onChange(updated);
      setFile(null);
      setAlt("");
    } catch (cause) {
      if (active.current) {
        setError(cause instanceof Error ? cause.message : "Не удалось добавить изображение.");
      }
    } finally {
      if (active.current) setWorking(false);
    }
  };
  return (
    <section className={styles.assetPanel} aria-label="Изображения сайта">
      <p>PNG, JPEG или WebP до 64 КиБ будут встроены в HTML без внешней загрузки.</p>
      <label>
        Файл изображения
        <input
          type="file"
          accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
          disabled={disabled || working}
          aria-label="Файл изображения сайта"
          onChange={(event) => {
            setFile(event.currentTarget.files?.[0] ?? null);
            event.currentTarget.value = "";
            setError("");
          }}
        />
      </label>
      <label>
        Описание изображения (alt)
        <input
          type="text"
          value={alt}
          maxLength={200}
          disabled={disabled || working}
          onChange={(event) => setAlt(event.target.value)}
        />
      </label>
      <button type="button" disabled={disabled || working || !file} onClick={() => void insert()}>
        Встроить изображение
      </button>
      {working && <p role="status">Проверяю изображение…</p>}
      {error && <p role="alert">{error}</p>}
      <p>
        Изображение станет частью черновика и войдёт в сохранённую версию и HTML-экспорт.
      </p>
    </section>
  );
}
