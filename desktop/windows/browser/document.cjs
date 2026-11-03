"use strict";
// Fixed code in a Chromium isolated world. No model-supplied selectors/code.
// Adapted from Gemini shadow/frame discovery, using live DOM identities instead
// of mock selectors; all targets retain fresh observations and native approval.
const capture = function (snapshotId) {
  const state = (globalThis.__kosworkDocument ??= { ids: new WeakMap(), next: 1, refs: new Map() });
  state.refs.clear();
  state.snapshotId = snapshotId;
  const contexts = new WeakMap();
  const clean = (v, n) =>
    String(v ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, n);
  const parent = (el) => el.assignedSlot || el.parentElement || el.getRootNode()?.host;
  const contains = (el, target) => {
    for (let n = target, i = 0; n && i < 80; n = parent(n), i++) if (n === el) return true;
    return false;
  };
  const deepPoint = (doc, x, y) => {
    let hit = doc.elementFromPoint(x, y);
    for (let i = 0; hit?.shadowRoot && i < 8; i++) {
      const deeper = hit.shadowRoot.elementFromPoint(x, y);
      if (!deeper || deeper === hit) break;
      hit = deeper;
    }
    return hit;
  };
  const validContext = (ctx) => {
    try {
      let doc = document;
      for (const f of ctx.frames) {
        if (!f.isConnected || f.ownerDocument !== doc || !f.contentDocument) return false;
        doc = f.contentDocument;
      }
      return doc === ctx.doc;
    } catch {
      return false;
    }
  };
  // Offset mapping cannot safely target rotated/scaled frames. Exclude those.
  const frameRect = (f) => {
    const r = f.getBoundingClientRect();
    if (
      !f.offsetWidth ||
      Math.abs(r.width - f.offsetWidth) > 2 ||
      Math.abs(r.height - f.offsetHeight) > 2
    )
      return null;
    let n = f,
      i = 0;
    for (; n && i < 80; n = parent(n), i++) {
      const css = n.ownerDocument.defaultView.getComputedStyle(n);
      if (
        css.visibility === "hidden" ||
        css.display === "none" ||
        css.opacity === "0" ||
        n.getAttribute("aria-hidden") === "true"
      )
        return null;
      if (css.transform !== "none") {
        const m = new DOMMatrixReadOnly(css.transform);
        if (
          !m.is2D ||
          Math.abs(m.a - 1) > 0.001 ||
          Math.abs(m.d - 1) > 0.001 ||
          Math.abs(m.b) > 0.001 ||
          Math.abs(m.c) > 0.001
        )
          return null;
      }
    }
    return n ? null : r;
  };
  const geometry = (el, ctx = contexts.get(el)) => {
    if (!ctx || !validContext(ctx) || !el.isConnected) return null;
    const win = ctx.doc.defaultView,
      r = el.getBoundingClientRect();
    let left = Math.max(0, r.left),
      top = Math.max(0, r.top),
      right = Math.min(win.innerWidth, r.right),
      bottom = Math.min(win.innerHeight, r.bottom);
    let n = el,
      i = 0;
    for (; n && i < 80; n = parent(n), i++) {
      const css = win.getComputedStyle(n);
      if (
        css.visibility === "hidden" ||
        css.display === "none" ||
        css.opacity === "0" ||
        n.getAttribute("aria-hidden") === "true"
      )
        return null;
    }
    if (n || right <= left || bottom <= top) return null;
    for (const f of [...ctx.frames].reverse()) {
      const fr = frameRect(f);
      if (!fr) return null;
      const x = fr.left + f.clientLeft,
        y = fr.top + f.clientTop;
      right = Math.min(right, f.clientWidth) + x;
      bottom = Math.min(bottom, f.clientHeight) + y;
      left += x;
      top += y;
      const w = f.ownerDocument.defaultView;
      left = Math.max(0, left);
      top = Math.max(0, top);
      right = Math.min(w.innerWidth, right);
      bottom = Math.min(w.innerHeight, bottom);
      if (right <= left || bottom <= top) return null;
    }
    return { x: (left + right) / 2, y: (top + bottom) / 2 };
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
    const href = el.tagName === "A" ? el.href : "",
      ctx = contexts.get(el);
    return {
      role,
      name,
      type,
      secret,
      disabled: el.disabled === true,
      readonly: el.readOnly === true,
      checked: el.matches('input[type="checkbox"],input[type="radio"]') ? el.checked : undefined,
      expanded: el.getAttribute("aria-expanded") ?? undefined,
      upload: el.matches('input[type="file"]'),
      href: /^https?:/i.test(href) ? href.slice(0, 4096) : "",
      submit: el.matches('button:not([type]),button[type="submit"],input[type="submit"]'),
      scope: ctx?.scope || "page",
      signature: JSON.stringify([
        role,
        name,
        type,
        href,
        el.disabled === true,
        secret,
        el.id,
        el.getAttribute("name"),
        el.getAttribute("target"),
        el.form?.action,
        el.form?.method,
        el.formAction,
        el.formMethod,
        el.formTarget,
        el.readOnly === true,
        el.matches('input[type="checkbox"],input[type="radio"]') ? el.checked : null,
        el.getAttribute("aria-expanded"),
        ctx?.frames.map((f) => [f.id, f.title, f.contentDocument?.URL])
      ])
    };
  };
  state.info = info;
  state.visible = (el) => !!geometry(el);
  state.point = (el) => geometry(el);
  state.connected = (el) => !!contexts.get(el) && validContext(contexts.get(el)) && el.isConnected;
  const deepActive = (doc) => {
    let active = doc.activeElement;
    for (let i = 0; active?.shadowRoot?.activeElement && i < 8; i++)
      active = active.shadowRoot.activeElement;
    return active;
  };
  state.focused = (el) => {
    const ctx = contexts.get(el);
    if (!ctx || !validContext(ctx)) return false;
    let doc = document;
    for (const f of ctx.frames) {
      if (deepActive(doc) !== f) return false;
      doc = f.contentDocument;
    }
    const active = deepActive(doc);
    return active === el || (el.isContentEditable && contains(el, active));
  };
  state.hit = (el, x, y) => {
    const ctx = contexts.get(el);
    if (!ctx || !validContext(ctx)) return false;
    let doc = document;
    for (const f of ctx.frames) {
      if (deepPoint(doc, x, y) !== f) return false;
      const r = frameRect(f);
      if (!r) return false;
      x -= r.left + f.clientLeft;
      y -= r.top + f.clientTop;
      doc = f.contentDocument;
    }
    return contains(el, deepPoint(doc, x, y));
  };
  state.scroll = (el) => {
    el.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
    for (const f of [...contexts.get(el).frames].reverse())
      f.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
  };
  const nodes = [],
    notices = [],
    seenRoots = new WeakSet();
  let visited = 0,
    text = "",
    dirty = false,
    roots = 0,
    skippedFrames = 0,
    truncated = false;
  const walk = (root, ctx, depth) => {
    if (!root || seenRoots.has(root)) return;
    if (depth > 8 || roots >= 24 || visited >= 1800) {
      truncated = true;
      return;
    }
    seenRoots.add(root);
    roots++;
    const walker = ctx.doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (++visited > 1800) {
        truncated = true;
        break;
      }
      if (node.nodeType === Node.TEXT_NODE) {
        const p = node.parentElement;
        if (
          text.length < 7000 &&
          p &&
          !p.closest("script,style,noscript,input,textarea,[contenteditable],[aria-hidden=true]")
        ) {
          contexts.set(p, ctx);
          if (geometry(p)) text += clean(node.textContent, 400) + " ";
        }
        continue;
      }
      contexts.set(node, ctx);
      if (
        notices.length < 8 &&
        node.matches(
          'dialog,[role="dialog"],[role="alert"],[role="menu"],[aria-live="assertive"]'
        ) &&
        geometry(node)
      )
        notices.push({
          role: node.getAttribute("role") || (node.tagName === "DIALOG" ? "dialog" : "alert"),
          text: clean(node.textContent, 240)
        });
      if (node.matches("input,textarea") && node.value && node.value !== node.defaultValue)
        dirty = true;
      if (
        nodes.length < 55 &&
        node.matches(
          'a[href],button,input,textarea,select,[role="button"],[role="link"],[role="checkbox"],[role="tab"],[role="textbox"],[role="combobox"],[contenteditable="true"],[contenteditable=""],[contenteditable="plaintext-only"]'
        ) &&
        geometry(node)
      ) {
        let id = state.ids.get(node);
        if (!id) {
          id = "e" + state.next++;
          state.ids.set(node, id);
        }
        if (state.next > 9999999) {
          truncated = true;
          return;
        }
        const item = info(node);
        state.refs.set(id, { node, signature: item.signature });
        nodes.push({ ref: id, ...item });
      }
      if (node.shadowRoot)
        walk(
          node.shadowRoot,
          { ...ctx, scope: (ctx.scope + "/shadow:" + node.tagName.toLowerCase()).slice(0, 240) },
          depth + 1
        );
      if (node.tagName === "IFRAME") {
        try {
          const child = node.contentDocument;
          if (!child || !frameRect(node) || ctx.frames.length >= 4) {
            skippedFrames++;
            continue;
          }
          // Browser-enforced access plus explicit same-origin check. Accessible
          // inherited blank/srcdoc pages remain allowed; no cross-origin CDP.
          if (
            !/^about:(blank|srcdoc)$/.test(child.URL) &&
            new URL(child.URL).origin !== location.origin
          ) {
            skippedFrames++;
            continue;
          }
          walk(
            child.body || child.documentElement,
            {
              doc: child,
              frames: [...ctx.frames, node],
              scope: (ctx.scope + "/frame:" + clean(node.title || node.id || "embedded", 60)).slice(
                0,
                240
              )
            },
            depth + 1
          );
        } catch {
          skippedFrames++;
        }
      }
    }
  };
  walk(document.body || document.documentElement, { doc: document, frames: [], scope: "page" }, 0);
  return {
    viewport: { width: innerWidth, height: innerHeight },
    title: clean(document.title, 180),
    url: location.href.slice(0, 4096),
    text: clean(text, 7000),
    nodes,
    notices,
    dirty,
    skipped_frames: skippedFrames,
    truncated: truncated || text.length >= 7000 || nodes.length >= 55
  };
};
const locate = function (snapshotId, ref) {
  const s = globalThis.__kosworkDocument,
    item = s?.refs.get(ref);
  if (
    !item ||
    s.snapshotId !== snapshotId ||
    !s.connected(item.node) ||
    !s.visible(item.node) ||
    s.info(item.node).signature !== item.signature ||
    item.node.disabled
  )
    return null;
  const info = s.info(item.node);
  if (info.secret) return { blocked: true };
  s.scroll(item.node);
  const point = s.point(item.node);
  if (!point || !s.hit(item.node, point.x, point.y)) return null;
  return { ...point, info };
};
const fileNode = function (snapshotId, ref) {
  const s = globalThis.__kosworkDocument,
    e = s?.refs.get(ref);
  return s?.snapshotId === snapshotId &&
    s.connected(e?.node) &&
    e.node.matches('input[type="file"]') &&
    s.info(e.node).signature === e.signature
    ? e.node
    : null;
};
const focused = function (snapshotId, ref) {
  const s = globalThis.__kosworkDocument,
    e = s?.refs.get(ref);
  return (
    s?.snapshotId === snapshotId &&
    s.connected(e?.node) &&
    s.info(e.node).signature === e.signature &&
    !s.info(e.node).secret &&
    s.focused(e.node)
  );
};
const focus = function (snapshotId, ref) {
  const s = globalThis.__kosworkDocument,
    e = s?.refs.get(ref);
  if (
    s?.snapshotId !== snapshotId ||
    !s.connected(e?.node) ||
    s.info(e.node).signature !== e.signature ||
    s.info(e.node).secret ||
    e.node.disabled
  )
    return false;
  s.scroll(e.node);
  const p = s.point(e.node);
  if (!p || !s.hit(e.node, p.x, p.y)) return false;
  e.node.focus({ preventScroll: true });
  return s.focused(e.node);
};
module.exports = {
  capture: capture.toString(),
  locate: locate.toString(),
  fileNode: fileNode.toString(),
  focused: focused.toString(),
  focus: focus.toString()
};
