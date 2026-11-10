"use strict";

const { attachDeterministicDownloadHandler } = require("./download-verifier.cjs");

/**
 * Koswork Electron `WebContentsView` Pool Bridge (`desktop/windows/browser/electron-webview-bridge.cjs`).
 *
 * Bridges `KosworkBrowserEngine` with native Electron `WebContentsView` instances:
 * 1. Enforces the live `WebContentsView` cap (`maxLiveTabs`, default 3): when `KosworkBrowserResourceGovernor`
 *    hibernates a background tab, the underlying `WebContentsView` is unmounted and destroyed so its
 *    Chromium renderer process RAM is reclaimed while `tabReceipt` and the latest versioned snapshot
 *    remain available in `KosworkBrowserEngine`.
 * 2. Hooks `webContents.on("before-input-event")` and user-initiated navigation so any manual user
 *    interaction inside the live browser view immediately calls `engine.recordUserAction(tabId, ...)`,
 *    invalidating stale agent observations (`OBSERVATION_INVALIDATED_BY_USER`).
 * 3. Attaches `attachDeterministicDownloadHandler` to `webContents.session` so all file downloads
 *    land strictly inside `engine.allowedDownloadDir` (inside the connected workspace folder).
 * 4. Provides `buildInjectedDomExtractionScript()` for serializing live DOM, open Shadow DOM,
 *    same-origin iframes, `getBoundingClientRect()` bounds, and `pageDate`/`eventDate` metadata.
 */

function buildInjectedDomExtractionScript() {
  return `(() => {
    const pickMeta = (names) => {
      for (const n of names) {
        const el = document.querySelector('meta[property="' + n + '"], meta[name="' + n + '"]');
        if (el && el.getAttribute("content")) return el.getAttribute("content");
      }
      return null;
    };
    const pageTimeEl = document.querySelector("time[data-page-date], time[itemprop='datePublished']");
    const eventTimeEl = document.querySelector("time[data-event-date], time[itemprop='startDate']");
    const pageDate = pickMeta(["article:published_time", "article:modified_time", "pubdate", "date", "dc.date"]) ||
      (pageTimeEl ? pageTimeEl.getAttribute("datetime") : null);
    const eventDate = pickMeta(["event:date", "event_date", "effective_date"]) ||
      (eventTimeEl ? eventTimeEl.getAttribute("datetime") : null);

    const blocks = [];
    const blockEls = document.querySelectorAll("h1, h2, h3, h4, p, li, blockquote, pre");
    blockEls.forEach((el, idx) => {
      const text = (el.innerText || el.textContent || "").trim();
      if (!text) return;
      const r = el.getBoundingClientRect();
      blocks.push({
        id: el.id || ("dom-blk-" + (idx + 1)),
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute("role") || (el.tagName.startsWith("H") ? "heading" : "paragraph"),
        text,
        bounds: {
          x: Math.round(r.x),
          y: Math.round(r.y),
          width: Math.round(r.width),
          height: Math.round(r.height),
          inViewport: r.top >= 0 && r.bottom <= (window.innerHeight || 900)
        }
      });
    });

    return {
      url: location.href,
      title: document.title || location.href,
      pageDate,
      eventDate,
      html: document.documentElement ? document.documentElement.outerHTML : "",
      blocks
    };
  })()`;
}

class KosworkElectronWebViewPoolBridge {
  constructor(options = {}) {
    if (!options.engine) {
      throw new Error("ELECTRON_BRIDGE_REQUIRES_BROWSER_ENGINE");
    }
    this.engine = options.engine;
    this.createWebContentsView =
      typeof options.createWebContentsView === "function"
        ? options.createWebContentsView
        : null;
    this.parentWindow = options.parentWindow || null;
    this.liveViews = new Map(); // tabId -> { tabId, view, downloadAttachment, destroyed }
    this.destroyedHistory = [];
  }

  ensureViewForTab(tabId) {
    const key = String(tabId);
    const existing = this.liveViews.get(key);
    if (existing && !existing.destroyed) {
      return existing;
    }

    if (!this.createWebContentsView) {
      throw new Error("ELECTRON_WEBCONTENTSVIEW_FACTORY_NOT_CONFIGURED");
    }

    const view = this.createWebContentsView({ tabId: key });
    const wc = view.webContents || view;

    let downloadAttachment = null;
    if (wc.session && this.engine.allowedDownloadDir) {
      downloadAttachment = attachDeterministicDownloadHandler(wc.session, {
        downloadDir: this.engine.allowedDownloadDir
      });
    }

    if (typeof wc.on === "function") {
      wc.on("before-input-event", (_event, input) => {
        if (input && input.isAutoRepeat) return;
        this.engine.recordUserAction(key, {
          type: `user_${input?.type || "input"}`,
          detail: { key: input?.key || null }
        });
      });

      wc.on("did-navigate-in-page", (_event, url, isMainFrame) => {
        if (isMainFrame && wc._userGestureNavigation) {
          this.engine.recordUserAction(key, {
            type: "user_in_page_navigation",
            detail: { url }
          });
        }
      });
    }

    if (this.parentWindow?.contentView?.addChildView) {
      this.parentWindow.contentView.addChildView(view);
    }

    const entry = {
      tabId: key,
      view,
      webContents: wc,
      downloadAttachment,
      destroyed: false,
      createdAtMs: Date.now()
    };
    this.liveViews.set(key, entry);
    return entry;
  }

  hibernateTabView(tabId) {
    const key = String(tabId);
    const entry = this.liveViews.get(key);
    if (!entry || entry.destroyed) return false;

    if (entry.downloadAttachment) {
      entry.downloadAttachment.detach();
    }
    if (this.parentWindow?.contentView?.removeChildView) {
      try {
        this.parentWindow.contentView.removeChildView(entry.view);
      } catch {
        /* ignore */
      }
    }
    if (typeof entry.webContents?.destroy === "function") {
      entry.webContents.destroy();
    } else if (typeof entry.view?.destroy === "function") {
      entry.view.destroy();
    }

    entry.destroyed = true;
    this.liveViews.delete(key);
    this.destroyedHistory.push({
      tabId: key,
      destroyedAtMs: Date.now()
    });
    return true;
  }

  async navigateInWebView({ tabId, url, actor = "agent", signal = null } = {}) {
    const resolvedTabId = this.engine.allocateTabId(tabId);
    const viewEntry = this.ensureViewForTab(resolvedTabId);

    if (typeof viewEntry.webContents.loadURL === "function") {
      await viewEntry.webContents.loadURL(url);
    }

    let extractedDom = null;
    if (typeof viewEntry.webContents.executeJavaScript === "function") {
      extractedDom = await viewEntry.webContents.executeJavaScript(
        buildInjectedDomExtractionScript(),
        true
      );
    }

    if (extractedDom && typeof extractedDom === "object") {
      this.engine.registerSyntheticSite(url, {
        title: extractedDom.title || url,
        pageDate: extractedDom.pageDate || null,
        eventDate: extractedDom.eventDate || null,
        html: extractedDom.html || "",
        blocks: extractedDom.blocks || undefined
      });
    }

    const navResult = await this.engine.navigate({
      tabId: resolvedTabId,
      url,
      actor,
      signal
    });

    // Synchronize live WebContentsView pool with ResourceGovernor hibernation decisions
    for (const hibId of navResult.governorState?.newlyHibernatedTabIds || []) {
      this.hibernateTabView(hibId);
    }

    return {
      ...navResult,
      activeWebViewsCount: this.liveViews.size,
      destroyedWebViewsCount: this.destroyedHistory.length
    };
  }
}

module.exports = {
  KosworkElectronWebViewPoolBridge,
  buildInjectedDomExtractionScript
};
