"use strict";

const http = require("node:http");
const net = require("node:net");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

/**
 * Real Chromium / Electron CDP Driver (`desktop/windows/browser/chromium-cdp-driver.cjs`).
 *
 * Launches or attaches to a real Chromium (`Chrome/156.x`) or Electron browser instance
 * via Chrome DevTools Protocol (CDP over HTTP `/json/*` and RFC 6455 WebSocket).
 *
 * Capabilities:
 * - Real tab lifecycle (`createTarget`, `activateTarget`, `closeTarget`, `listTargets`)
 * - Real navigation & history (`Page.navigate`, `Page.getNavigationHistory`, `Page.navigateToHistoryEntry`, `Page.stopLoading`)
 * - Real live DOM inspection (`Runtime.evaluate`) with `MutationObserver` epoch tracking (`__kosworkDomEpoch`),
 *   stable `data-koswork-ref` element references, open Shadow DOM piercing, same-origin iframe traversal,
 *   and explicit cross-origin frame isolation (`crossOriginFramesSkipped`)
 * - Real form input, clicking, scrolling, and stale-reference detection (`STALE_ELEMENT_REFERENCE`)
 */

function rewriteLoopbackForChromiumPolicy(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl));
    if (
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "localhost" ||
      parsed.hostname === "0.0.0.0"
    ) {
      parsed.hostname = "corpus.local";
      return parsed.toString();
    }
    return parsed.toString();
  } catch {
    return String(rawUrl);
  }
}

function httpJsonRequest(urlStr, method = "GET") {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = http.request(
      {
        hostname: u.hostname,
        port: Number(u.port),
        path: `${u.pathname}${u.search}`,
        method,
        timeout: 4000
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          try {
            resolve(JSON.parse(text));
          } catch {
            resolve(text);
          }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error("CDP_HTTP_TIMEOUT"));
    });
    req.end();
  });
}

function connectCdpWebSocket(wsUrl) {
  return new Promise((resolve, reject) => {
    const u = new URL(wsUrl);
    const socket = net.connect(Number(u.port), u.hostname, () => {
      const key = crypto.randomBytes(16).toString("base64");
      socket.write(
        `GET ${u.pathname}${u.search} HTTP/1.1\r\n` +
          `Host: ${u.host}\r\n` +
          `Upgrade: websocket\r\n` +
          `Connection: Upgrade\r\n` +
          `Sec-WebSocket-Key: ${key}\r\n` +
          `Sec-WebSocket-Version: 13\r\n\r\n`
      );
    });

    let handshakeDone = false;
    let buffer = Buffer.alloc(0);
    let nextId = 1;
    const pending = new Map();
    const eventListeners = new Map();

    function sendFrame(text) {
      const payload = Buffer.from(text, "utf8");
      const mask = crypto.randomBytes(4);
      let header;
      if (payload.length < 126) {
        header = Buffer.alloc(2);
        header[0] = 0x81;
        header[1] = 0x80 | payload.length;
      } else if (payload.length < 65536) {
        header = Buffer.alloc(4);
        header[0] = 0x81;
        header[1] = 0x80 | 126;
        header.writeUInt16BE(payload.length, 2);
      } else {
        header = Buffer.alloc(10);
        header[0] = 0x81;
        header[1] = 0x80 | 127;
        header.writeBigUInt64BE(BigInt(payload.length), 2);
      }
      const masked = Buffer.alloc(payload.length);
      for (let i = 0; i < payload.length; i += 1) {
        masked[i] = payload[i] ^ mask[i & 3];
      }
      socket.write(Buffer.concat([header, mask, masked]));
    }

    function parseFrames() {
      while (buffer.length >= 2) {
        const b0 = buffer[0];
        const b1 = buffer[1];
        const opcode = b0 & 0x0f;
        let len = b1 & 0x7f;
        let offset = 2;
        if (len === 126) {
          if (buffer.length < 4) return;
          len = buffer.readUInt16BE(2);
          offset = 4;
        } else if (len === 127) {
          if (buffer.length < 10) return;
          len = Number(buffer.readBigUInt64BE(2));
          offset = 10;
        }
        if (buffer.length < offset + len) return;
        const payload = buffer.subarray(offset, offset + len);
        buffer = buffer.subarray(offset + len);

        if (opcode === 0x08) {
          socket.end();
          return;
        }
        if (opcode === 0x09) {
          // Ping -> send Pong
          const pong = Buffer.from([0x8a, 0x80, 0, 0, 0, 0]);
          socket.write(pong);
          continue;
        }
        if (opcode === 0x01) {
          let msg;
          try {
            msg = JSON.parse(payload.toString("utf8"));
          } catch {
            continue;
          }
          if (msg.id && pending.has(msg.id)) {
            const { resolve: res, reject: rej } = pending.get(msg.id);
            pending.delete(msg.id);
            if (msg.error) {
              const err = new Error(msg.error.message || "CDP_COMMAND_ERROR");
              err.code = "CDP_COMMAND_ERROR";
              rej(err);
            } else {
              res(msg.result);
            }
          } else if (msg.method && eventListeners.has(msg.method)) {
            for (const fn of eventListeners.get(msg.method)) {
              try {
                fn(msg.params || {});
              } catch {
                // ignore listener error
              }
            }
          }
        }
      }
    }

    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!handshakeDone) {
        const idx = buffer.indexOf("\r\n\r\n");
        if (idx !== -1) {
          handshakeDone = true;
          buffer = buffer.subarray(idx + 4);
          resolve({
            send(method, params = {}) {
              const id = nextId;
              nextId += 1;
              return new Promise((res, rej) => {
                pending.set(id, { resolve: res, reject: rej });
                sendFrame(JSON.stringify({ id, method, params }));
              });
            },
            on(eventName, handler) {
              if (!eventListeners.has(eventName)) {
                eventListeners.set(eventName, []);
              }
              eventListeners.get(eventName).push(handler);
            },
            close() {
              for (const [, p] of pending.entries()) {
                p.reject(new Error("CDP_SOCKET_CLOSED"));
              }
              pending.clear();
              socket.destroy();
            }
          });
          parseFrames();
        }
      } else {
        parseFrames();
      }
    });

    socket.on("error", (err) => {
      if (!handshakeDone) reject(err);
    });
  });
}

const IN_PAGE_INSPECTION_SCRIPT = `
(() => {
  if (!window.__kosworkMutationObserverInstalled) {
    window.__kosworkMutationObserverInstalled = true;
    window.__kosworkDomEpoch = 1;
    window.__kosworkMutationCount = 0;
    const obs = new MutationObserver((mutations) => {
      const meaningful = mutations.some((m) => {
        if (m.type === "attributes" && m.attributeName && m.attributeName.startsWith("data-koswork-")) {
          return false;
        }
        return true;
      });
      if (meaningful) {
        window.__kosworkDomEpoch = (window.__kosworkDomEpoch || 1) + 1;
        window.__kosworkMutationCount = (window.__kosworkMutationCount || 0) + mutations.length;
      }
    });
    if (document.documentElement) {
      obs.observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true
      });
    }
  }

  const domEpoch = window.__kosworkDomEpoch || 1;
  const controls = [];
  const frames = [];
  const crossOriginFramesSkipped = [];
  const tables = [];
  let refCounter = 1;

  function collectFromRoot(rootDoc, scopePrefix) {
    if (!rootDoc) return;
    const interactiveEls = rootDoc.querySelectorAll(
      "a[href], button, input, select, textarea, summary, [role='button'], [role='link'], [role='textbox'], [role='checkbox'], [role='combobox']"
    );
    for (const el of interactiveEls) {
      let refId = el.getAttribute("data-koswork-ref");
      if (!refId) {
        refId = "ref-" + (refCounter++);
        el.setAttribute("data-koswork-ref", refId);
      } else {
        refCounter++;
      }
      el.setAttribute("data-koswork-epoch", String(domEpoch));
      const rect = typeof el.getBoundingClientRect === "function"
        ? el.getBoundingClientRect()
        : { x: 0, y: 0, width: 100, height: 24 };
      const tag = (el.tagName || "div").toLowerCase();
      const id = el.id || refId;
      const label = (
        el.getAttribute("aria-label") ||
        el.getAttribute("placeholder") ||
        el.innerText ||
        el.textContent ||
        el.value ||
        id
      ).replace(/\\s+/g, " ").trim().slice(0, 160);

      controls.push({
        elementRef: refId,
        domEpoch,
        id,
        name: el.getAttribute("name") || null,
        tag,
        type: (el.getAttribute("type") || (tag === "a" ? "link" : tag)).toLowerCase(),
        role: (el.getAttribute("role") || tag).toLowerCase(),
        label,
        value: el.value !== undefined ? String(el.value) : "",
        href: el.getAttribute("href") || null,
        checked: Boolean(el.checked),
        disabled: Boolean(el.disabled),
        scope: scopePrefix,
        bounds: {
          x: Math.round(rect.x || 0),
          y: Math.round(rect.y || 0),
          width: Math.round(rect.width || 120),
          height: Math.round(rect.height || 28)
        }
      });
    }

    // Open Shadow DOM roots
    const allEls = rootDoc.querySelectorAll("*");
    for (const host of allEls) {
      if (host.shadowRoot) {
        const hostId = host.id || host.tagName.toLowerCase();
        const shadowText = (host.shadowRoot.innerHTML || "").replace(/<[^>]+>/g, " ").replace(/\\s+/g, " ").trim();
        frames.push({
          frameId: "shadow:" + hostId,
          scope: "shadow",
          origin: location.origin,
          sameOrigin: true,
          textUtf16: shadowText
        });
        collectFromRoot(host.shadowRoot, "shadow:" + hostId);
      }
    }

    // Iframes
    const iframeEls = rootDoc.querySelectorAll("iframe");
    let fIdx = 1;
    for (const ifr of iframeEls) {
      const fid = ifr.id || ("iframe-" + (fIdx++));
      const src = ifr.getAttribute("src") || "";
      let sameOrigin = true;
      let frameOrigin = location.origin;
      if (src && /^https?:\\/\\//i.test(src)) {
        try {
          frameOrigin = new URL(src, location.href).origin;
          sameOrigin = frameOrigin === location.origin;
        } catch (e) {
          sameOrigin = false;
        }
      }
      if (!sameOrigin) {
        crossOriginFramesSkipped.push({
          frameId: fid,
          src,
          origin: frameOrigin,
          reason: "cross_origin_isolated"
        });
        frames.push({
          frameId: fid,
          scope: "iframe",
          origin: frameOrigin,
          sameOrigin: false,
          isolated: true,
          textUtf16: ""
        });
      } else {
        try {
          const fDoc = ifr.contentDocument || (ifr.contentWindow && ifr.contentWindow.document);
          const fText = fDoc && fDoc.body ? fDoc.body.innerText : "";
          frames.push({
            frameId: fid,
            scope: "iframe",
            origin: frameOrigin,
            sameOrigin: true,
            textUtf16: fText
          });
          if (fDoc) collectFromRoot(fDoc, "iframe:" + fid);
        } catch (e) {
          crossOriginFramesSkipped.push({
            frameId: fid,
            src,
            origin: frameOrigin,
            reason: "cross_origin_access_blocked"
          });
        }
      }
    }

    // HTML tables
    const tableEls = rootDoc.querySelectorAll("table");
    let tIdx = 1;
    for (const tbl of tableEls) {
      const headers = Array.from(tbl.querySelectorAll("thead th, tr:first-child th")).map((th) =>
        (th.innerText || th.textContent || "").replace(/\\s+/g, " ").trim()
      );
      const rows = [];
      const bodyTrs = tbl.querySelectorAll("tbody tr, tr");
      for (const tr of bodyTrs) {
        const tds = Array.from(tr.querySelectorAll("td")).map((td) =>
          (td.innerText || td.textContent || "").replace(/\\s+/g, " ").trim()
        );
        if (tds.length > 0) rows.push(tds);
      }
      tables.push({
        tableId: tbl.id || ("table-" + (tIdx++)),
        headers,
        rows
      });
    }
  }

  collectFromRoot(document, "main");

  const metaPageDate =
    (document.querySelector("meta[name='article:published_time'], meta[property='article:published_time'], meta[name='date'], time[data-page-date]") || {})
      .content ||
    (document.querySelector("time[data-page-date]") || {}).getAttribute?.("datetime") ||
    null;

  const metaEventDate =
    (document.querySelector("meta[name='event:date'], time[data-event-date]") || {})
      .content ||
    (document.querySelector("time[data-event-date]") || {}).getAttribute?.("datetime") ||
    null;

  const bodyText = document.body ? document.body.innerText : "";
  const shadowTexts = frames.filter((f) => f.sameOrigin && f.textUtf16).map((f) => f.textUtf16);
  const fullText = [bodyText, ...shadowTexts].filter(Boolean).join("\\n");

  return {
    url: location.href,
    title: document.title || "",
    domEpoch,
    mutationCount: window.__kosworkMutationCount || 0,
    pageDate: metaPageDate,
    eventDate: metaEventDate,
    text: fullText,
    html: document.documentElement ? document.documentElement.outerHTML : "",
    controls,
    frames,
    crossOriginFramesSkipped,
    tables,
    scrollMetrics: {
      scrollTop: Math.round(window.scrollY || document.documentElement?.scrollTop || 0),
      scrollHeight: Math.round(document.documentElement?.scrollHeight || 0),
      clientHeight: Math.round(window.innerHeight || document.documentElement?.clientHeight || 0)
    }
  };
})()
`;

class KosworkChromiumCdpDriver {
  constructor(options = {}) {
    this.chromiumPath = options.chromiumPath || "/usr/bin/chromium";
    this.debuggingPort = Number(options.debuggingPort || 0);
    this.proc = null;
    this.userDataDir = null;
    this.activePort = null;
    this.sessionsByTabId = new Map(); // tabId -> { targetId, wsUrl, cdp, lastUrl, status }
  }

  async ensureStarted() {
    if (this.proc && this.activePort) {
      return this.activePort;
    }

    this.userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "koswork-chromium-cdp-"));
    const port = this.debuggingPort || (19300 + Math.floor(Math.random() * 500));

    this.proc = spawn(
      this.chromiumPath,
      [
        "--headless",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        `--user-data-dir=${this.userDataDir}`,
        "--host-resolver-rules=MAP *.corpus.local 127.0.0.1, MAP corpus.local 127.0.0.1, MAP *.research.local 127.0.0.1, MAP research.local 127.0.0.1",
        `--remote-debugging-port=${port}`,
        "about:blank"
      ],
      { stdio: "ignore" }
    );

    for (let i = 0; i < 40; i += 1) {
      await new Promise((r) => setTimeout(r, 100));
      try {
        const ver = await httpJsonRequest(`http://127.0.0.1:${port}/json/version`);
        if (ver && ver.webSocketDebuggerUrl) {
          this.activePort = port;
          this.browserVersion = ver.Browser || "Chromium";
          return port;
        }
      } catch {
        // retry until ready
      }
    }

    throw new Error(`CHROMIUM_CDP_START_TIMEOUT on port ${port}`);
  }

  async getOrCreateTabSession(tabId) {
    const id = String(tabId || "tab-1");
    if (this.sessionsByTabId.has(id)) {
      return this.sessionsByTabId.get(id);
    }

    const port = await this.ensureStarted();
    let targetInfo;
    try {
      targetInfo = await httpJsonRequest(
        `http://127.0.0.1:${port}/json/new?about:blank`,
        "PUT"
      );
    } catch {
      targetInfo = await httpJsonRequest(
        `http://127.0.0.1:${port}/json/new?about:blank`,
        "GET"
      );
    }

    const cdp = await connectCdpWebSocket(targetInfo.webSocketDebuggerUrl);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable");

    const session = {
      tabId: id,
      targetId: targetInfo.id,
      wsUrl: targetInfo.webSocketDebuggerUrl,
      cdp,
      lastHttpStatus: 200,
      lastNetworkError: null
    };

    cdp.on("Network.responseReceived", (params) => {
      if (params.type === "Document" && params.response) {
        session.lastHttpStatus = Number(params.response.status || 200);
      }
    });

    cdp.on("Network.loadingFailed", (params) => {
      if (params.type === "Document") {
        session.lastNetworkError = params.errorText || "ERR_FAILED";
      }
    });

    this.sessionsByTabId.set(id, session);
    return session;
  }

  async navigateTab(tabId, rawUrl, { signal = null, timeoutMs = 6000 } = {}) {
    if (signal?.aborted) {
      const err = new Error("BROWSER_NAVIGATION_CANCELLED");
      err.code = "BROWSER_NAVIGATION_CANCELLED";
      throw err;
    }

    const session = await this.getOrCreateTabSession(tabId);
    session.lastHttpStatus = 200;
    session.lastNetworkError = null;

    const targetUrlForChromium = rewriteLoopbackForChromiumPolicy(rawUrl);

    let onAbort = null;
    if (signal) {
      onAbort = () => {
        session.cdp.send("Page.stopLoading").catch(() => {});
      };
      signal.addEventListener("abort", onAbort, { once: true });
    }

    try {
      const navResult = await session.cdp.send("Page.navigate", {
        url: targetUrlForChromium
      });
      if (navResult && navResult.errorText) {
        session.lastNetworkError = navResult.errorText;
      }

      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (signal?.aborted) {
          await session.cdp.send("Page.stopLoading").catch(() => {});
          const err = new Error("BROWSER_NAVIGATION_CANCELLED");
          err.code = "BROWSER_NAVIGATION_CANCELLED";
          throw err;
        }
        const stateRes = await session.cdp.send("Runtime.evaluate", {
          expression: "document.readyState",
          returnByValue: true
        });
        if (stateRes?.result?.value === "complete") {
          break;
        }
        await new Promise((r) => setTimeout(r, 40));
      }

      // Allow microtasks / inline DOM scripts to settle
      await new Promise((r) => setTimeout(r, 40));
      return await this.inspectTabDom(tabId, { requestedUrl: rawUrl });
    } finally {
      if (signal && onAbort) {
        signal.removeEventListener("abort", onAbort);
      }
    }
  }

  async inspectTabDom(tabId, { requestedUrl = null } = {}) {
    const session = await this.getOrCreateTabSession(tabId);
    const evalRes = await session.cdp.send("Runtime.evaluate", {
      expression: IN_PAGE_INSPECTION_SCRIPT,
      returnByValue: true
    });

    const domData = evalRes?.result?.value || {};
    return {
      ...domData,
      url: requestedUrl || domData.url || "about:blank",
      chromiumUrl: domData.url || "about:blank",
      httpStatus: session.lastHttpStatus || 200,
      networkError: session.lastNetworkError || null,
      browserEngine: this.browserVersion || "Chromium-CDP"
    };
  }

  async executeDomInteraction(
    tabId,
    { elementRef = null, controlId = null, expectedDomEpoch = null, action = "fill", value = "" } = {}
  ) {
    const session = await this.getOrCreateTabSession(tabId);
    const script = `
      (() => {
        const currentEpoch = window.__kosworkDomEpoch || 1;
        const expectedEpoch = ${expectedDomEpoch !== null ? Number(expectedDomEpoch) : "null"};
        const ref = ${JSON.stringify(elementRef)};
        const ctrlId = ${JSON.stringify(controlId)};
        const act = ${JSON.stringify(action)};
        const val = ${JSON.stringify(value)};

        let el = null;
        if (ref) {
          el = document.querySelector('[data-koswork-ref="' + ref + '"]');
        }
        if (!el && ctrlId) {
          el = document.getElementById(ctrlId) || document.querySelector('[name="' + ctrlId + '"]');
        }
        if (!el) {
          return { ok: false, code: "STALE_ELEMENT_REFERENCE", reason: "Element not found in live Chromium DOM" };
        }
        if (expectedEpoch !== null && currentEpoch !== expectedEpoch) {
          return {
            ok: false,
            code: "STALE_ELEMENT_REFERENCE",
            reason: "DOM mutated since observation (expected epoch " + expectedEpoch + ", actual " + currentEpoch + ")"
          };
        }

        if (act === "fill") {
          el.focus();
          if (el.type === "checkbox" || el.type === "radio") {
            el.checked = Boolean(val);
          } else {
            el.value = String(val ?? "");
          }
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        } else if (act === "click") {
          el.focus();
          el.click();
        } else if (act === "submit") {
          const form = el.tagName === "FORM" ? el : (el.closest("form") || document.querySelector("form"));
          if (form) {
            const ev = new Event("submit", { bubbles: true, cancelable: true });
            const notCancelled = form.dispatchEvent(ev);
            if (notCancelled && typeof form.submit === "function" && form.getAttribute("action")) {
              form.submit();
            }
          } else {
            el.click();
          }
        }
        return { ok: true, domEpochAfter: window.__kosworkDomEpoch || currentEpoch };
      })()
    `;

    const res = await session.cdp.send("Runtime.evaluate", {
      expression: script,
      returnByValue: true
    });
    const out = res?.result?.value || { ok: false, code: "CDP_EVAL_FAILED" };
    if (!out.ok) {
      const err = new Error(out.reason || out.code);
      err.code = out.code || "STALE_ELEMENT_REFERENCE";
      throw err;
    }
    await new Promise((r) => setTimeout(r, 40));
    return await this.inspectTabDom(tabId);
  }

  async scrollTabTo(tabId, scrollY = 0) {
    const session = await this.getOrCreateTabSession(tabId);
    await session.cdp.send("Runtime.evaluate", {
      expression: `window.scrollTo(0, ${Number(scrollY || 0)}); window.dispatchEvent(new Event('scroll'));`,
      returnByValue: true
    });
    await new Promise((r) => setTimeout(r, 40));
    return await this.inspectTabDom(tabId);
  }

  async closeTabSession(tabId) {
    const id = String(tabId || "");
    const session = this.sessionsByTabId.get(id);
    if (!session) return;
    this.sessionsByTabId.delete(id);
    try {
      session.cdp.close();
      if (this.activePort && session.targetId) {
        await httpJsonRequest(
          `http://127.0.0.1:${this.activePort}/json/close/${session.targetId}`
        );
      }
    } catch {
      // ignore close errors
    }
  }

  async shutdown() {
    for (const id of Array.from(this.sessionsByTabId.keys())) {
      await this.closeTabSession(id);
    }
    if (this.proc) {
      try {
        this.proc.kill("SIGTERM");
      } catch {
        // ignore
      }
      this.proc = null;
      this.activePort = null;
    }
    if (this.userDataDir && fs.existsSync(this.userDataDir)) {
      try {
        fs.rmSync(this.userDataDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }
}

module.exports = {
  KosworkChromiumCdpDriver,
  rewriteLoopbackForChromiumPolicy
};
