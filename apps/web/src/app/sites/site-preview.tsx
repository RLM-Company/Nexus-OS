"use client";

import { useEffect, useState } from "react";
import styles from "./sites.module.css";

const tags = new Set(
  "a abbr article aside b blockquote br button caption code col colgroup dd del details div dl dt em figcaption figure footer h1 h2 h3 h4 h5 h6 header hr i img input label legend li main mark nav ol option p picture pre section select small source span strong style sub summary sup table tbody td textarea tfoot th thead time tr u ul".split(
    " "
  )
);
const attributes = new Set(
  "alt class colspan dir height id lang placeholder role rowspan style title type value width".split(
    " "
  )
);
const policy =
  "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'none'; connect-src 'none'";

/** Template contents are inert. Serialize only static HTML, then isolate it again in a sandbox. */
export function staticSiteDocument(content: string): string {
  if (new TextEncoder().encode(content).length > 512 * 1024)
    throw Error("Размер предпросмотра превышает 512 КиБ.");
  const template = document.createElement("template");
  template.innerHTML = content;
  for (const element of template.content.querySelectorAll("*")) {
    if (element.namespaceURI !== "http://www.w3.org/1999/xhtml" || !tags.has(element.localName)) {
      element.remove();
      continue;
    }
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      const image =
        name === "src" &&
        element.localName === "img" &&
        /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(attribute.value);
      if (!image && !attributes.has(name) && !/^aria-[a-z-]+$/.test(name))
        element.removeAttribute(attribute.name);
    }
    if (["button", "input", "select", "textarea"].includes(element.localName))
      element.setAttribute("disabled", "");
  }
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${template.innerHTML}</body></html>`;
}

export function SitePreview({ content }: { content: string }) {
  const [viewport, setViewport] = useState("desktop");
  const [preview, setPreview] = useState<{ source: string; document: string } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        setPreview({ source: content, document: staticSiteDocument(content) });
        setError("");
      } catch (cause) {
        setPreview(null);
        setError(cause instanceof Error ? cause.message : "Не удалось подготовить просмотр.");
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [content]);
  return (
    <section className={styles.preview} aria-label="Предпросмотр сайта">
      <div className={styles.toolbar} role="group" aria-label="Ширина предпросмотра сайта">
        {[
          ["desktop", "Компьютер"],
          ["tablet", "Планшет"],
          ["mobile", "Телефон"]
        ].map(([value, label]) => (
          <button
            type="button"
            key={value}
            aria-pressed={viewport === value}
            onClick={() => setViewport(value!)}
          >
            {label}
          </button>
        ))}
      </div>
      <p className={styles.caption}>
        Статический просмотр: скрипты, формы и внешние ресурсы отключены.
      </p>
      {error ? (
        <p role="alert">{error}</p>
      ) : preview?.source === content ? (
        <div className={styles.frameArea}>
          <iframe
            className={`${styles.frame} ${styles[viewport]}`}
            title="Статический предпросмотр сайта"
            sandbox=""
            referrerPolicy="no-referrer"
            srcDoc={preview.document}
          />
        </div>
      ) : (
        <p role="status">Обновляю предпросмотр…</p>
      )}
    </section>
  );
}
