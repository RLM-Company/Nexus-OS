import { imageDimensions } from "@cosmora/contracts/chat-attachments";
import type { PresentationVisual } from "@cosmora/contracts/presentation-package";

const x = 900000;
const y = 3500000;
const width = 10400000;
const height = 2350000;

export function presentationImageBytes(image: Extract<PresentationVisual, { kind: "image" }>) {
  return Uint8Array.from(atob(image.data_base64), (character) => character.charCodeAt(0));
}

export function visualXml(
  visual: PresentationVisual,
  escape: (value: string) => string,
  foreground: string
): string {
  if (visual.kind === "image") {
    const dimensions = imageDimensions(presentationImageBytes(visual), visual.mime);
    if (!dimensions) throw new Error("Повреждено изображение слайда.");
    const scale = Math.min(width / dimensions.width, height / dimensions.height);
    const cx = Math.max(1, Math.floor(dimensions.width * scale));
    const cy = Math.max(1, Math.floor(dimensions.height * scale));
    const centeredX = x + Math.floor((width - cx) / 2);
    return `<p:pic><p:nvPicPr><p:cNvPr id="6" name="Slide image" descr="${escape(visual.alt)}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId3"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${centeredX}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
  }
  const columns = visual.rows[0]!.length;
  const columnWidth = Math.floor(width / columns);
  const rowHeight = Math.floor(height / visual.rows.length);
  const grid = visual.rows[0]!.map(() => `<a:gridCol w="${columnWidth}"/>`).join("");
  const rows = visual.rows
    .map((row, index) => {
      const cells = row
        .map(
          (value) =>
            `<a:tc><a:txBody><a:bodyPr wrap="square"/><a:lstStyle/><a:p><a:r><a:rPr lang="ru-RU" sz="1200" b="${index === 0 ? 1 : 0}"><a:solidFill><a:srgbClr val="${foreground}"/></a:solidFill></a:rPr><a:t xml:space="preserve">${escape(value)}</a:t></a:r></a:p></a:txBody><a:tcPr>${[
              "L",
              "R",
              "T",
              "B"
            ]
              .map(
                (edge) =>
                  `<a:ln${edge} w="7000"><a:solidFill><a:srgbClr val="${foreground}"/></a:solidFill></a:ln${edge}>`
              )
              .join("")}<a:noFill/></a:tcPr></a:tc>`
        )
        .join("");
      return `<a:tr h="${rowHeight}">${cells}</a:tr>`;
    })
    .join("");
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="6" name="Slide table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${width}" cy="${height}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1"/><a:tblGrid>${grid}</a:tblGrid>${rows}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
}
