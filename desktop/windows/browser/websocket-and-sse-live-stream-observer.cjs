"use strict";

const { buildVersionedPageSnapshot } = require("./document.cjs");

/**
 * Koswork WebSocket & Server-Sent Events (SSE) Live Stream Frame Observer
 * (`desktop/windows/browser/websocket-and-sse-live-stream-observer.cjs`).
 *
 * Deepens Requirements #3, #6 & #7:
 * - Captures bounded batches of Server-Sent Events (`text/event-stream`) or WebSocket
 *   text frames on an active browser tab.
 * - Materializes the accumulated stream frames into a versioned document snapshot
 *   (`pageVersion + 1`) so live stream messages can be cited with exact UTF-16
 *   `[startUtf16..endUtf16]` offsets and distinct `eventDate` (from frame event payload)
 *   vs `pageDate` vs `fetchedAt`.
 * - Enforces `maxFramesPerBatch` and `maxStreamBytes` resource caps and honours
 *   `AbortSignal` (`BROWSER_STREAM_CANCELLED`).
 */

class KosworkLiveStreamFrameObserver {
  constructor({ engine, maxFramesPerBatch = 50, maxStreamBytes = 256 * 1024 } = {}) {
    if (!engine) {
      throw new Error("KosworkLiveStreamFrameObserver requires a browser engine instance");
    }
    this.engine = engine;
    this.maxFramesPerBatch = Number(maxFramesPerBatch || 50);
    this.maxStreamBytes = Number(maxStreamBytes || 256 * 1024);
  }

  ingestStreamBatchIntoTabSnapshot({
    tabId,
    protocol = "sse",
    rawSseWireText = "",
    frames = [],
    signal = null
  } = {}) {
    if (signal && signal.aborted) {
      const err = new Error("Live stream capture aborted by AbortSignal");
      err.code = "BROWSER_STREAM_CANCELLED";
      throw err;
    }

    const id = String(tabId || "");
    const tab = this.engine.tabs.get(id);
    const prevSnapshot = tab?.snapshot;
    if (!tab || !prevSnapshot) {
      const err = new Error(`Active tab not found for live stream observation: ${id}`);
      err.code = "BROWSER_TAB_NOT_FOUND";
      throw err;
    }

    const parsedFrames = [];
    if (rawSseWireText) {
      const blocks = String(rawSseWireText)
        .split(/\r?\n\r?\n/)
        .map((b) => b.trim())
        .filter(Boolean);
      for (const blk of blocks) {
        let eventName = "message";
        let eventId = null;
        const dataLines = [];
        for (const line of blk.split(/\r?\n/)) {
          if (line.startsWith("event:")) eventName = line.slice(6).trim();
          else if (line.startsWith("id:")) eventId = line.slice(3).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
        }
        const dataText = dataLines.join(" ");
        if (dataText) {
          parsedFrames.push({
            protocol: "sse",
            eventName,
            eventId,
            dataText,
            eventDate: this._extractIsoDateFromText(dataText)
          });
        }
      }
    }

    for (const f of frames || []) {
      const dataText = String(f?.dataText || f?.data || "").trim();
      if (!dataText) continue;
      parsedFrames.push({
        protocol: protocol || "websocket",
        eventName: f.eventName || "ws_frame",
        eventId: f.eventId || null,
        dataText,
        eventDate: f.eventDate || this._extractIsoDateFromText(dataText)
      });
    }

    const boundedFrames = parsedFrames.slice(0, this.maxFramesPerBatch);
    const formattedLines = [];
    let accumulatedBytes = 0;

    for (const frame of boundedFrames) {
      const line = `[STREAM:${frame.protocol.toUpperCase()}:${frame.eventName}] ${frame.dataText}`;
      const lineBytes = Buffer.byteLength(line, "utf8");
      if (accumulatedBytes + lineBytes > this.maxStreamBytes) {
        break;
      }
      accumulatedBytes += lineBytes;
      formattedLines.push(line);
    }

    const prevText = String(prevSnapshot.fullTextUtf16 || prevSnapshot.text || "");
    const appendedBlock = formattedLines.join("\n");
    const updatedText = prevText ? `${prevText}\n${appendedBlock}` : appendedBlock;

    const latestFrameEventDate =
      boundedFrames
        .map((f) => f.eventDate)
        .filter(Boolean)
        .sort()
        .pop() || prevSnapshot.eventDate;

    const nextVersion = Number(prevSnapshot.pageVersion ?? 1) + 1;
    const nextSnapshot = buildVersionedPageSnapshot(
      {
        title: prevSnapshot.title,
        text: updatedText,
        html: prevSnapshot.html || "",
        pageDate: prevSnapshot.pageDate,
        eventDate: latestFrameEventDate,
        httpStatus: prevSnapshot.httpStatus ?? 200,
        controls: prevSnapshot.controls || [],
        frames: prevSnapshot.frames || [],
        tables: prevSnapshot.tables || []
      },
      {
        tabId: id,
        pageVersion: nextVersion,
        url: prevSnapshot.url,
        fetchedAt: prevSnapshot.fetchedAt
      }
    );

    tab.pageVersion = nextVersion;
    tab.snapshot = nextSnapshot;
    tab.lastObservation = nextSnapshot;

    const fullNextText = String(nextSnapshot.fullTextUtf16 || nextSnapshot.text || "");
    const frameReceipts = formattedLines.map((line, idx) => {
      const startUtf16 = fullNextText.indexOf(line);
      return {
        frameIndex: idx + 1,
        quote: line,
        startUtf16,
        endUtf16: startUtf16 >= 0 ? startUtf16 + line.length : -1,
        eventDate: boundedFrames[idx]?.eventDate || null
      };
    });

    return {
      tabId: id,
      previousVersion: prevSnapshot.pageVersion ?? 1,
      nextVersion,
      ingestedFramesCount: frameReceipts.length,
      accumulatedBytes,
      eventDate: nextSnapshot.eventDate,
      pageDate: nextSnapshot.pageDate,
      fetchedAt: nextSnapshot.fetchedAt,
      frameReceipts,
      snapshot: nextSnapshot
    };
  }

  _extractIsoDateFromText(text = "") {
    const m = String(text || "").match(/\b(\d{4}-\d{2}-\d{2})\b/);
    return m ? m[1] : null;
  }
}

module.exports = {
  KosworkLiveStreamFrameObserver
};
