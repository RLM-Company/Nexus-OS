import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CanvasComparison, type CanvasComparisonSide } from "./canvas-comparison";

describe("Canvas literal comparison display", () => {
  const side: CanvasComparisonSide = {
    label: "v1",
    title: "<img src=https://invalid.test>",
    format: "html",
    content: "<script>bad()</script>\r\n"
  };
  it("renders all titles/code as inert text with explicit line ending markers", () => {
    const html = renderToStaticMarkup(
      createElement(CanvasComparison, {
        before: side,
        after: { ...side, label: "v2", content: "<img src=https://invalid.test>\n" }
      })
    );
    expect(html).not.toMatch(/<(?:img|script|iframe|a)\b/);
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img src=");
    expect(html).toContain("CRLF");
    expect(html).toContain("LF");
    expect(html).toContain("Добавлено строк: 1; удалено строк: 1.");
  });
  it("separates title/format changes from identical body content", () => {
    const html = renderToStaticMarkup(
      createElement(CanvasComparison, {
        before: side,
        after: { ...side, title: "Renamed", format: "text" }
      })
    );
    expect(html).toContain("Содержимое совпадает побайтно.");
    expect(html).toContain("Renamed");
    expect(html).toContain("html");
    expect(html).toContain("text");
  });
  it("clearly reports the comparison boundary instead of a partial diff", () => {
    const html = renderToStaticMarkup(
      createElement(CanvasComparison, {
        before: side,
        after: { ...side, content: "x".repeat(300000) }
      })
    );
    expect(html).toContain("превышает лимит");
    expect(html).not.toContain("Изменения по строкам");
    expect(html).not.toContain("Содержимое совпадает");
  });
});
