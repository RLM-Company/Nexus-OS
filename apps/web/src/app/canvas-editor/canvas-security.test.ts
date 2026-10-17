import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CanvasPreview } from "./canvas-preview";
import { canvasDraftKey, parseCanvasDraft, type CanvasDraft } from "./canvas-draft-storage";

describe("Canvas resource-inert preview", () => {
  it("renders HTML and code as escaped text, including scripts and resource tags", () => {
    const content =
      '<script>fetch("https://evil.invalid")</script><img src="https://evil.invalid/x">';
    for (const format of ["html", "code", "text"] as const) {
      const output = renderToStaticMarkup(createElement(CanvasPreview, { content, format }));
      expect(output).toContain("&lt;script&gt;");
      expect(output).toContain("&lt;img");
      expect(output).not.toMatch(/<(script|img|iframe|a)\b/);
    }
  });
  it("preserves Markdown formatting but emits no active links, images or raw HTML", () => {
    const content = [
      "# Heading",
      "[external](https://evil.invalid)",
      "![picture](https://evil.invalid/track.png)",
      "[unsafe](javascript:alert(1))",
      '<script>alert(1)</script><img src="https://evil.invalid">',
      "```html\n<iframe src='https://evil.invalid'></iframe>\n```"
    ].join("\n\n");
    const output = renderToStaticMarkup(
      createElement(CanvasPreview, { content, format: "markdown" })
    );
    expect(output).toContain("<h1>Heading</h1>");
    expect(output).toContain("<span>external</span>");
    expect(output).toContain("<span>picture</span>");
    expect(output).toContain("&lt;iframe");
    expect(output).not.toMatch(/<(a|img|script|iframe)\b/);
    expect(output).not.toMatch(/<[^>]*\b(href|src)=/);
  });
});

describe("Canvas browser draft validation and owner namespaces", () => {
  it("retains an unresolved creation ID across draft restore and refuses malformed IDs", () => {
    const draft = {
      title: "Pending",
      format: "text",
      content: "saved draft",
      baseVersion: 0,
      createRequestId: "12345678-1234-1234-1234-123456789abc"
    };
    expect(parseCanvasDraft(JSON.stringify(draft), 0)).toEqual(draft);
    expect(
      parseCanvasDraft(JSON.stringify({ ...draft, createRequestId: "bad\nidentifier" }), 0)
    ).toBeNull();
  });
  const draft: CanvasDraft = {
    title: "Title",
    format: "markdown",
    content: "private",
    baseVersion: 2
  };
  it("isolates keys by owner, project and artifact without ambiguous delimiters", () => {
    expect(canvasDraftKey("owner-a", "p", "id")).not.toBe(canvasDraftKey("owner-b", "p", "id"));
    expect(canvasDraftKey("owner-a", "p", "id")).not.toBe(canvasDraftKey("owner-a", "q", "id"));
    expect(canvasDraftKey("a:b", "c", "id")).not.toBe(canvasDraftKey("a", "b:c", "id"));
  });
  it("recovers a stale draft for conflict review and rejects drafts from a future version", () => {
    expect(parseCanvasDraft(JSON.stringify(draft), 3)).toEqual(draft);
    expect(parseCanvasDraft(JSON.stringify(draft), 1)).toBeNull();
    expect(parseCanvasDraft(JSON.stringify({ ...draft, baseVersion: 0 }), 0)?.content).toBe(
      "private"
    );
  });
  it("rejects corrupt or oversized UTF-8 data and unsupported formats", () => {
    for (const value of [
      "not json",
      JSON.stringify({ ...draft, content: "🚀".repeat(131073) }),
      JSON.stringify({ ...draft, title: "Ж".repeat(121) }),
      JSON.stringify({ ...draft, title: "bad\nheader" }),
      JSON.stringify({ ...draft, content: "a\0b" }),
      JSON.stringify({ ...draft, format: "javascript" }),
      JSON.stringify({ ...draft, baseVersion: -1 }),
      JSON.stringify({ ...draft, baseVersion: 1.5 })
    ])
      expect(parseCanvasDraft(value, 3)).toBeNull();
  });
});
