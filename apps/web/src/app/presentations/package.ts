import type { Deck } from "./model";
import {
  parsePresentationPackage,
  type PresentationPackage
} from "@cosmora/contracts/presentation-package";
export {
  parsePresentationPackage,
  PRESENTATION_IMPORT_BYTES,
  type PresentationPackage
} from "@cosmora/contracts/presentation-package";

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
