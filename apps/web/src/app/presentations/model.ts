import type { PresentationWorkSource } from "@cosmora/contracts/presentation-package";
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
  work_source?: PresentationWorkSource | null;
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

export { presentationSlideOverflow as slideOverflow } from "@cosmora/contracts/presentation-package";

export const newSlide = (layout: Layout = "content"): Slide => ({
  id: crypto.randomUUID(),
  layout,
  title: "Новый слайд",
  body: "",
  aside: "",
  notes: ""
});
