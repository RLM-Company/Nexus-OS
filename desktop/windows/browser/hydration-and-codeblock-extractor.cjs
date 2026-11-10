"use strict";

const { extractVerifiableExcerpt, decodeHtmlEntities } = require("./document.cjs");

/**
 * Koswork Technical Code-Block (`<pre>/<code>`) & SSR Hydration State Extractor
 * (`desktop/windows/browser/hydration-and-codeblock-extractor.cjs`).
 *
 * Deepens Requirement #3 & #5:
 * 1. Extracts `<pre>` / `<code>` technical configuration and specification blocks from
 *    developer documentation pages with exact `[startUtf16, endUtf16]` code unit offsets
 *    in `snapshot.fullTextUtf16`.
 * 2. Extracts SSR hydration state (`<script id="__NEXT_DATA__" type="application/json">` or
 *    `<script data-hydration-state type="application/json">`) and cross-checks each extracted
 *    hydration value against the visible text in `snapshot.fullTextUtf16`:
 *    - Values present in visible text get a verified UTF-16 excerpt (`visibleInDom: true`);
 *    - Values present ONLY in hidden hydration JSON are flagged (`visibleInDom: false`,
 *      `verificationStatus: "unconfirmed_hidden_hydration_only"`) so unrendered JSON fields
 *      are never misrepresented as visible page quotes.
 */

function decodeBasicEntities(str = "") {
  if (typeof decodeHtmlEntities === "function") {
    return decodeHtmlEntities(str);
  }
  return String(str || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function extractCodeBlocksWithUtf16Offsets(snapshot, rawHtml = "") {
  if (!snapshot || typeof snapshot.fullTextUtf16 !== "string") {
    throw new Error("CODEBLOCK_EXTRACTOR_REQUIRES_SNAPSHOT");
  }

  const fullText = snapshot.fullTextUtf16;
  const blocks = [];
  const regex = /<(pre|code)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let match;
  let searchFrom = 0;

  while ((match = regex.exec(String(rawHtml || ""))) !== null) {
    const tag = match[1].toLowerCase();
    const attrs = match[2] || "";
    const innerRaw = match[3]
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+/g, " ")
      .trim();
    const cleanText = decodeBasicEntities(innerRaw).trim();
    if (!cleanText) continue;

    const langMatch = attrs.match(/\b(?:class|data-lang)=["'][^"']*?(?:language-|lang-)([a-z0-9_-]+)/i);
    const language = langMatch ? langMatch[1].toLowerCase() : "text";

    const idx = fullText.indexOf(cleanText, searchFrom);
    const startUtf16 = idx >= 0 ? idx : fullText.indexOf(cleanText);
    if (startUtf16 < 0) continue;
    const endUtf16 = startUtf16 + cleanText.length;
    if (idx >= 0) {
      searchFrom = endUtf16;
    }

    const excerpt = extractVerifiableExcerpt(snapshot, {
      startUtf16,
      endUtf16
    });

    blocks.push({
      blockIndex: blocks.length + 1,
      tag,
      language,
      startUtf16,
      endUtf16,
      lengthUtf16: endUtf16 - startUtf16,
      codeText: cleanText,
      excerpt
    });
  }

  return {
    url: snapshot.url,
    pageVersion: snapshot.pageVersion,
    codeBlocksCount: blocks.length,
    codeBlocks: blocks
  };
}

function extractAndVerifyHydrationJsonState(snapshot, rawHtml = "") {
  if (!snapshot || typeof snapshot.fullTextUtf16 !== "string") {
    throw new Error("HYDRATION_EXTRACTOR_REQUIRES_SNAPSHOT");
  }

  const scripts = [];
  const scriptRegex =
    /<script\b([^>]*type=["']application\/json["'][^>]*)>([\s\S]*?)<\/script>/gi;
  let match;

  while ((match = scriptRegex.exec(String(rawHtml || ""))) !== null) {
    const attrs = match[1] || "";
    const idMatch = attrs.match(/\bid=["']([^"']+)["']/i);
    const scriptId = idMatch ? idMatch[1] : "inline-json";
    try {
      const parsed = JSON.parse(match[2].trim());
      scripts.push({ scriptId, data: parsed });
    } catch {
      // Ignore malformed JSON script blocks safely
    }
  }

  const verifiedVisibleFacts = [];
  const hiddenOnlyHydrationFacts = [];

  const visitObject = (obj, pathPrefix = "") => {
    if (!obj || typeof obj !== "object") return;
    for (const [k, v] of Object.entries(obj)) {
      const currentPath = pathPrefix ? `${pathPrefix}.${k}` : k;
      if (typeof v === "string" || typeof v === "number") {
        const strVal = String(v).trim();
        if (!strVal || strVal.length < 2) continue;
        const exc = extractVerifiableExcerpt(snapshot, { searchTerm: strVal });
        if (exc) {
          verifiedVisibleFacts.push({
            jsonPath: currentPath,
            value: strVal,
            visibleInDom: true,
            verificationStatus: "confirmed",
            excerpt: exc
          });
        } else {
          hiddenOnlyHydrationFacts.push({
            jsonPath: currentPath,
            value: strVal,
            visibleInDom: false,
            verificationStatus: "unconfirmed_hidden_hydration_only",
            reasonRu:
              "Значение присутствует только в скрытом JSON-блоке гидратации и отсутствует в видимом тексте страницы."
          });
        }
      } else if (typeof v === "object") {
        visitObject(v, currentPath);
      }
    }
  };

  for (const s of scripts) {
    visitObject(s.data, s.scriptId);
  }

  return {
    url: snapshot.url,
    hydrationScriptsCount: scripts.length,
    verifiedVisibleCount: verifiedVisibleFacts.length,
    hiddenOnlyCount: hiddenOnlyHydrationFacts.length,
    verifiedVisibleFacts,
    hiddenOnlyHydrationFacts
  };
}

module.exports = {
  extractCodeBlocksWithUtf16Offsets,
  extractAndVerifyHydrationJsonState
};
