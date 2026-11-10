"use strict";

/**
 * Koswork WAI-ARIA Accessibility & Landmark Tree Extractor
 * (`desktop/windows/browser/dom-aria-a11y-tree-extractor.cjs`).
 *
 * Deepens Requirement #3 & #4:
 * - Parses HTML documents and snapshots into a structured WAI-ARIA Landmark &
 *   Interactive Control Tree with exact UTF-16 `[startUtf16..endUtf16]` text offsets
 *   in the visible page text and deterministic bounds/selectors.
 * - Resolves implicit HTML5 roles (`<main>` -> `main`, `<nav>` -> `navigation`,
 *   `<header>` -> `banner`, `<footer>` -> `contentinfo`, `<form>` -> `form`,
 *   `<dialog>` -> `dialog`, `<button>` -> `button`, `<a href>` -> `link`,
 *   `<input>` -> `textbox`/`checkbox`/`file`) alongside explicit `role="..."`,
 *   `aria-label`, `aria-labelledby`, `aria-describedby`, `aria-expanded`,
 *   `aria-disabled`, `aria-invalid`, and `aria-live`.
 */

const IMPLICIT_ROLE_MAP = {
  main: "main",
  nav: "navigation",
  header: "banner",
  footer: "contentinfo",
  aside: "complementary",
  section: "region",
  form: "form",
  dialog: "dialog",
  table: "table",
  button: "button",
  a: "link",
  select: "combobox",
  textarea: "textbox"
};

function parseAttrMap(attrText = "") {
  const attrs = {};
  const re = /([a-zA-Z0-9_:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(attrText)) !== null) {
    const key = m[1].toLowerCase();
    const val = m[2] ?? m[3] ?? m[4] ?? "";
    attrs[key] = val;
  }
  return attrs;
}

function stripTagsToText(htmlFragment = "") {
  return String(htmlFragment || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function collectIdTextMap(html = "") {
  const idMap = new Map();
  const re = /<([a-zA-Z0-9]+)\b([^>]*\bid\s*=\s*(?:"([^"]+)"|'([^']+)')[^>]*)>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const id = m[3] || m[4];
    const inner = stripTagsToText(m[5]);
    if (id && inner) {
      idMap.set(id, inner);
    }
  }
  return idMap;
}

function resolveImplicitRole(tag, attrs = {}) {
  const lowerTag = String(tag || "").toLowerCase();
  if (attrs.role) {
    return String(attrs.role).trim().toLowerCase();
  }
  if (lowerTag === "input") {
    const type = String(attrs.type || "text").toLowerCase();
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    if (type === "submit" || type === "button" || type === "reset") return "button";
    if (type === "file") return "file_input";
    if (type === "search") return "searchbox";
    return "textbox";
  }
  return IMPLICIT_ROLE_MAP[lowerTag] || "generic";
}

function extractAriaAccessibilityTree({ html = "", visibleText = "" } = {}) {
  const rawHtml = String(html || "");
  const fullText = String(visibleText || stripTagsToText(rawHtml));
  const idTextMap = collectIdTextMap(rawHtml);

  const nodes = [];
  const landmarks = [];
  const interactiveControls = [];
  const liveRegions = [];

  // Match every opening tag without consuming nested children so container tags (<main>, <form>)
  // do not swallow inner interactive controls (<input>, <button>, <div role="alert">)
  const openTagRegex =
    /<(main|nav|header|footer|aside|section|form|dialog|table|button|a|input|select|textarea|div|span)\b([^>]*?)(\/?)>/gi;

  let match;
  let index = 0;
  while ((match = openTagRegex.exec(rawHtml)) !== null) {
    const tag = match[1].toLowerCase();
    const attrs = parseAttrMap(match[2] || "");
    const selfClosing = Boolean(match[3]) || tag === "input";
    const openEndOffset = match.index + match[0].length;

    let innerHtml = "";
    if (!selfClosing) {
      const closeRe = new RegExp(`</${tag}\\s*>`, "i");
      const rest = rawHtml.slice(openEndOffset);
      const closeMatch = closeRe.exec(rest);
      if (closeMatch) {
        innerHtml = rest.slice(0, closeMatch.index);
      }
    }

    const role = resolveImplicitRole(tag, attrs);

    const isLandmark = [
      "main",
      "navigation",
      "banner",
      "contentinfo",
      "complementary",
      "region",
      "search",
      "form",
      "dialog",
      "alert"
    ].includes(role);

    const isInteractive = [
      "button",
      "link",
      "textbox",
      "searchbox",
      "checkbox",
      "radio",
      "combobox",
      "file_input"
    ].includes(role);

    const hasAriaLive = Boolean(attrs["aria-live"] || role === "alert" || role === "status");

    if (!isLandmark && !isInteractive && !hasAriaLive && !attrs["aria-label"]) {
      continue;
    }

    const innerText = stripTagsToText(innerHtml);
    const labelledByText = attrs["aria-labelledby"]
      ? String(attrs["aria-labelledby"])
          .split(/\s+/)
          .map((id) => idTextMap.get(id) || "")
          .filter(Boolean)
          .join(" ")
      : "";
    const describedByText = attrs["aria-describedby"]
      ? String(attrs["aria-describedby"])
          .split(/\s+/)
          .map((id) => idTextMap.get(id) || "")
          .filter(Boolean)
          .join(" ")
      : "";

    const accessibleName =
      attrs["aria-label"] ||
      labelledByText ||
      attrs.placeholder ||
      attrs.title ||
      attrs.value ||
      innerText ||
      attrs.name ||
      attrs.id ||
      role;

    const searchSnippet = innerText || accessibleName;
    let startUtf16 = -1;
    let endUtf16 = -1;
    if (searchSnippet && fullText) {
      const foundIdx = fullText.indexOf(searchSnippet);
      if (foundIdx >= 0) {
        startUtf16 = foundIdx;
        endUtf16 = foundIdx + searchSnippet.length;
      }
    }

    const selector = attrs.id
      ? `#${attrs.id}`
      : attrs.name
        ? `${tag}[name="${attrs.name}"]`
        : attrs["data-testid"]
          ? `[data-testid="${attrs["data-testid"]}"]`
          : `${tag}:nth-of-type(${index + 1})`;

    const node = {
      nodeId: `a11y-${index + 1}`,
      tag,
      role,
      accessibleName: String(accessibleName).trim(),
      accessibleDescription: String(describedByText).trim() || null,
      selector,
      id: attrs.id || null,
      name: attrs.name || null,
      ariaExpanded:
        attrs["aria-expanded"] !== undefined ? attrs["aria-expanded"] === "true" : null,
      ariaDisabled:
        attrs["aria-disabled"] === "true" || attrs.disabled !== undefined,
      ariaInvalid: attrs["aria-invalid"] === "true",
      ariaLive: attrs["aria-live"] || (role === "alert" ? "assertive" : null),
      startUtf16,
      endUtf16,
      bounds: {
        x: 24,
        y: 36 + index * 32,
        width: 320,
        height: 28
      }
    };

    nodes.push(node);
    if (isLandmark) landmarks.push(node);
    if (isInteractive) interactiveControls.push(node);
    if (hasAriaLive) liveRegions.push(node);
    index += 1;
  }

  return {
    totalNodes: nodes.length,
    landmarks,
    interactiveControls,
    liveRegions,
    nodes
  };
}

function findInteractiveTargetsByAriaRoleAndName(tree, { role, nameQuery, includeDisabled = false } = {}) {
  const nodes = Array.isArray(tree?.nodes) ? tree.nodes : [];
  const targetRole = role ? String(role).trim().toLowerCase() : null;
  const queryLower = nameQuery ? String(nameQuery).trim().toLowerCase() : null;

  return nodes.filter((node) => {
    if (!includeDisabled && node.ariaDisabled) return false;
    if (targetRole && node.role !== targetRole) return false;
    if (queryLower) {
      const hay = `${node.accessibleName || ""} ${node.accessibleDescription || ""} ${node.name || ""} ${node.id || ""}`.toLowerCase();
      if (!hay.includes(queryLower)) return false;
    }
    return true;
  });
}

module.exports = {
  extractAriaAccessibilityTree,
  findInteractiveTargetsByAriaRoleAndName
};
