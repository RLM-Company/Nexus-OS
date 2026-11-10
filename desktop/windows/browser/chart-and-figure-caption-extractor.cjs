"use strict";

const { extractVerifiableExcerpt } = require("./document.cjs");

/**
 * Koswork Accessible SVG / `<figure>` / `<figcaption>` & Chart Data Extractor
 * (`desktop/windows/browser/chart-and-figure-caption-extractor.cjs`).
 *
 * Deepens Requirement #3:
 * - Extracts structured benchmark captions and series labels from `<figure>` / `<figcaption>`,
 *   inline `<svg>` (`<title>`, `<desc>`, `<text>`), and `<img alt="..." aria-label="...">`
 *   chart blocks on technical pages.
 * - Binds every extracted figure/chart caption to its exact UTF-16 code unit span
 *   `[startUtf16, endUtf16]` in `snapshot.fullTextUtf16` when rendered in visible text.
 */
function extractFiguresAndSvgCharts(snapshot, rawHtml = "") {
  if (!snapshot || typeof snapshot.fullTextUtf16 !== "string") {
    throw new Error("FIGURE_EXTRACTOR_REQUIRES_SNAPSHOT");
  }

  const figures = [];
  const html = String(rawHtml || "");

  // 1. Extract `<figure> ... <figcaption>...</figcaption> ... </figure>` blocks
  const figRegex = /<figure\b[^>]*>([\s\S]*?)<\/figure>/gi;
  let m;
  while ((m = figRegex.exec(html)) !== null) {
    const inner = m[1];
    const capMatch = inner.match(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i);
    const captionText = capMatch
      ? capMatch[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
      : "";

    const svgTitleMatch = inner.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    const svgDescMatch = inner.match(/<desc\b[^>]*>([\s\S]*?)<\/desc>/i);
    const imgAltMatch = inner.match(/\balt=["']([^"']+)["']/i);

    const svgTexts = [];
    const textRegex = /<text\b[^>]*>([\s\S]*?)<\/text>/gi;
    let tm;
    while ((tm = textRegex.exec(inner)) !== null) {
      const t = tm[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (t) svgTexts.push(t);
    }

    const searchPhrase =
      captionText ||
      (svgDescMatch ? svgDescMatch[1].trim() : "") ||
      (svgTitleMatch ? svgTitleMatch[1].trim() : "");
    const excerpt = searchPhrase
      ? extractVerifiableExcerpt(snapshot, { searchTerm: searchPhrase })
      : null;

    figures.push({
      figureIndex: figures.length + 1,
      kind: inner.toLowerCase().includes("<svg") ? "svg_chart_figure" : "html_figure",
      captionText: captionText || null,
      svgTitle: svgTitleMatch ? svgTitleMatch[1].trim() : null,
      svgDescription: svgDescMatch ? svgDescMatch[1].trim() : null,
      imageAlt: imgAltMatch ? imgAltMatch[1].trim() : null,
      svgDataLabels: svgTexts,
      excerpt
    });
  }

  return {
    url: snapshot.url,
    pageVersion: snapshot.pageVersion,
    figuresCount: figures.length,
    figures
  };
}

module.exports = {
  extractFiguresAndSvgCharts
};
