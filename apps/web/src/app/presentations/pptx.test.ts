import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { strFromU8, unzipSync } from "fflate";
import { createPptx } from "./pptx";
import { slideOverflow, type Slide } from "./model";

const slide: Slide = {
  id: "one",
  layout: "title",
  title: "Проект & план",
  body: "Отчёт <2026>",
  aside: "",
  notes: "Скрытая заметка"
};
describe("editable PPTX export", () => {
  it("packages slides, relationships, escaped text and the selected theme", () => {
    const pptx = createPptx({
      title: "Демо",
      theme: "ocean",
      slides: [
        slide,
        {
          ...slide,
          id: "two",
          layout: "two-column",
          title: "Итоги",
          body: "Слева",
          aside: "Справа"
        }
      ]
    });
    if (process.env.KOSMORA_PPTX_FIXTURE) writeFileSync(process.env.KOSMORA_PPTX_FIXTURE, pptx);
    const zip = unzipSync(pptx);
    const content = (name: string) => strFromU8(zip[name]!);
    expect(Object.keys(zip)).toContain("ppt/slides/slide2.xml");
    expect(content("ppt/presentation.xml")).toContain('r:id="rId3"');
    expect(content("ppt/slides/slide1.xml")).toContain("Проект &amp; план");
    expect(content("ppt/slides/slide1.xml")).toContain("Отчёт &lt;2026&gt;");
    expect(content("ppt/slides/slide2.xml")).toContain("Справа");
    expect(content("ppt/slides/slide1.xml")).toContain('val="E9E9E9"');
    expect(content("ppt/slides/slide1.xml")).not.toContain("Скрытая заметка");
  });
  it("blocks text that cannot fit on the slide", () => {
    const overflowing = { ...slide, body: "Длинный текст ".repeat(100) };
    expect(slideOverflow(overflowing)).toContain("основной текст");
    expect(() => createPptx({ title: "Демо", theme: "paper", slides: [overflowing] })).toThrow(
      "OVERFLOW:1"
    );
  });
});
