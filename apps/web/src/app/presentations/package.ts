import type { Deck, Slide, Theme } from "./model";

export const PRESENTATION_IMPORT_BYTES = 350_000;
export type PresentationPackage = {
  format: "kosmora-presentation-v1";
  title: string;
  theme: Theme;
  slides: Slide[];
};

const fail = (): never => {
  throw Error("Некорректный файл презентации Kosmora.");
};
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fail();
const text = (value: unknown, max: number): string => {
  if (
    typeof value !== "string" ||
    value.length > max ||
    Array.from(value).some((c) => {
      const n = c.charCodeAt(0);
      return (
        (n < 32 && n !== 9 && n !== 10 && n !== 13) ||
        n === 0xfffe ||
        n === 0xffff ||
        (n >= 0xd800 && n <= 0xdfff && c.length === 1)
      );
    })
  )
    return fail();
  return value;
};

/** Imports only text and known layout values; legacy exported IDs/versions never become account identity. */
export function parsePresentationPackage(source: string): PresentationPackage {
  if (new TextEncoder().encode(source).length > PRESENTATION_IMPORT_BYTES)
    throw Error("Файл презентации превышает 350 КБ.");
  let decoded: unknown;
  try {
    decoded = JSON.parse(source.replace(/^\uFEFF/u, ""));
  } catch {
    return fail();
  }
  const value = object(decoded);
  const legacy =
    value.format === undefined &&
    typeof value.id === "string" &&
    typeof value.version === "number" &&
    typeof value.created_at === "string" &&
    typeof value.updated_at === "string";
  if (value.format !== "kosmora-presentation-v1" && !legacy) return fail();
  const allowed = legacy
    ? ["id", "version", "created_at", "updated_at", "slide_count", "title", "theme", "slides"]
    : ["format", "title", "theme", "slides"];
  if (Object.keys(value).some((key) => !allowed.includes(key))) return fail();
  const title = text(value.title, 160).trim();
  if (
    !title ||
    (value.theme !== "paper" && value.theme !== "night" && value.theme !== "ocean") ||
    !Array.isArray(value.slides) ||
    value.slides.length < 1 ||
    value.slides.length > 50
  )
    return fail();
  const ids = new Set<string>();
  const slides: Slide[] = value.slides.map((raw: unknown) => {
    const slide = object(raw);
    if (
      Object.keys(slide).some(
        (key) => !["id", "layout", "title", "body", "aside", "notes"].includes(key)
      )
    )
      return fail();
    const id = text(slide.id, 80);
    if (!/^[a-zA-Z0-9_-]{1,80}$/u.test(id) || ids.has(id)) return fail();
    ids.add(id);
    const layout = slide.layout;
    if (layout !== "title" && layout !== "content" && layout !== "two-column" && layout !== "quote")
      return fail();
    return {
      id,
      layout,
      title: text(slide.title, 180),
      body: text(slide.body, 4000),
      aside: text(slide.aside, 4000),
      notes: text(slide.notes, 4000)
    };
  });
  if (new TextEncoder().encode(JSON.stringify(slides)).length > 300_000) return fail();
  return { format: "kosmora-presentation-v1", title, theme: value.theme, slides };
}

export function presentationPackage(
  deck: Pick<Deck, "title" | "theme" | "slides">
): PresentationPackage {
  return parsePresentationPackage(
    JSON.stringify({
      format: "kosmora-presentation-v1",
      title: deck.title,
      theme: deck.theme,
      slides: deck.slides
    })
  );
}
