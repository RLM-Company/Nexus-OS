"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { writeAtomicJson, readJsonFileSafe } = require("../desktop-state.cjs");

/**
 * Koswork Research Session Checkpoint & Resume Manager
 * (`desktop/windows/browser/session-checkpoint-recovery.cjs`).
 *
 * Persists atomic checkpoints of multi-site browser research sessions inside the
 * allowed workspace folder (`<workspaceRoot>/.koswork-research/checkpoints/`),
 * enabling deterministic pause & resume across:
 * - CAPTCHA / authentication walls (`status: "paused_for_user"`),
 * - Cooperative task cancellation (`status: "cancelled"`),
 * - Process restarts without re-fetching already-verified sources.
 */
class KosworkResearchSessionCheckpointManager {
  constructor(options = {}) {
    if (!options.workspaceRoot) {
      throw new Error("CHECKPOINT_MANAGER_REQUIRES_WORKSPACE_ROOT");
    }
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.checkpointDir = path.join(this.workspaceRoot, ".koswork-research", "checkpoints");
    fs.mkdirSync(this.checkpointDir, { recursive: true });
  }

  resolveCheckpointPath(sessionId) {
    const safeId = String(sessionId || "default-session").replace(/[^a-zA-Z0-9._-]/g, "_");
    const target = path.resolve(this.checkpointDir, `${safeId}.checkpoint.json`);
    if (!target.startsWith(this.checkpointDir + path.sep)) {
      throw new Error("CHECKPOINT_PATH_TRAVERSAL_BLOCKED");
    }
    return target;
  }

  saveCheckpoint(checkpoint = {}) {
    if (!checkpoint.sessionId) {
      throw new Error("CHECKPOINT_SESSION_ID_REQUIRED");
    }
    const filePath = this.resolveCheckpointPath(checkpoint.sessionId);
    const payload = {
      schemaVersion: "koswork.browser-research.checkpoint.v1",
      sessionId: checkpoint.sessionId,
      question: checkpoint.question || "",
      criteria: Array.isArray(checkpoint.criteria) ? checkpoint.criteria : [],
      status: checkpoint.status || "paused_for_user",
      pauseReason: checkpoint.pauseReason || null,
      completedUrls: Array.isArray(checkpoint.completedUrls) ? checkpoint.completedUrls : [],
      pendingItems: Array.isArray(checkpoint.pendingItems) ? checkpoint.pendingItems : [],
      verifiedSources: Array.isArray(checkpoint.verifiedSources) ? checkpoint.verifiedSources : [],
      verifiedClaims: Array.isArray(checkpoint.verifiedClaims) ? checkpoint.verifiedClaims : [],
      savedAt: new Date().toISOString()
    };
    writeAtomicJson(filePath, payload);
    return {
      filePath,
      checkpoint: payload
    };
  }

  loadCheckpoint(sessionId) {
    const filePath = this.resolveCheckpointPath(sessionId);
    const data = readJsonFileSafe(filePath, null);
    if (!data) {
      return null;
    }
    return data;
  }

  listCheckpoints() {
    if (!fs.existsSync(this.checkpointDir)) return [];
    return fs
      .readdirSync(this.checkpointDir)
      .filter((f) => f.endsWith(".checkpoint.json"))
      .map((f) => readJsonFileSafe(path.join(this.checkpointDir, f), null))
      .filter(Boolean);
  }

  /**
   * Resumes a checkpointed research batch on `engine`: skips already-verified
   * `completedUrls`, processes only `pendingItems`, and merges all verified sources
   * and claims into a unified completed session state.
   */
  async resumeResearchFromCheckpoint({ sessionId, engine, signal = null } = {}) {
    const cp = this.loadCheckpoint(sessionId);
    if (!cp) {
      const err = new Error(`CHECKPOINT_NOT_FOUND: ${sessionId}`);
      err.code = "CHECKPOINT_NOT_FOUND";
      throw err;
    }

    const completedSet = new Set(cp.completedUrls || []);
    const allSources = [...(cp.verifiedSources || [])];
    const allClaims = [...(cp.verifiedClaims || [])];
    const newlyProcessedUrls = [];
    const skippedCompletedUrls = [...completedSet];

    for (let i = 0; i < (cp.pendingItems || []).length; i += 1) {
      if (signal?.aborted) {
        this.saveCheckpoint({
          ...cp,
          status: "cancelled",
          completedUrls: Array.from(completedSet),
          pendingItems: cp.pendingItems.slice(i),
          verifiedSources: allSources,
          verifiedClaims: allClaims
        });
        return {
          status: "cancelled",
          sessionId,
          skippedCompletedUrls,
          newlyProcessedUrls,
          sources: allSources,
          claims: allClaims
        };
      }

      const item = cp.pendingItems[i];
      if (completedSet.has(item.url)) {
        continue;
      }

      const tabId = item.tabId || `resume-tab-${(i % 3) + 1}`;
      const nav = await engine.navigate({
        tabId,
        url: item.url,
        actor: "agent",
        signal
      });

      if (nav.status === "paused_for_user") {
        this.saveCheckpoint({
          ...cp,
          status: "paused_for_user",
          pauseReason: nav.pauseReason,
          completedUrls: Array.from(completedSet),
          pendingItems: cp.pendingItems.slice(i),
          verifiedSources: allSources,
          verifiedClaims: allClaims
        });
        return {
          status: "paused_for_user",
          sessionId,
          pausedUrl: item.url,
          pauseReason: nav.pauseReason,
          skippedCompletedUrls,
          newlyProcessedUrls,
          sources: allSources,
          claims: allClaims
        };
      }

      allSources.push({
        url: nav.url,
        title: nav.snapshot.title,
        httpStatus: nav.httpStatus,
        available: nav.available,
        pageDate: nav.pageDate,
        eventDate: nav.eventDate,
        fetchedAt: nav.fetchedAt,
        tabReceipt: nav.tabReceipt
      });

      if (nav.available && item.searchTerm) {
        const exc = engine.extractExcerpt(tabId, { searchTerm: item.searchTerm });
        if (exc) {
          allClaims.push({
            claimId: item.claimId || `resumed-claim-${allClaims.length + 1}`,
            optionName: item.optionName || "Option",
            criterion: item.criterion || "Spec",
            value: item.value || exc.quote,
            claim: item.claimText || exc.quote,
            excerpt: exc,
            source: {
              url: nav.url,
              title: nav.snapshot.title,
              pageDate: nav.pageDate,
              eventDate: nav.eventDate,
              fetchedAt: nav.fetchedAt
            }
          });
        }
      }

      completedSet.add(item.url);
      newlyProcessedUrls.push(item.url);
    }

    const finalCp = this.saveCheckpoint({
      ...cp,
      status: "completed",
      pauseReason: null,
      completedUrls: Array.from(completedSet),
      pendingItems: [],
      verifiedSources: allSources,
      verifiedClaims: allClaims
    });

    return {
      status: "completed",
      sessionId,
      skippedCompletedUrls,
      newlyProcessedUrls,
      sources: allSources,
      claims: allClaims,
      checkpoint: finalCp.checkpoint
    };
  }
}

module.exports = {
  KosworkResearchSessionCheckpointManager
};
