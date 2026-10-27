import { strToU8, zipSync } from "fflate";
import type { Deck, Slide, Theme } from "./model";
import { slideOverflow } from "./model";

const esc = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;"
      })[character]!
  );
const xml = (content: string) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${content}`;
const palettes: Record<
  Theme,
  { background: string; foreground: string; muted: string; accent: string }
> = {
  paper: { background: "FAFAFA", foreground: "1D1D1D", muted: "5C5C5C", accent: "333333" },
  night: { background: "181818", foreground: "F7F7F7", muted: "BCBCBC", accent: "DDDDDD" },
  ocean: { background: "E9E9E9", foreground: "222222", muted: "5A5A5A", accent: "555555" }
};

const textShape = (
  id: number,
  name: string,
  value: string,
  x: number,
  y: number,
  width: number,
  height: number,
  size: number,
  color: string,
  bold = false
) => {
  const paragraphs = value
    .split("\n")
    .map(
      (line) =>
        `<a:p><a:pPr marL="0" algn="l"/><a:r><a:rPr lang="ru-RU" sz="${size}" b="${bold ? 1 : 0}">` +
        `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="Aptos"/></a:rPr>` +
        `<a:t xml:space="preserve">${esc(line)}</a:t></a:r><a:endParaRPr lang="ru-RU"/></a:p>`
    )
    .join("");
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${esc(name)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${width}" cy="${height}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr>` +
    `<p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="t"/><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`
  );
};

const slideXml = (slide: Slide, index: number, theme: Theme) => {
  const p = palettes[theme];
  let shapes = "";
  if (slide.layout === "title") {
    shapes += textShape(
      2,
      "Title",
      slide.title,
      900000,
      1550000,
      10400000,
      1500000,
      4200,
      p.foreground,
      true
    );
    shapes += textShape(
      3,
      "Subtitle",
      slide.body,
      900000,
      3400000,
      10400000,
      1400000,
      2400,
      p.muted
    );
  } else if (slide.layout === "quote") {
    shapes += textShape(
      2,
      "Title",
      slide.title,
      900000,
      620000,
      10400000,
      900000,
      3000,
      p.accent,
      true
    );
    shapes += textShape(
      3,
      "Quote",
      slide.body,
      1200000,
      1960000,
      9800000,
      2850000,
      3100,
      p.foreground
    );
  } else {
    shapes += textShape(
      2,
      "Title",
      slide.title,
      900000,
      590000,
      10400000,
      1150000,
      3200,
      p.foreground,
      true
    );
    shapes += textShape(
      3,
      "Body",
      slide.body,
      900000,
      1940000,
      slide.layout === "two-column" ? 4900000 : 10400000,
      3800000,
      2300,
      p.foreground
    );
    if (slide.layout === "two-column")
      shapes += textShape(
        4,
        "Aside",
        slide.aside,
        6500000,
        1940000,
        4750000,
        3800000,
        2300,
        p.foreground
      );
  }
  shapes += textShape(
    5,
    "Page",
    String(index + 1),
    10900000,
    6150000,
    500000,
    350000,
    1200,
    p.muted
  );
  return xml(
    `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="${p.background}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
  );
};

const rels = (items: Array<{ id: number; type: string; target: string }>) =>
  xml(
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items
      .map(
        (item) =>
          `<Relationship Id="rId${item.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${item.type}" Target="${item.target}"/>`
      )
      .join("")}</Relationships>`
  );
const bytes = (source: string) => strToU8(source);
const namespaces =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const group =
  '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
const notesBody = (value: string) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Speaker notes"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="3"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="4343400"/><a:ext cx="5486400" cy="4114800"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/>${value
    .split("\n")
    .map(
      (line) =>
        `<a:p><a:r><a:rPr lang="ru-RU" sz="1200"/><a:t xml:space="preserve">${esc(line)}</a:t></a:r></a:p>`
    )
    .join("")}</p:txBody></p:sp>`;
const notesImage =
  '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide image"/><p:cNvSpPr/><p:nvPr><p:ph type="sldImg" idx="2"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="685800"/><a:ext cx="5486400" cy="3086100"/></a:xfrm></p:spPr></p:sp>';

/** Generates an editable OOXML presentation with one slide master and four layout variants. */
export function createPptx(deck: Pick<Deck, "title" | "theme" | "slides">): Uint8Array {
  if (!deck.slides.length || deck.slides.length > 50) throw Error("INVALID_DECK");
  const allText = [
    deck.title,
    ...deck.slides.flatMap((slide) => [slide.title, slide.body, slide.aside, slide.notes])
  ];
  if (
    allText.some((value) =>
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
  )
    throw Error("Текст содержит недопустимый для PPTX символ.");
  const overflowing = deck.slides.findIndex((slide) => slideOverflow(slide).length > 0);
  if (overflowing !== -1) throw Error(`OVERFLOW:${overflowing + 1}`);
  const entries: Record<string, Uint8Array> = {};
  const put = (path: string, content: string) => {
    entries[path] = bytes(content);
  };
  put(
    "[Content_Types].xml",
    xml(
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>${deck.slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("")}<Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/>${deck.slides.map((_, i) => `<Override PartName="/ppt/notesSlides/notesSlide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>`).join("")}</Types>`
    )
  );
  put(
    "_rels/.rels",
    xml(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`
    )
  );
  put(
    "docProps/core.xml",
    xml(
      `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${esc(deck.title)}</dc:title><dc:creator>Kosmora</dc:creator></cp:coreProperties>`
    )
  );
  put(
    "ppt/presentation.xml",
    xml(
      `<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:notesMasterIdLst><p:notesMasterId r:id="rId${deck.slides.length + 2}"/></p:notesMasterIdLst><p:sldIdLst>${deck.slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join("")}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`
    )
  );
  put(
    "ppt/_rels/presentation.xml.rels",
    rels([
      { id: 1, type: "slideMaster", target: "slideMasters/slideMaster1.xml" },
      ...deck.slides.map((_, i) => ({
        id: i + 2,
        type: "slide",
        target: `slides/slide${i + 1}.xml`
      })),
      { id: deck.slides.length + 2, type: "notesMaster", target: "notesMasters/notesMaster1.xml" }
    ])
  );
  put(
    "ppt/slideMasters/slideMaster1.xml",
    xml(
      `<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`
    )
  );
  put(
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    rels([
      { id: 1, type: "slideLayout", target: "../slideLayouts/slideLayout1.xml" },
      { id: 2, type: "theme", target: "../theme/theme1.xml" }
    ])
  );
  put(
    "ppt/slideLayouts/slideLayout1.xml",
    xml(
      `<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`
    )
  );
  put(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    rels([{ id: 1, type: "slideMaster", target: "../slideMasters/slideMaster1.xml" }])
  );
  put(
    "ppt/theme/theme1.xml",
    xml(
      `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Kosmora"><a:themeElements><a:clrScheme name="Kosmora"><a:dk1><a:srgbClr val="1D1D1D"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="181818"/></a:dk2><a:lt2><a:srgbClr val="FAFAFA"/></a:lt2>${["333333", "555555", "777777", "999999", "BBBBBB", "DDDDDD"].map((color, i) => `<a:accent${i + 1}><a:srgbClr val="${color}"/></a:accent${i + 1}>`).join("")}<a:hlink><a:srgbClr val="333333"/></a:hlink><a:folHlink><a:srgbClr val="999999"/></a:folHlink></a:clrScheme><a:fontScheme name="Kosmora"><a:majorFont><a:latin typeface="Aptos Display"/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/></a:minorFont></a:fontScheme><a:fmtScheme name="Kosmora"><a:fillStyleLst><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`
    )
  );
  put(
    "ppt/notesMasters/notesMaster1.xml",
    xml(
      `<p:notesMaster ${namespaces}><p:cSld><p:spTree>${group}${notesImage}${notesBody("")}</p:spTree></p:cSld><p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"/><p:notesStyle/></p:notesMaster>`
    )
  );
  put(
    "ppt/notesMasters/_rels/notesMaster1.xml.rels",
    rels([{ id: 1, type: "theme", target: "../theme/theme1.xml" }])
  );
  deck.slides.forEach((slide, i) => {
    put(`ppt/slides/slide${i + 1}.xml`, slideXml(slide, i, deck.theme));
    put(
      `ppt/slides/_rels/slide${i + 1}.xml.rels`,
      rels([
        { id: 1, type: "slideLayout", target: "../slideLayouts/slideLayout1.xml" },
        { id: 2, type: "notesSlide", target: `../notesSlides/notesSlide${i + 1}.xml` }
      ])
    );
    put(
      `ppt/notesSlides/notesSlide${i + 1}.xml`,
      xml(
        `<p:notes ${namespaces}><p:cSld><p:spTree>${group}${notesImage}${notesBody(slide.notes)}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`
      )
    );
    put(
      `ppt/notesSlides/_rels/notesSlide${i + 1}.xml.rels`,
      rels([
        { id: 1, type: "notesMaster", target: "../notesMasters/notesMaster1.xml" },
        { id: 2, type: "slide", target: `../slides/slide${i + 1}.xml` }
      ])
    );
  });
  return zipSync(entries, { level: 6 });
}
