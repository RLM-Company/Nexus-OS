"use strict";

/**
 * Koswork Browser Observation Integrity, Stale Element Ref & User Takeover Recovery
 * (`desktop/windows/browser/recovery.cjs`).
 *
 * Ensures:
 * - Stale element references (`elementRef`) or stale snapshots (`pageVersion`, `domEpoch`)
 *   are rejected before mutating actions (`STALE_ELEMENT_REFERENCE`, `OBSERVATION_STALE_REOBSERVE_REQUIRED`).
 * - Manual user takeover actions increment `userEpoch` and invalidate prior agent observations
 *   (`OBSERVATION_INVALIDATED_BY_USER`) until a fresh observation is performed.
 * - Post-observation text substitution on a page is detected (`OBSERVATION_TEXT_SUBSTITUTED_SINCE_READ`).
 */

class KosworkBrowserRecoveryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "KosworkBrowserRecoveryError";
    this.code = code;
    this.details = details;
  }
}

class UserTakeoverTracker {
  constructor() {
    this.tabState = new Map();
  }

  getCurrentEpoch(tabId) {
    return this.tabState.get(String(tabId))?.epoch ?? 0;
  }

  recordUserAction(tabId, action = {}) {
    const id = String(tabId);
    const prev = this.tabState.get(id) || { epoch: 0, activeTakeover: false, history: [] };
    const nextEpoch = prev.epoch + 1;
    const entry = {
      epoch: nextEpoch,
      type: action.type || "manual_user_interaction",
      detail: action.detail || null,
      recordedAt: new Date().toISOString()
    };
    const next = {
      epoch: nextEpoch,
      activeTakeover: action.holdTakeover === true,
      lastAction: entry,
      history: [...prev.history.slice(-19), entry]
    };
    this.tabState.set(id, next);
    return next;
  }

  releaseTakeover(tabId) {
    const id = String(tabId);
    const prev = this.tabState.get(id);
    if (prev) {
      prev.activeTakeover = false;
    }
    return prev || { epoch: 0, activeTakeover: false };
  }
}

function verifyTabReceipt(tabReceipt, currentTabState) {
  if (!currentTabState || currentTabState.closed) {
    throw new KosworkBrowserRecoveryError(
      "TAB_LOST_OR_CLOSED",
      `Вкладка "${tabReceipt?.tabId || "unknown"}" была закрыта или потеряна.`,
      { tabReceipt }
    );
  }
  if (tabReceipt && tabReceipt.tabId && String(tabReceipt.tabId) !== String(currentTabState.tabId)) {
    throw new KosworkBrowserRecoveryError(
      "TAB_RECEIPT_MISMATCH",
      `Квитанция вкладки (${tabReceipt.tabId}) не совпадает с текущей вкладкой (${currentTabState.tabId}).`,
      { tabReceipt, currentTabId: currentTabState.tabId }
    );
  }
}

function findRecoveryCandidates(currentSnapshot, targetSpec = {}) {
  const controls = Array.isArray(currentSnapshot?.controls) ? currentSnapshot.controls : [];
  const wantedId = String(targetSpec.controlId || "").toLowerCase();
  const wantedRef = String(targetSpec.elementRef || "").toLowerCase();
  const wantedLabel = String(targetSpec.label || "").toLowerCase();

  return controls
    .filter((c) => {
      if (wantedRef && String(c.elementRef || "").toLowerCase() === wantedRef) return true;
      if (wantedId && (String(c.id || "").toLowerCase() === wantedId || String(c.name || "").toLowerCase() === wantedId)) {
        return true;
      }
      if (wantedLabel && String(c.label || "").toLowerCase().includes(wantedLabel)) return true;
      return false;
    })
    .map((c) => ({
      elementRef: c.elementRef,
      id: c.id,
      tag: c.tag,
      label: c.label,
      bounds: c.bounds
    }));
}

function verifyObservationIntegrity({
  observedSnapshot,
  currentSnapshot,
  targetSpec = null,
  userTakeoverTracker = null
} = {}) {
  if (!observedSnapshot || !currentSnapshot) {
    throw new KosworkBrowserRecoveryError(
      "OBSERVATION_REQUIRED",
      "Перед выполнением действия необходимо выполнить свежее наблюдение страницы (observePage)."
    );
  }

  const tabId = currentSnapshot.tabReceipt?.tabId || currentSnapshot.tabId;
  if (userTakeoverTracker && tabId) {
    const currentEpoch = userTakeoverTracker.getCurrentEpoch(tabId);
    const observedEpoch = observedSnapshot.userEpoch ?? 0;
    if (currentEpoch !== observedEpoch) {
      throw new KosworkBrowserRecoveryError(
        "OBSERVATION_INVALIDATED_BY_USER",
        "Пользователь выполнил ручное действие во вкладке; наблюдение агента устарело и требует повторного чтения страницы.",
        {
          tabId,
          observedUserEpoch: observedEpoch,
          currentUserEpoch: currentEpoch,
          recoveryCandidates: targetSpec ? findRecoveryCandidates(currentSnapshot, targetSpec) : []
        }
      );
    }
  }

  if (
    observedSnapshot.snapshotId !== currentSnapshot.snapshotId ||
    observedSnapshot.pageVersion !== currentSnapshot.pageVersion ||
    (observedSnapshot.domEpoch &&
      currentSnapshot.domEpoch &&
      observedSnapshot.domEpoch !== currentSnapshot.domEpoch)
  ) {
    const textChanged = observedSnapshot.textSha256 !== currentSnapshot.textSha256;
    const code = textChanged
      ? "OBSERVATION_TEXT_SUBSTITUTED_SINCE_READ"
      : "OBSERVATION_STALE_REOBSERVE_REQUIRED";
    throw new KosworkBrowserRecoveryError(
      code,
      textChanged
        ? "Текст страницы или DOM изменился после наблюдения (пост-наблюдательная подмена текста). Действие отклонено до повторного наблюдения."
        : "Версия страницы изменилась после наблюдения. Выполните свежее наблюдение (observePage).",
      {
        observedVersion: observedSnapshot.pageVersion,
        currentVersion: currentSnapshot.pageVersion,
        observedDomEpoch: observedSnapshot.domEpoch,
        currentDomEpoch: currentSnapshot.domEpoch,
        recoveryCandidates: targetSpec ? findRecoveryCandidates(currentSnapshot, targetSpec) : []
      }
    );
  }

  if (targetSpec && targetSpec.elementRef) {
    const match = (currentSnapshot.controls || []).find(
      (c) => c.elementRef === targetSpec.elementRef
    );
    if (!match) {
      throw new KosworkBrowserRecoveryError(
        "STALE_ELEMENT_REFERENCE",
        `Ссылка на элемент "${targetSpec.elementRef}" устарела или отсутствует в текущем DOM.`,
        {
          elementRef: targetSpec.elementRef,
          recoveryCandidates: findRecoveryCandidates(currentSnapshot, targetSpec)
        }
      );
    }
  }

  return { valid: true };
}

module.exports = {
  KosworkBrowserRecoveryError,
  UserTakeoverTracker,
  findRecoveryCandidates,
  verifyObservationIntegrity,
  verifyTabReceipt
};
