"use strict";
// Fixed code in a Chromium isolated world. No source/selectors supplied by the model.
const capture = function (snapshotId) {
  const state = (globalThis.__kosworkDocument ??= { ids: new WeakMap(), next: 1, refs: new Map() });
  state.refs.clear();
  state.snapshotId = snapshotId;
  const clean = (v, n) =>
    String(v ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, n);
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return (
      r.width > 0 &&
      r.height > 0 &&
      s.visibility !== "hidden" &&
      s.display !== "none" &&
      s.opacity !== "0" &&
      r.bottom > 0 &&
      r.top < innerHeight &&
      r.right > 0 &&
      r.left < innerWidth
    );
  };
  const info = (el) => {
    const type = clean(el.getAttribute("type"), 30).toLowerCase();
    const role = clean(
      el.getAttribute("role") || (el.isContentEditable ? "textbox" : el.tagName.toLowerCase()),
      30
    );
    const name = clean(
      el.getAttribute("aria-label") ||
        (el.labels
          ? Array.from(el.labels)
              .map((l) => l.textContent)
              .join(" ")
          : "") ||
        el.getAttribute("placeholder") ||
        (el.matches("input,textarea") || el.isContentEditable
          ? el.getAttribute("name") || "Editable text"
          : el.textContent),
      180
    );
    const secret =
      el.matches('input[type="password"]') ||
      /password|one-time-code|current-password|new-password/i.test(el.autocomplete || "") ||
      /парол|password|verification.code|одноразов|код подтвержд/i.test(name);
    const href = el.tagName === "A" ? el.href : "";
    return {
      role,
      name,
      type,
      secret,
      upload: el.matches('input[type="file"]'),
      href: /^https?:/i.test(href) ? href.slice(0, 4096) : "",
      submit: el.matches('button:not([type]),button[type="submit"],input[type="submit"]'),
      signature: JSON.stringify([role, name, type, href, el.disabled === true, secret])
    };
  };
  state.info = info;
  state.visible = visible;
  const nodes = [];
  let visited = 0,
    text = "",
    dirty = false;
  const walker = document.createTreeWalker(
    document.body || document.documentElement,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT
  );
  let node;
  while ((node = walker.nextNode()) && ++visited <= 1800) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (
        text.length < 7000 &&
        node.parentElement &&
        !node.parentElement.closest("script,style,noscript,input,textarea,[aria-hidden=true]") &&
        visible(node.parentElement)
      )
        text += clean(node.textContent, 400) + " ";
      continue;
    }
    if (node.matches("input,textarea") && node.value && node.value !== node.defaultValue)
      dirty = true;
    if (
      nodes.length >= 55 ||
      !node.matches(
        'a[href],button,input,textarea,select,[role="button"],[role="link"],[contenteditable="true"]'
      ) ||
      !visible(node)
    )
      continue;
    let id = state.ids.get(node);
    if (!id) {
      id = "e" + state.next++;
      state.ids.set(node, id);
    }
    if (state.next > 9999999) break;
    const item = info(node);
    state.refs.set(id, { node, signature: item.signature });
    nodes.push({ ref: id, ...item });
  }
  return {
    viewport: { width: innerWidth, height: innerHeight },
    title: clean(document.title, 180),
    url: location.href.slice(0, 4096),
    text: clean(text, 7000),
    nodes,
    dirty,
    truncated: visited > 1800 || text.length >= 7000 || nodes.length >= 55
  };
};
const locate = function (snapshotId, ref) {
  const state = globalThis.__kosworkDocument,
    item = state?.refs.get(ref);
  if (
    !item ||
    state.snapshotId !== snapshotId ||
    !item.node.isConnected ||
    !state.visible(item.node) ||
    state.info(item.node).signature !== item.signature ||
    item.node.disabled
  )
    return null;
  const info = state.info(item.node);
  if (info.secret) return { blocked: true };
  item.node.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
  const r = item.node.getBoundingClientRect(),
    x = Math.max(1, Math.min(innerWidth - 1, r.left + r.width / 2)),
    y = Math.max(1, Math.min(innerHeight - 1, r.top + r.height / 2));
  const top = document.elementFromPoint(x, y);
  if (!top || !(top === item.node || item.node.contains(top))) return null;
  return { x, y, info };
};
const fileNode = function (snapshotId, ref) {
  const s = globalThis.__kosworkDocument,
    e = s?.refs.get(ref);
  return s?.snapshotId === snapshotId &&
    e?.node.isConnected &&
    e.node.matches('input[type="file"]') &&
    s.info(e.node).signature === e.signature
    ? e.node
    : null;
};
module.exports = {
  capture: capture.toString(),
  locate: locate.toString(),
  fileNode: fileNode.toString()
};
