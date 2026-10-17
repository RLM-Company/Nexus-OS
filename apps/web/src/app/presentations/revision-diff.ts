import type { DeckRevision, Slide } from "./model";
export type RevisionContent = Pick<DeckRevision, "title" | "theme" | "slides">;
export type RevisionChange = { label: string; before: string; after: string };
const fields: { key: keyof Omit<Slide, "id">; label: string }[] = [
  { key: "layout", label: "Макет" },
  { key: "title", label: "Заголовок" },
  { key: "body", label: "Основной текст" },
  { key: "aside", label: "Вторая колонка" },
  { key: "notes", label: "Заметки" }
];
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
        before: JSON.stringify(slide, null, 2),
        after: ""
      });
  }
  for (const [index, slide] of after.slides.entries()) {
    const old = previous.get(slide.id);
    if (!old) {
      changes.push({
        label: `Добавлен слайд ${index + 1}`,
        before: "",
        after: JSON.stringify(slide, null, 2)
      });
      continue;
    }
    if (old.index !== index)
      changes.push({
        label: `Позиция слайда «${slide.title.slice(0, 80)}»`,
        before: String(old.index + 1),
        after: String(index + 1)
      });
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
