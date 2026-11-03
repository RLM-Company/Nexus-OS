"use strict";

/**
 * Recursive Shadow DOM & Same-Origin Iframe Piercer for the Koswork Local Chromium Agent Browser
 * (addresses the complex frame and Shadow DOM limitations noted in PR #414 and PR #415).
 *
 * Works both on live DOM trees (inside preload / browser context) and on serialized/mock DOM trees
 * in Node unit tests while strictly enforcing same-origin frame security boundaries.
 */

const INTERACTIVE_TAGS = new Set(["BUTTON", "A", "INPUT", "SELECT", "TEXTAREA", "SUMMARY"]);

function isInteractiveNode(node) {
  if (!node || typeof node !== "object") return false;
  const tag = String(node.tagName || "").toUpperCase();
  if (INTERACTIVE_TAGS.has(tag)) return true;
  const role = String(node.getAttribute?.("role") || node.attributes?.role || "").toLowerCase();
  return role === "button" || role === "link" || role === "textbox" || role === "checkbox" || role === "tab";
}

function describeNodeSegment(node, indexInParent) {
  const tag = String(node.tagName || "node").toLowerCase();
  const id = node.id || node.getAttribute?.("id") || node.attributes?.id;
  if (id) return `${tag}#${id}`;
  const testId =
    node.getAttribute?.("data-testid") ||
    node.attributes?.["data-testid"] ||
    node.getAttribute?.("name") ||
    node.attributes?.name;
  if (testId) return `${tag}[name="${testId}"]`;
  return `${tag}:nth-of-type(${indexInParent + 1})`;
}

/**
 * Collects interactive elements across main document, nested open shadow roots,
 * and same-origin iframes up to `maxDepth`, returning deterministic deep selectors
 * (`iframe#checkout >> shadow#payment-card >> button#pay`).
 */
function collectPiercedInteractiveSnapshot(rootNode, options = {}) {
  const maxDepth = Math.min(Math.max(Number(options.maxDepth ?? 6), 1), 12);
  const maxElements = Math.min(Math.max(Number(options.maxElements ?? 200), 1), 500);
  const baseOrigin = options.baseOrigin || rootNode?.location?.origin || "https://local.koswork";

  const elements = [];
  const skippedCrossOriginFrames = [];

  function walk(node, pathSegments, depth) {
    if (!node || depth > maxDepth || elements.length >= maxElements) return;

    const children = Array.from(node.children || node.childNodes || []);
    for (let i = 0; i < children.length; i++) {
      if (elements.length >= maxElements) break;
      const child = children[i];
      if (!child || !child.tagName) continue;

      const seg = describeNodeSegment(child, i);
      const currentPath = [...pathSegments, seg];

      if (isInteractiveNode(child) && !child.disabled && !child.hidden) {
        const label = String(
          child.innerText ||
            child.textContent ||
            child.value ||
            child.getAttribute?.("aria-label") ||
            child.attributes?.["aria-label"] ||
            ""
        )
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 160);

        elements.push({
          deepSelector: currentPath.join(" >> "),
          tagName: String(child.tagName).toLowerCase(),
          id: child.id || child.attributes?.id || null,
          label,
          inShadowDom: currentPath.some((p) => p.startsWith("shadow[")),
          inIframe: currentPath.some((p) => p.startsWith("frame["))
        });
      }

      // 1. Pierce open Shadow DOM root if present
      if (child.shadowRoot) {
        walk(child.shadowRoot, [...currentPath, `shadow[${seg}]`], depth + 1);
      }

      // 2. Pierce same-origin iframe contentDocument while blocking cross-origin frames
      if (String(child.tagName).toUpperCase() === "IFRAME") {
        const frameSrc = String(child.src || child.getAttribute?.("src") || child.attributes?.src || "");
        let isSameOrigin = true;
        if (frameSrc && /^https?:\/\//i.test(frameSrc)) {
          try {
            const parsedOrigin = new URL(frameSrc).origin;
            isSameOrigin = parsedOrigin === baseOrigin;
          } catch {
            isSameOrigin = false;
          }
        }

        if (!isSameOrigin) {
          skippedCrossOriginFrames.push({
            frameSelector: currentPath.join(" >> "),
            src: frameSrc,
            reason: "cross_origin_isolated"
          });
        } else {
          let frameDoc = null;
          try {
            frameDoc = child.contentDocument || child.contentWindow?.document || null;
          } catch {
            frameDoc = null;
          }
          if (frameDoc) {
            const rootTarget = frameDoc.body || frameDoc.documentElement || frameDoc;
            walk(rootTarget, [...currentPath, `frame[${seg}]`], depth + 1);
          }
        }
      }

      // 3. Normal light-DOM recursion
      walk(child, currentPath, depth + 1);
    }
  }

  const startRoot = rootNode?.body || rootNode?.documentElement || rootNode;
  walk(startRoot, [], 0);

  return {
    baseOrigin,
    totalInteractive: elements.length,
    elements,
    skippedCrossOriginFrames
  };
}

/**
 * Resolves a deep selector (`iframe#editor >> shadow[custom-card#host] >> button#save`)
 * back to the target DOM node so the Koswork browser runner can click/fill it deterministically.
 */
function resolveDeepSelector(rootNode, deepSelector) {
  const parts = String(deepSelector || "")
    .split(">>")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  let currentContext = rootNode?.body || rootNode?.documentElement || rootNode;

  function findDirectOrDescendantMatch(container, token) {
    if (!container) return null;
    const queue = [container];
    while (queue.length > 0) {
      const node = queue.shift();
      const children = Array.from(node.children || node.childNodes || []);
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (!child || !child.tagName) continue;
        const seg = describeNodeSegment(child, i);
        if (seg === token) return child;
        queue.push(child);
      }
    }
    return null;
  }

  let lastMatchedElement = null;
  for (const part of parts) {
    if (part.startsWith("shadow[")) {
      if (!lastMatchedElement || !lastMatchedElement.shadowRoot) return null;
      currentContext = lastMatchedElement.shadowRoot;
      continue;
    }
    if (part.startsWith("frame[")) {
      if (!lastMatchedElement) return null;
      const frameDoc =
        lastMatchedElement.contentDocument || lastMatchedElement.contentWindow?.document || null;
      if (!frameDoc) return null;
      currentContext = frameDoc.body || frameDoc.documentElement || frameDoc;
      continue;
    }
    const found = findDirectOrDescendantMatch(currentContext, part);
    if (!found) return null;
    lastMatchedElement = found;
    currentContext = found;
  }

  return lastMatchedElement;
}

module.exports = {
  collectPiercedInteractiveSnapshot,
  resolveDeepSelector
};
