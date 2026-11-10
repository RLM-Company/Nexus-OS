"use strict";

const crypto = require("node:crypto");
const { collectPiercedInteractiveSnapshot } = require("./shadow-and-frame-piercer.cjs");
const { canonicalizeSourceUrl } = require("./provenance-journal.cjs");
const { sanitizeWebDocumentAndStripHiddenPromptTraps } = require("./content-sanitizer.cjs");

/**
 * Koswork Browser Document Snapshotter & Long/Dynamic Page Reader (`desktop/windows/browser/document.cjs`).
 *
 * Preserves and extends existing browser document invariants:
 * - Versioned pages (`pageVersion`, `snapshotId`, `contentSha256`)
 * - Exact UTF-16 code unit offsets (`startUtf16`, `endUtf16`, `lengthUtf16`) into `fullTextUtf16`
 * - Element bounding boxes (`bounds: { x, y, width, height, inViewport }`)
 * - Recovery candidates metadata (`recoveryAnchors`)
 * - Same-origin frames and open Shadow DOM scope (`scope: { framePath, shadowPath, origin }`)
 * - Stable tab receipts (`tabReceipt`)
 * - Distinct temporal metadata (`pageDate`, `eventDate`, `fetchedAt`) including Russian/English textual dates
 * - Structured HTML `<table>` and `<dl>` extraction with UTF-16 offsets
 * - Hidden DOM prompt-trap & Unicode steganography sanitization (`securityAdvisories`)
 * - Progressive long-page window reading (`readLongPageWindow`) & dynamic DOM updates
 */

const RU_MONTHS = Object.freeze({
  января: "01",
  январь: "01",
  февраля: "02",
  февраль: "02",
  марта: "03",
  март: "03",
  апреля: "04",
  апрель: "04",
  мая: "05",
  май: "05",
  июня: "06",
  июнь: "06",
  июля: "07",
  июль: "07",
  августа: "08",
  август: "08",
  сентября: "09",
  сентябрь: "09",
  октября: "10",
  октябрь: "10",
  ноября: "11",
  ноябрь: "11",
  декабря: "12",
  декабрь: "12"
});

function stripHtmlTagsPreservingBlocks(html) {
  const raw = String(html || "");
  if (!raw.includes("<")) {
    return raw.replace(/\r\n/g, "\n").trim();
  }
  const withoutScripts = raw
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");

  const withBreaks = withoutScripts
    .replace(/<\/(p|div|section|article|header|footer|h[1-6]|li|tr|blockquote|dd)>/gi, "\n\n")
    .replace(/<\/(td|th|dt)>/gi, " | ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  return decodeHtmlEntities(withBreaks)
    .replace(/[ \t]+/g, " ")
    .replace(/(?:\s*\|\s*)+(\n|$)/g, "$1")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeHtmlEntities(text) {
  return String(text || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function normalizeDateCandidate(rawValue) {
  if (!rawValue) return null;
  const trimmed = String(rawValue).trim();
  if (!trimmed) return null;

  const isoMatch = trimmed.match(
    /\b(\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?)\b/
  );
  if (isoMatch) {
    return isoMatch[1];
  }

  const dotMatch = trimmed.match(/\b(\d{2})\.(\d{2})\.(\d{4})\b/);
  if (dotMatch) {
    return `${dotMatch[3]}-${dotMatch[2]}-${dotMatch[1]}`;
  }

  // Russian day + month + year: e.g. "7 ноября 2026" or "15 октября 2026 г."
  const ruFullMatch = trimmed.match(
    /\b(\d{1,2})\s+(январ[ья]|феврал[ья]|март[а]?|апрел[ья]|ма[йя]|июн[ья]|июл[ья]|август[а]?|сентябр[ья]|октябр[ья]|ноябр[ья]|декабр[ья])\s+(\d{4})\b/i
  );
  if (ruFullMatch) {
    const day = String(ruFullMatch[1]).padStart(2, "0");
    const month = RU_MONTHS[ruFullMatch[2].toLowerCase()];
    const year = ruFullMatch[3];
    if (month) return `${year}-${month}-${day}`;
  }

  // Russian month + year: e.g. "Май 2025"
  const ruMonthYearMatch = trimmed.match(
    /\b(январ[ья]|феврал[ья]|март[а]?|апрел[ья]|ма[йя]|июн[ья]|июл[ья]|август[а]?|сентябр[ья]|октябр[ья]|ноябр[ья]|декабр[ья])\s+(\d{4})\b/i
  );
  if (ruMonthYearMatch) {
    const month = RU_MONTHS[ruMonthYearMatch[1].toLowerCase()];
    const year = ruMonthYearMatch[2];
    if (month) return `${year}-${month}-01`;
  }

  return null;
}

/**
 * Extracts distinct `pageDate` (when the page/article was published or updated),
 * `eventDate` (when the described event/fact occurred or takes effect),
 * and `fetchedAt` (when Koswork retrieved the page).
 * Never merges these three fields into one.
 */
function extractTemporalMetadata(input = {}, fetchedAtIso = null) {
  const fetchedAt = fetchedAtIso || input.fetchedAt || new Date().toISOString();
  const html = String(input.html || "");
  const text = String(input.text || input.fullTextUtf16 || "");

  let pageDate = normalizeDateCandidate(input.pageDate);
  let eventDate = normalizeDateCandidate(input.eventDate);

  if (!pageDate && html) {
    const metaPub =
      html.match(
        /<meta[^>]+(?:property|name)=["'](?:article:published_time|article:modified_time|pubdate|date|dc\.date)["'][^>]+content=["']([^"']+)["']/i
      ) ||
      html.match(
        /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:article:published_time|article:modified_time|pubdate|date|dc\.date)["']/i
      ) ||
      html.match(
        /<time[^>]+(?:data-page-date|itemprop=["']datePublished["'])[^>]*datetime=["']([^"']+)["']/i
      ) ||
      html.match(/"datePublished"\s*:\s*"([^"]+)"/i);
    if (metaPub) {
      pageDate = normalizeDateCandidate(metaPub[1]);
    }
  }

  if (!pageDate && text) {
    const textPub = text.match(
      /(?:Дата публикации|Дата на странице|Опубликовано|Обновлено на странице|Published|Page updated)\s*:\s*([^\n.;]+)/i
    );
    if (textPub) {
      pageDate = normalizeDateCandidate(textPub[1]);
    }
  }

  if (!eventDate && html) {
    const metaEvent =
      html.match(
        /<meta[^>]+(?:property|name)=["'](?:event:date|event_date|effective_date)["'][^>]+content=["']([^"']+)["']/i
      ) ||
      html.match(
        /<time[^>]+(?:data-event-date|itemprop=["']startDate["'])[^>]*datetime=["']([^"']+)["']/i
      ) ||
      html.match(/"(?:eventDate|startDate|effectiveDate)"\s*:\s*"([^"]+)"/i);
    if (metaEvent) {
      eventDate = normalizeDateCandidate(metaEvent[1]);
    }
  }

  if (!eventDate && text) {
    const textEv = text.match(
      /(?:Дата события|Дата вступления в силу|Состояние на|Event date|Effective date)\s*:\s*([^\n.;]+)/i
    );
    if (textEv) {
      eventDate = normalizeDateCandidate(textEv[1]);
    }
  }

  return {
    pageDate: pageDate || null,
    eventDate: eventDate || null,
    fetchedAt
  };
}

function extractTitleFromInput(input = {}) {
  if (input.title && String(input.title).trim()) {
    return String(input.title).trim();
  }
  const html = String(input.html || "");
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (match) {
    return decodeHtmlEntities(match[1]).replace(/\s+/g, " ").trim();
  }
  return String(input.url || "untitled");
}

function parseHtmlControls(html, baseOrigin) {
  const raw = String(html || "");
  const controls = [];
  const tagRegex =
    /<(input|textarea|select|button|a)\b([^>]*)>([\s\S]*?)<\/\1>|<(input)\b([^>]*)\/?>/gi;
  let match;
  let index = 0;

  while ((match = tagRegex.exec(raw)) !== null) {
    const tag = String(match[1] || match[4] || "").toLowerCase();
    const attrText = String(match[2] || match[5] || "");
    const innerHtml = String(match[3] || "");

    const getAttr = (name) => {
      const m = attrText.match(new RegExp(`\\b${name}=["']([^"']*)["']`, "i"));
      return m ? decodeHtmlEntities(m[1]) : null;
    };

    const id = getAttr("id") || `${tag}-${index + 1}`;
    const name = getAttr("name") || null;
    const type =
      getAttr("type") ||
      (tag === "button" ? "submit" : tag === "a" ? "link" : tag === "select" ? "select-one" : "text");
    const role =
      getAttr("role") ||
      (tag === "a" ? "link" : tag === "button" ? "button" : tag === "select" ? "combobox" : "textbox");
    const label =
      getAttr("aria-label") ||
      getAttr("placeholder") ||
      stripHtmlTagsPreservingBlocks(innerHtml) ||
      name ||
      id;

    let value = getAttr("value") ?? "";
    let options = undefined;
    if (tag === "select") {
      options = [];
      const optRegex = /<option\b([^>]*)>([\s\S]*?)<\/option>/gi;
      let optMatch;
      while ((optMatch = optRegex.exec(innerHtml)) !== null) {
        const optAttrs = optMatch[1] || "";
        const optText = stripHtmlTagsPreservingBlocks(optMatch[2]);
        const valMatch = optAttrs.match(/\bvalue=["']([^"']*)["']/i);
        const optVal = valMatch ? decodeHtmlEntities(valMatch[1]) : optText;
        const selected = /\bselected\b/i.test(optAttrs);
        options.push({ value: optVal, label: optText, selected });
        if (selected && !value) value = optVal;
      }
      if (!value && options.length > 0) {
        value = options[0].value;
      }
    }

    const href = getAttr("href") || null;
    const download = getAttr("download") || null;
    const disabled = /\bdisabled\b/i.test(attrText);
    const checked =
      type.toLowerCase() === "checkbox" || type.toLowerCase() === "radio"
        ? /\bchecked\b/i.test(attrText)
        : undefined;

    controls.push({
      id,
      name,
      tag,
      type: type.toLowerCase(),
      role: role.toLowerCase(),
      label: String(label).slice(0, 160),
      value,
      options,
      checked,
      href,
      download,
      disabled,
      deepSelector: id
        ? `${tag}#${id}`
        : name
          ? `${tag}[name="${name}"]`
          : `${tag}:nth-of-type(${index + 1})`,
      scope: {
        framePath: [],
        shadowPath: [],
        origin: baseOrigin
      },
      bounds: {
        x: 24,
        y: 80 + index * 44,
        width: 280,
        height: 36,
        inViewport: index < 15
      }
    });
    index += 1;
  }

  return controls;
}

/**
 * Extracts structured HTML `<table>` matrices and `<dl>` definition lists from `html` and binds
 * every row/cell to its UTF-16 code unit offsets inside `fullTextUtf16`.
 */
function extractStructuredTablesWithUtf16Offsets(html, fullTextUtf16) {
  const raw = String(html || "");
  const fullText = String(fullTextUtf16 || "");
  if (!raw || !/<table\b/i.test(raw)) return [];

  const tables = [];
  const tableRegex = /<table\b([^>]*)>([\s\S]*?)<\/table>/gi;
  let tMatch;
  let tableIdx = 0;

  while ((tMatch = tableRegex.exec(raw)) !== null) {
    tableIdx += 1;
    const tableAttrs = tMatch[1] || "";
    const tableBody = tMatch[2] || "";
    const idMatch = tableAttrs.match(/\bid=["']([^"']+)["']/i);
    const tableId = idMatch ? idMatch[1] : `table-${tableIdx}`;

    const headers = [];
    const rows = [];
    const trRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let trMatch;
    let searchCursor = 0;

    while ((trMatch = trRegex.exec(tableBody)) !== null) {
      const trHtml = trMatch[1];
      const cellRegex = /<(th|td)\b[^>]*>([\s\S]*?)<\/\1>/gi;
      let cMatch;
      const cells = [];
      let isHeaderRow = false;

      while ((cMatch = cellRegex.exec(trHtml)) !== null) {
        const cellTag = cMatch[1].toLowerCase();
        if (cellTag === "th") isHeaderRow = true;
        const cellText = stripHtmlTagsPreservingBlocks(cMatch[2]);
        let startUtf16 = -1;
        let endUtf16 = -1;
        if (cellText) {
          const foundIdx = fullText.indexOf(cellText, searchCursor);
          const fallbackIdx = foundIdx !== -1 ? foundIdx : fullText.indexOf(cellText);
          if (fallbackIdx !== -1) {
            startUtf16 = fallbackIdx;
            endUtf16 = fallbackIdx + cellText.length;
            searchCursor = endUtf16;
          }
        }
        cells.push({
          text: cellText,
          startUtf16,
          endUtf16
        });
      }

      if (cells.length > 0) {
        if (isHeaderRow && headers.length === 0) {
          headers.push(...cells.map((c) => c.text));
        } else {
          const rowText = cells.map((c) => c.text).join(" | ");
          const rowStart = cells[0].startUtf16;
          const rowEnd = cells[cells.length - 1].endUtf16;
          rows.push({
            cells,
            rowText,
            startUtf16: rowStart,
            endUtf16: rowEnd
          });
        }
      }
    }

    tables.push({
      tableId,
      headers,
      rows
    });
  }

  return tables;
}

/**
 * Builds a versioned document snapshot with exact UTF-16 code unit offsets,
 * element bounds, recovery anchors, frame/shadow scope, and distinct temporal fields.
 */
function buildVersionedPageSnapshot(input = {}) {
  const tabId = String(input.tabId || "tab-1");
  const pageVersion = Math.max(1, Number(input.pageVersion || 1));
  const url = String(input.url || "about:blank");
  const canonicalUrl = canonicalizeSourceUrl(input.canonicalUrl || url);
  const httpStatus = Number(input.httpStatus ?? 200);

  // Sanitize untrusted web HTML and text before extracting visible text blocks & UTF-16 offsets
  const sanitized = sanitizeWebDocumentAndStripHiddenPromptTraps({
    html: input.html,
    text: input.text
  });
  const sanitizedInput = {
    ...input,
    html: sanitized.sanitizedHtml,
    text: sanitized.sanitizedText
  };

  const title = extractTitleFromInput(sanitizedInput);

  let baseOrigin = "https://local.koswork";
  try {
    baseOrigin = new URL(url).origin;
  } catch {
    baseOrigin = "https://local.koswork";
  }

  const temporal = extractTemporalMetadata(sanitizedInput, input.fetchedAt);

  // Collect blocks from structured input, HTML, or plain text + frame/shadow scopes
  const rawParagraphs = [];
  if (Array.isArray(input.blocks) && input.blocks.length > 0) {
    for (const blk of input.blocks) {
      if (typeof blk === "string") {
        rawParagraphs.push({
          text: blk,
          scope: { framePath: [], shadowPath: [], origin: baseOrigin }
        });
      } else if (blk && typeof blk.text === "string") {
        rawParagraphs.push({
          id: blk.id || null,
          tag: blk.tag || "p",
          role: blk.role || "paragraph",
          text: blk.text,
          bounds: blk.bounds || null,
          scope: blk.scope || { framePath: [], shadowPath: [], origin: baseOrigin }
        });
      }
    }
  } else {
    const baseText =
      typeof sanitizedInput.text === "string" && sanitizedInput.text.length > 0
        ? sanitizedInput.text
        : stripHtmlTagsPreservingBlocks(sanitizedInput.html || "");
    const splitParts = baseText
      .split(/\n{2,}/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const part of splitParts) {
      rawParagraphs.push({
        tag: /^#+\s/.test(part) ? "h2" : "p",
        role: /^#+\s/.test(part) ? "heading" : "paragraph",
        text: part,
        scope: { framePath: [], shadowPath: [], origin: baseOrigin }
      });
    }
  }

  // Also include same-origin frame / open shadow root text blocks if provided
  const skippedCrossOriginFrames = [];
  if (Array.isArray(input.frames)) {
    for (let fIdx = 0; fIdx < input.frames.length; fIdx++) {
      const frame = input.frames[fIdx];
      const frameSrc = String(frame.src || frame.url || "");
      let sameOrigin = true;
      if (frameSrc && /^https?:\/\//i.test(frameSrc)) {
        try {
          sameOrigin = new URL(frameSrc).origin === baseOrigin;
        } catch {
          sameOrigin = false;
        }
      }
      const frameSelector = frame.id ? `iframe#${frame.id}` : `iframe:nth-of-type(${fIdx + 1})`;
      if (!sameOrigin) {
        skippedCrossOriginFrames.push({
          frameSelector,
          src: frameSrc,
          reason: "cross_origin_isolated"
        });
        continue;
      }
      const frameText = stripHtmlTagsPreservingBlocks(frame.text || frame.html || "");
      if (frameText) {
        rawParagraphs.push({
          id: frame.id ? `frame-block-${frame.id}` : `frame-block-${fIdx + 1}`,
          tag: "section",
          role: "region",
          text: frameText,
          scope: {
            framePath: [frameSelector],
            shadowPath: [],
            origin: baseOrigin
          }
        });
      }
    }
  }

  if (Array.isArray(input.shadowRoots)) {
    for (let sIdx = 0; sIdx < input.shadowRoots.length; sIdx++) {
      const sr = input.shadowRoots[sIdx];
      if (sr.mode && sr.mode !== "open") continue;
      const hostSelector = sr.hostSelector || `shadow-host-${sIdx + 1}`;
      const shadowText = stripHtmlTagsPreservingBlocks(sr.text || sr.html || "");
      if (shadowText) {
        rawParagraphs.push({
          id: `shadow-block-${sIdx + 1}`,
          tag: "div",
          role: "region",
          text: shadowText,
          scope: {
            framePath: Array.isArray(sr.framePath) ? sr.framePath : [],
            shadowPath: [hostSelector],
            origin: baseOrigin
          }
        });
      }
    }
  }

  // Compute exact UTF-16 code unit offsets (`startUtf16`, `endUtf16`, `lengthUtf16`)
  const blocks = [];
  let fullTextUtf16 = "";
  let currentY = 48;

  for (let i = 0; i < rawParagraphs.length; i++) {
    const rawBlk = rawParagraphs[i];
    const cleanText = String(rawBlk.text || "").trim();
    if (!cleanText) continue;

    if (fullTextUtf16.length > 0) {
      fullTextUtf16 += "\n\n";
    }
    const startUtf16 = fullTextUtf16.length;
    fullTextUtf16 += cleanText;
    const endUtf16 = fullTextUtf16.length;
    const lengthUtf16 = endUtf16 - startUtf16;

    const estimatedLines = Math.max(1, Math.ceil(lengthUtf16 / 80));
    const height = estimatedLines * 22;
    const bounds = rawBlk.bounds || {
      x: 24,
      y: currentY,
      width: 760,
      height,
      inViewport: currentY < 900
    };
    currentY += height + 16;

    const blockId = rawBlk.id || `blk-${i + 1}`;
    const textHash = crypto.createHash("sha256").update(cleanText, "utf8").digest("hex").slice(0, 16);
    const surroundingPrefix = fullTextUtf16.slice(Math.max(0, startUtf16 - 48), startUtf16).trim();

    blocks.push({
      blockId,
      index: i,
      tag: String(rawBlk.tag || "p").toLowerCase(),
      role: String(rawBlk.role || "paragraph").toLowerCase(),
      text: cleanText,
      startUtf16,
      endUtf16,
      lengthUtf16,
      bounds,
      scope: {
        framePath: rawBlk.scope?.framePath || [],
        shadowPath: rawBlk.scope?.shadowPath || [],
        origin: rawBlk.scope?.origin || baseOrigin
      },
      recoveryAnchors: {
        blockId,
        tag: String(rawBlk.tag || "p").toLowerCase(),
        role: String(rawBlk.role || "paragraph").toLowerCase(),
        textHash,
        prefixPreview: cleanText.slice(0, 64),
        surroundingPrefix,
        deepSelector:
          (rawBlk.scope?.framePath?.length ? `${rawBlk.scope.framePath.join(" >> ")} >> ` : "") +
          (rawBlk.scope?.shadowPath?.length
            ? `shadow[${rawBlk.scope.shadowPath.join(" >> ")}] >> `
            : "") +
          `${String(rawBlk.tag || "p").toLowerCase()}#${blockId}`
      }
    });
  }

  // Interactive controls (from explicit input.controls, rootNode DOM piercer, or HTML parser)
  let controls = [];
  if (Array.isArray(input.controls) && input.controls.length > 0) {
    controls = input.controls.map((ctrl, idx) => ({
      id: String(ctrl.id || `ctrl-${idx + 1}`),
      name: ctrl.name || null,
      tag: String(ctrl.tag || "input").toLowerCase(),
      type: String(ctrl.type || "text").toLowerCase(),
      role: String(ctrl.role || "textbox").toLowerCase(),
      label: String(ctrl.label || ctrl.text || ctrl.id || "").trim(),
      value: String(ctrl.value ?? ""),
      options: Array.isArray(ctrl.options) ? ctrl.options : undefined,
      href: ctrl.href || null,
      download: ctrl.download || null,
      disabled: Boolean(ctrl.disabled),
      checked: ctrl.checked !== undefined ? Boolean(ctrl.checked) : undefined,
      deepSelector: String(
        ctrl.deepSelector || `${ctrl.tag || "input"}#${ctrl.id || `ctrl-${idx + 1}`}`
      ),
      scope: ctrl.scope || { framePath: [], shadowPath: [], origin: baseOrigin },
      bounds: ctrl.bounds || {
        x: 24,
        y: currentY + idx * 42,
        width: 260,
        height: 34,
        inViewport: true
      },
      recoveryAnchors: {
        id: String(ctrl.id || `ctrl-${idx + 1}`),
        name: ctrl.name || null,
        role: String(ctrl.role || "textbox").toLowerCase(),
        label: String(ctrl.label || ctrl.text || "").trim(),
        deepSelector: String(
          ctrl.deepSelector || `${ctrl.tag || "input"}#${ctrl.id || `ctrl-${idx + 1}`}`
        )
      }
    }));
  } else if (sanitizedInput.html) {
    controls = parseHtmlControls(sanitizedInput.html, baseOrigin);
  }

  if (input.rootNode) {
    const pierced = collectPiercedInteractiveSnapshot(input.rootNode, { baseOrigin });
    skippedCrossOriginFrames.push(...pierced.skippedCrossOriginFrames);
    for (let idx = 0; idx < pierced.elements.length; idx++) {
      const el = pierced.elements[idx];
      if (!controls.some((c) => c.deepSelector === el.deepSelector)) {
        controls.push({
          id: el.id || `pierced-${idx + 1}`,
          name: null,
          tag: el.tagName,
          type: el.tagName === "button" ? "button" : "text",
          role: el.tagName === "a" ? "link" : el.tagName === "button" ? "button" : "textbox",
          label: el.label,
          value: "",
          href: null,
          download: null,
          disabled: false,
          deepSelector: el.deepSelector,
          scope: {
            framePath: el.inIframe ? ["iframe"] : [],
            shadowPath: el.inShadowDom ? ["shadow"] : [],
            origin: baseOrigin
          },
          bounds: { x: 32, y: currentY + idx * 40, width: 240, height: 32, inViewport: true },
          recoveryAnchors: {
            id: el.id || `pierced-${idx + 1}`,
            role: el.tagName,
            label: el.label,
            deepSelector: el.deepSelector
          }
        });
      }
    }
  }

  const tables = sanitizedInput.html
    ? extractStructuredTablesWithUtf16Offsets(sanitizedInput.html, fullTextUtf16)
    : Array.isArray(input.tables)
      ? input.tables
      : [];

  const canonicalPayload = JSON.stringify({
    url,
    title,
    pageVersion,
    fullTextUtf16,
    controls: controls.map((c) => ({
      id: c.id,
      value: c.value,
      disabled: c.disabled,
      checked: c.checked
    }))
  });
  const contentSha256 = crypto.createHash("sha256").update(canonicalPayload, "utf8").digest("hex");
  const snapshotId = `snap-${tabId}-v${pageVersion}-${contentSha256.slice(0, 10)}`;

  const tabReceipt = createTabReceipt({
    tabId,
    url,
    canonicalUrl,
    title,
    pageVersion,
    snapshotId,
    contentSha256,
    fetchedAt: temporal.fetchedAt
  });

  return {
    snapshotId,
    tabId,
    pageVersion,
    url,
    canonicalUrl,
    httpStatus,
    title,
    pageDate: temporal.pageDate,
    eventDate: temporal.eventDate,
    fetchedAt: temporal.fetchedAt,
    fullTextUtf16,
    totalUtf16CodeUnits: fullTextUtf16.length,
    contentSha256,
    blocks,
    tables,
    controls,
    skippedCrossOriginFrames,
    securityAdvisories: sanitized.securityAdvisories,
    tabReceipt,
    requiresLogin: Boolean(input.requiresLogin)
  };
}

function createTabReceipt(state) {
  const receiptSeed = `${state.tabId}|${state.url}|v${state.pageVersion}|${state.contentSha256}`;
  const receiptHash = crypto.createHash("sha256").update(receiptSeed, "utf8").digest("hex").slice(0, 16);
  return {
    receiptId: `rcpt-${state.tabId}-v${state.pageVersion}-${receiptHash}`,
    tabId: state.tabId,
    url: state.url,
    canonicalUrl: state.canonicalUrl || state.url,
    title: state.title || "",
    pageVersion: state.pageVersion,
    snapshotId: state.snapshotId,
    contentSha256: state.contentSha256,
    issuedAt: state.fetchedAt || new Date().toISOString()
  };
}

/**
 * Extracts a verifiable excerpt from a versioned page snapshot with exact UTF-16 code unit offsets
 * (`startUtf16`, `endUtf16`) and links it to the source metadata (`url`, `title`, `pageDate`, `eventDate`, `fetchedAt`).
 */
function extractVerifiableExcerpt(snapshot, queryOrSpan = {}) {
  if (!snapshot || typeof snapshot.fullTextUtf16 !== "string") {
    throw new Error("INVALID_PAGE_SNAPSHOT_FOR_EXCERPT");
  }
  const fullText = snapshot.fullTextUtf16;
  let startUtf16 = -1;
  let endUtf16 = -1;

  if (
    Number.isInteger(queryOrSpan.startUtf16) &&
    Number.isInteger(queryOrSpan.endUtf16) &&
    queryOrSpan.startUtf16 >= 0 &&
    queryOrSpan.endUtf16 <= fullText.length &&
    queryOrSpan.endUtf16 > queryOrSpan.startUtf16
  ) {
    startUtf16 = queryOrSpan.startUtf16;
    endUtf16 = queryOrSpan.endUtf16;
  } else if (typeof queryOrSpan.exactQuote === "string" && queryOrSpan.exactQuote.trim()) {
    const needle = queryOrSpan.exactQuote.trim();
    const idx = fullText.indexOf(needle);
    if (idx !== -1) {
      startUtf16 = idx;
      endUtf16 = idx + needle.length;
    }
  } else if (typeof queryOrSpan.searchTerm === "string" && queryOrSpan.searchTerm.trim()) {
    const needleLower = queryOrSpan.searchTerm.trim().toLowerCase();
    const idx = fullText.toLowerCase().indexOf(needleLower);
    if (idx !== -1) {
      const containingBlock = (snapshot.blocks || []).find(
        (b) => idx >= b.startUtf16 && idx < b.endUtf16
      );
      if (containingBlock) {
        startUtf16 = containingBlock.startUtf16;
        endUtf16 = containingBlock.endUtf16;
      } else {
        startUtf16 = Math.max(0, idx - 60);
        endUtf16 = Math.min(fullText.length, idx + needleLower.length + 140);
      }
    }
  }

  if (startUtf16 === -1 || endUtf16 === -1) {
    return null;
  }

  const exactText = fullText.slice(startUtf16, endUtf16);
  const matchingBlock = (snapshot.blocks || []).find(
    (b) => startUtf16 >= b.startUtf16 && endUtf16 <= b.endUtf16
  );

  const excerptHash = crypto
    .createHash("sha256")
    .update(`${snapshot.snapshotId}|${startUtf16}:${endUtf16}|${exactText}`, "utf8")
    .digest("hex")
    .slice(0, 16);

  return {
    excerptId: `exc-${excerptHash}`,
    snapshotId: snapshot.snapshotId,
    tabReceiptId: snapshot.tabReceipt?.receiptId || null,
    pageVersion: snapshot.pageVersion,
    url: snapshot.url,
    canonicalUrl: snapshot.canonicalUrl,
    title: snapshot.title,
    pageDate: snapshot.pageDate,
    eventDate: snapshot.eventDate,
    fetchedAt: snapshot.fetchedAt,
    startUtf16,
    endUtf16,
    lengthUtf16: endUtf16 - startUtf16,
    quote: exactText,
    quoteSha256: crypto.createHash("sha256").update(exactText, "utf8").digest("hex"),
    blockId: matchingBlock ? matchingBlock.blockId : null,
    bounds: matchingBlock ? matchingBlock.bounds : null,
    scope: matchingBlock
      ? matchingBlock.scope
      : { framePath: [], shadowPath: [], origin: snapshot.url }
  };
}

/**
 * Progressive long-page reader that steps through arbitrarily long documents by UTF-16 offsets
 * without losing global `startUtf16` / `endUtf16` coordinates.
 */
function readLongPageWindow(snapshot, options = {}) {
  const fullText = String(snapshot?.fullTextUtf16 || "");
  const totalUtf16 = fullText.length;
  const cursorUtf16 = Math.max(0, Math.min(Number(options.cursorUtf16 ?? 0), totalUtf16));
  const windowChars = Math.max(256, Math.min(Number(options.windowChars ?? 4000), 32000));
  const overlapChars = Math.max(
    0,
    Math.min(Number(options.overlapChars ?? 120), Math.floor(windowChars / 3))
  );

  if (totalUtf16 === 0) {
    return {
      snapshotId: snapshot?.snapshotId || null,
      pageVersion: snapshot?.pageVersion || 1,
      cursorUtf16: 0,
      endUtf16: 0,
      nextCursorUtf16: null,
      hasMore: false,
      totalUtf16CodeUnits: 0,
      progressPercent: 100,
      windowText: "",
      blocksInWindow: []
    };
  }

  let endUtf16 = Math.min(totalUtf16, cursorUtf16 + windowChars);
  // Avoid splitting surrogate pairs at window boundary
  if (endUtf16 < totalUtf16) {
    const code = fullText.charCodeAt(endUtf16 - 1);
    if (code >= 0xd800 && code <= 0xdbff) {
      endUtf16 += 1;
    }
  }

  const windowText = fullText.slice(cursorUtf16, endUtf16);
  const blocksInWindow = (snapshot.blocks || []).filter(
    (b) => b.endUtf16 > cursorUtf16 && b.startUtf16 < endUtf16
  );
  const hasMore = endUtf16 < totalUtf16;
  const nextCursorUtf16 = hasMore ? Math.max(cursorUtf16 + 1, endUtf16 - overlapChars) : null;
  const progressPercent = Number(((endUtf16 / totalUtf16) * 100).toFixed(2));

  return {
    snapshotId: snapshot.snapshotId,
    pageVersion: snapshot.pageVersion,
    url: snapshot.url,
    title: snapshot.title,
    pageDate: snapshot.pageDate,
    eventDate: snapshot.eventDate,
    fetchedAt: snapshot.fetchedAt,
    cursorUtf16,
    endUtf16,
    nextCursorUtf16,
    hasMore,
    totalUtf16CodeUnits: totalUtf16,
    progressPercent,
    windowText,
    blocksInWindow
  };
}

module.exports = {
  buildVersionedPageSnapshot,
  createTabReceipt,
  extractStructuredTablesWithUtf16Offsets,
  extractTemporalMetadata,
  extractVerifiableExcerpt,
  normalizeDateCandidate,
  readLongPageWindow,
  stripHtmlTagsPreservingBlocks
};
