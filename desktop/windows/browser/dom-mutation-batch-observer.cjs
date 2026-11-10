"use strict";

const { buildVersionedPageSnapshot } = require("./document.cjs");

/**
 * Koswork Live DOM Mutation Batch Observer & UTF-16 Excerpt Re-Anchoring Engine
 * (`desktop/windows/browser/dom-mutation-batch-observer.cjs`).
 *
 * Deepens Requirement #3, #4 & #7:
 * - Records batched live DOM mutations (`childList`, `characterData`, `attributes`,
 *   `banner_injected`, `text_substitution`) on an open browser tab.
 * - Advances the versioned document snapshot (`pageVersion + 1`) while preserving tab receipts.
 * - Re-anchors previously extracted UTF-16 citations (`[startUtf16..endUtf16]`) in the
 *   new snapshot version when a prefix insertion shifts character offsets, OR flags
 *   `POST_OBSERVATION_TEXT_SUBSTITUTION_DETECTED` if the quoted text itself was altered
 *   or substituted after initial observation.
 */

class KosworkDomMutationBatchObserver {
  constructor({ engine } = {}) {
    if (!engine) {
      throw new Error("KosworkDomMutationBatchObserver requires a browser engine instance");
    }
    this.engine = engine;
    this.mutationHistoryByTab = new Map();
  }

  applyMutationBatchAndReanchor({
    tabId,
    mutations = [],
    nextText = null,
    nextHtml = null,
    trackedExcerpts = []
  } = {}) {
    const id = String(tabId || "");
    const tab = this.engine.tabs.get(id);
    const prevSnapshot = tab?.snapshot || tab?.currentSnapshot;
    if (!tab || !prevSnapshot) {
      const err = new Error(`Active tab not found for DOM mutation observation: ${id}`);
      err.code = "BROWSER_TAB_NOT_FOUND";
      throw err;
    }

    const prevText = String(prevSnapshot.fullTextUtf16 || prevSnapshot.text || "");
    let updatedText = nextText !== null ? String(nextText) : prevText;

    for (const mut of mutations || []) {
      if (mut.kind === "prepend_banner" && mut.insertedText) {
        updatedText = `${mut.insertedText}\n${updatedText}`;
      } else if (mut.kind === "append_section" && mut.insertedText) {
        updatedText = `${updatedText}\n${mut.insertedText}`;
      } else if (mut.kind === "replace_substring" && mut.targetText) {
        updatedText = updatedText.replace(mut.targetText, String(mut.replacementText ?? ""));
      }
    }

    const prevVersion = Number(prevSnapshot.pageVersion ?? prevSnapshot.version ?? 1);
    const nextVersion = prevVersion + 1;
    const nextSnapshot = buildVersionedPageSnapshot(
      {
        title: prevSnapshot.title,
        text: updatedText,
        html: nextHtml !== null ? nextHtml : prevSnapshot.html || "",
        pageDate: prevSnapshot.pageDate,
        eventDate: prevSnapshot.eventDate,
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

    const fullNextText = String(nextSnapshot.fullTextUtf16 || nextSnapshot.text || updatedText);
    const reanchoredExcerpts = [];
    const substitutedExcerpts = [];

    for (const exc of trackedExcerpts || []) {
      const quote = String(exc?.quote || "");
      if (!quote) continue;
      const newIdx = fullNextText.indexOf(quote);
      if (newIdx >= 0) {
        const deltaUtf16 = newIdx - Number(exc.startUtf16 ?? 0);
        reanchoredExcerpts.push({
          ...exc,
          previousVersion: prevVersion,
          reanchoredVersion: nextVersion,
          previousStartUtf16: exc.startUtf16,
          previousEndUtf16: exc.endUtf16,
          startUtf16: newIdx,
          endUtf16: newIdx + quote.length,
          deltaUtf16,
          status: deltaUtf16 === 0 ? "unchanged_offset" : "reanchored_after_shift"
        });
      } else {
        substitutedExcerpts.push({
          ...exc,
          previousVersion: prevVersion,
          checkedVersion: nextVersion,
          code: "POST_OBSERVATION_TEXT_SUBSTITUTION_DETECTED",
          status: "substituted_or_removed"
        });
      }
    }

    const batchRecord = {
      tabId: id,
      recordedAt: new Date().toISOString(),
      previousVersion: prevVersion,
      nextVersion,
      mutationCount: (mutations || []).length,
      charLengthDelta: fullNextText.length - prevText.length,
      reanchoredCount: reanchoredExcerpts.length,
      substitutedCount: substitutedExcerpts.length
    };

    if (!this.mutationHistoryByTab.has(id)) {
      this.mutationHistoryByTab.set(id, []);
    }
    this.mutationHistoryByTab.get(id).push(batchRecord);

    return {
      tabId: id,
      previousVersion: prevVersion,
      nextVersion,
      charLengthDelta: batchRecord.charLengthDelta,
      reanchoredExcerpts,
      substitutedExcerpts,
      hasTextSubstitutionAlert: substitutedExcerpts.length > 0,
      snapshot: nextSnapshot
    };
  }
}

module.exports = {
  KosworkDomMutationBatchObserver
};
