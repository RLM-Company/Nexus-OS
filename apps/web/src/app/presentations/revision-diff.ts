import type { DeckRevision, Slide } from "./model";
export type RevisionContent = Pick<DeckRevision, "title" | "theme" | "slides">;
export type RevisionChange = { label: string; before: string; after: string };
const fields: { key: keyof Omit<Slide, "id" | "visual">; label: string }[] = [
  { key: "layout", label: "Макет" },
  { key: "title", label: "Заголовок" },
  { key: "body", label: "Основной текст" },
  { key: "aside", label: "Вторая колонка" },
  { key: "notes", label: "Заметки" }
];
function visualDescription(visual: Slide["visual"]): string {
  if (!visual) return "";
  return visual.kind === "image"
    ? `Изображение · ${visual.alt}`
    : visual.rows.map((row) => row.join(" | ")).join("\n");
}

function slideDescription(slide: Slide): string {
  return JSON.stringify({ ...slide, visual: visualDescription(slide.visual) }, null, 2);
}

/** Compare stable slide identities. Identical text on distinct slides is not conflated. */
export function compareRevisions(
  before: RevisionContent,
  after: RevisionContent
): RevisionChange[] {
  const changes: RevisionChange[] = [];
  if (before.title !== after.title)
    changes.push({ label: "Название презентации", before: before.title, after: after.title });
  if (before.theme !== after.theme)
    changes.push({ label: "Тема", before: before.theme, after: after.theme });
  const previous = new Map(before.slides.map((slide, index) => [slide.id, { slide, index }]));
  const next = new Set(after.slides.map((slide) => slide.id));
  for (const [index, slide] of before.slides.entries()) {
    if (!next.has(slide.id))
      changes.push({
        label: `Удалён слайд ${index + 1}`,
        before: slideDescription(slide),
        after: ""
      });
  }
  for (const [index, slide] of after.slides.entries()) {
    const old = previous.get(slide.id);
    if (!old) {
      changes.push({
        label: `Добавлен слайд ${index + 1}`,
        before: "",
        after: slideDescription(slide)
      });
      continue;
    }
    if (old.index !== index)
      changes.push({
        label: `Позиция слайда «${slide.title.slice(0, 80)}»`,
        before: String(old.index + 1),
        after: String(index + 1)
      });
    if (JSON.stringify(old.slide.visual) !== JSON.stringify(slide.visual)) {
      changes.push({
        label: `Слайд ${index + 1} · Изображение или таблица`,
        before: visualDescription(old.slide.visual),
        after: visualDescription(slide.visual)
      });
    }
    for (const field of fields) {
      if (old.slide[field.key] !== slide[field.key])
        changes.push({
          label: `Слайд ${index + 1} · ${field.label}`,
          before: old.slide[field.key],
          after: slide[field.key]
        });
    }
  }
  return changes;
}
