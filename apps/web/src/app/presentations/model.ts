export type Layout = "title" | "content" | "two-column" | "quote";
export type Theme = "paper" | "night" | "ocean";
export type Slide = {
  id: string;
  layout: Layout;
  title: string;
  body: string;
  aside: string;
  notes: string;
};
export type Deck = {
  id: string;
  title: string;
  theme: Theme;
  slides: Slide[];
  slide_count: number;
  version: number;
  created_at: string;
  updated_at: string;
};
export type DeckSummary = Omit<Deck, "slides">;
export type DeckRevisionSummary = {
  version: number;
  title: string;
  theme: Theme;
  slide_count: number;
  source: "create" | "save" | "import" | "restore" | "migration";
  source_version: number | null;
  created_at: string;
};
export type DeckRevision = DeckRevisionSummary & { slides: Slide[] };

const estimate = (value: string, charsPerLine: number) =>
  value
    .split("\n")
    .reduce((lines, row) => lines + Math.max(1, Math.ceil(row.length / charsPerLine)), 0);

/** Conservative text box capacity at 16:9. Export refuses clips instead of silently hiding text. */
export function slideOverflow(slide: Slide): string[] {
  const issues: string[] = [];
  const titleMax = slide.layout === "title" ? 2 : 3;
  if (estimate(slide.title, slide.layout === "title" ? 35 : 55) > titleMax)
    issues.push("заголовок");
  const bodyLineWidth = slide.layout === "two-column" ? 47 : slide.layout === "quote" ? 58 : 90;
  const bodyLines = slide.layout === "title" ? 4 : slide.layout === "quote" ? 8 : 14;
  if (estimate(slide.body, bodyLineWidth) > bodyLines) issues.push("основной текст");
  if (slide.layout === "two-column" && estimate(slide.aside, 47) > 14)
    issues.push("вторая колонка");
  return issues;
}

export const newSlide = (layout: Layout = "content"): Slide => ({
  id: crypto.randomUUID(),
  layout,
  title: "Новый слайд",
  body: "",
  aside: "",
  notes: ""
});
