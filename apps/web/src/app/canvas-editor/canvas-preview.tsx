import ReactMarkdown from "react-markdown";
import { createElement } from "react";
import type { CanvasFormat } from "@cosmora/contracts";

/** Imported HTML and Markdown resources remain inert inside the application origin. */
export function CanvasPreview({ content, format }: { content: string; format: CanvasFormat }) {
  return format === "markdown"
    ? createElement(ReactMarkdown, {
        skipHtml: true,
        components: {
          a: ({ children }) => createElement("span", null, children),
          img: ({ alt }) => createElement("span", null, alt ?? "[изображение]")
        },
        children: content
      })
    : createElement("pre", null, content);
}
