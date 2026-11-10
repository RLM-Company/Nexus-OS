"use strict";

/**
 * Koswork Browser Observation Integrity, Recovery Candidates & Manual Takeover Guard
 * (`desktop/windows/browser/recovery.cjs`).
 *
 * Guarantees:
 * 1. Detects tab closure/loss (`TAB_LOST_OR_CLOSED`) and unexpected URL transitions (`TAB_URL_CHANGED`).
 * 2. Detects post-observation text substitution (`OBSERVATION_TEXT_SUBSTITUTED`): if page content
 *    under an observed UTF-16 span or interactive element changed between observation and execution,
 *    refuses to act on the substituted text and returns a structured conflict diagnostic.
 * 3. Computes ranked recovery candidates (`findRecoveryCandidates`) when harmless layout shifts move
 *    an element while preserving its semantic identity.
 * 4. Tracks manual user actions (`UserTakeoverTracker`) so any manual user interaction immediately
 *    invalidates prior agent observations (`OBSERVATION_INVALIDATED_BY_USER`).
 */

class KosworkBrowserRecoveryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "KosworkBrowserRecoveryError";
    this.code = code;
    this.details = details;
  }
}

function tokenizeNormalized(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function computeJaccardTokenSimilarity(a, b) {
  const tokensA = new Set(tokenizeNormalized(a));
  const tokensB = new Set(tokenizeNormalized(b));
  if (tokensA.size === 0 && tokensB.size === 0) return 1;
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection += 1;
  }
  const union = tokensA.size + tokensB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Verifies that a tab receipt is still backed by a live tab and has not been lost or navigated away.
 */
function verifyTabReceipt(tabReceipt, liveTabState) {
  if (!tabReceipt || !tabReceipt.tabId) {
    throw new KosworkBrowserRecoveryError(
      "INVALID_TAB_RECEIPT",
      "Отсутствует корректная квитанция вкладки (tabReceipt)."
    );
  }

  if (!liveTabState || liveTabState.closed === true) {
    throw new KosworkBrowserRecoveryError(
      "TAB_LOST_OR_CLOSED",
      `Вкладка "${tabReceipt.tabId}" была закрыта или потеряна во время выполнения операции.`,
      {
        tabId: tabReceipt.tabId,
        expectedReceiptId: tabReceipt.receiptId,
        expectedUrl: tabReceipt.url
      }
    );
  }

  if (liveTabState.url && tabReceipt.url && liveTabState.url !== tabReceipt.url) {
    throw new KosworkBrowserRecoveryError(
      "TAB_URL_CHANGED",
      `URL вкладки "${tabReceipt.tabId}" изменился с "${tabReceipt.url}" на "${liveTabState.url}". Старое наблюдение больше недействительно.`,
      {
        tabId: tabReceipt.tabId,
        expectedUrl: tabReceipt.url,
        actualUrl: liveTabState.url
      }
    );
  }

  return {
    valid: true,
    tabId: tabReceipt.tabId,
    receiptId: tabReceipt.receiptId,
    versionAdvanced:
      liveTabState.snapshot &&
      Number(liveTabState.snapshot.pageVersion) !== Number(tabReceipt.pageVersion)
  };
}

/**
 * Ranks recovery candidates across blocks or controls when a page version advances due to dynamic layout changes.
 */
function findRecoveryCandidates(targetSpec = {}, currentSnapshot = {}) {
  const kind = targetSpec.kind === "block" ? "block" : "control";
  const pool =
    kind === "block"
      ? Array.isArray(currentSnapshot.blocks)
        ? currentSnapshot.blocks
        : []
      : Array.isArray(currentSnapshot.controls)
        ? currentSnapshot.controls
        : [];

  const candidates = [];

  for (const item of pool) {
    let score = 0;
    const reasons = [];

    const itemId = item.id || item.blockId || null;
    if (targetSpec.id && itemId === targetSpec.id) {
      score += 0.45;
      reasons.push("exact_id");
    }
    if (targetSpec.name && item.name && item.name === targetSpec.name) {
      score += 0.25;
      reasons.push("exact_name");
    }
    if (
      targetSpec.deepSelector &&
      item.deepSelector &&
      item.deepSelector === targetSpec.deepSelector
    ) {
      score += 0.25;
      reasons.push("exact_deep_selector");
    }
    if (targetSpec.role && item.role && item.role === targetSpec.role) {
      score += 0.1;
      reasons.push("matching_role");
    }

    const expectedText = String(targetSpec.expectedText || targetSpec.label || "").trim();
    const actualText = String(item.text || item.label || "").trim();
    let textSimilarity = 1;
    if (expectedText) {
      textSimilarity = computeJaccardTokenSimilarity(expectedText, actualText);
      score += textSimilarity * 0.35;
      if (actualText === expectedText) {
        reasons.push("exact_text");
      } else if (textSimilarity >= 0.7) {
        reasons.push("high_text_similarity");
      }
    }

    if (score > 0.2) {
      candidates.push({
        candidateId: itemId,
        deepSelector: item.deepSelector || item.recoveryAnchors?.deepSelector || null,
        role: item.role || null,
        actualText,
        textSimilarity: Number(textSimilarity.toFixed(3)),
        confidence: Number(Math.min(1, score).toFixed(3)),
        reasons,
        bounds: item.bounds || null,
        startUtf16: item.startUtf16 ?? null,
        endUtf16: item.endUtf16 ?? null
      });
    }
  }

  candidates.sort((a, b) => b.confidence - a.confidence);
  return candidates.slice(0, 5);
}

/**
 * Verifies that an observation captured at `observedSnapshot` is still safe to use on `currentSnapshot`.
 * Specifically detects:
 * 1. Manual user action since observation (`OBSERVATION_INVALIDATED_BY_USER`)
 * 2. Post-observation text substitution (`OBSERVATION_TEXT_SUBSTITUTED`) at target UTF-16 offsets,
 *    block IDs, or control labels.
 */
function verifyObservationIntegrity({
  observedSnapshot,
  currentSnapshot,
  targetSpec = {},
  userTakeoverTracker = null
} = {}) {
  if (!observedSnapshot || !currentSnapshot) {
    throw new KosworkBrowserRecoveryError(
      "MISSING_OBSERVATION_SNAPSHOT",
      "Невозможно выполнить действие без актуального наблюдения страницы."
    );
  }

  if (userTakeoverTracker) {
    userTakeoverTracker.assertObservationValid(observedSnapshot.tabId, observedSnapshot.userEpoch);
  }

  if (observedSnapshot.url !== currentSnapshot.url) {
    throw new KosworkBrowserRecoveryError(
      "TAB_URL_CHANGED",
      `URL страницы изменился после наблюдения ("${observedSnapshot.url}" -> "${currentSnapshot.url}").`,
      {
        observedUrl: observedSnapshot.url,
        currentUrl: currentSnapshot.url
      }
    );
  }

  // 1. Check UTF-16 span integrity if the target specifies `startUtf16` / `endUtf16` or `expectedQuote`
  if (
    Number.isInteger(targetSpec.startUtf16) &&
    Number.isInteger(targetSpec.endUtf16) &&
    targetSpec.endUtf16 > targetSpec.startUtf16
  ) {
    const fullCurrent = String(currentSnapshot.fullTextUtf16 || "");
    const observedSpanText = String(observedSnapshot.fullTextUtf16 || "").slice(
      targetSpec.startUtf16,
      targetSpec.endUtf16
    );
    const currentSpanText = fullCurrent.slice(
      targetSpec.startUtf16,
      targetSpec.endUtf16
    );
    const expectedQuote =
      typeof targetSpec.expectedQuote === "string" ? targetSpec.expectedQuote : observedSpanText;

    if (currentSpanText !== expectedQuote) {
      // Check if the exact quote merely shifted offsets due to a harmless header/banner insertion
      const shiftedIdx = fullCurrent.indexOf(expectedQuote);
      if (shiftedIdx === -1) {
        const containingBlock = (currentSnapshot.blocks || []).find(
          (b) => targetSpec.startUtf16 >= b.startUtf16 && targetSpec.startUtf16 < b.endUtf16
        );
        const nextNewlineIdx = fullCurrent.indexOf("\n", targetSpec.startUtf16);
        const expandedEnd =
          containingBlock
            ? containingBlock.endUtf16
            : nextNewlineIdx !== -1
              ? Math.max(targetSpec.endUtf16, nextNewlineIdx)
              : Math.min(fullCurrent.length, targetSpec.endUtf16 + 120);
        const actualExpandedText = fullCurrent.slice(targetSpec.startUtf16, expandedEnd);

        const recoveryCandidates = findRecoveryCandidates(
          {
            kind: "block",
            id: targetSpec.blockId,
            expectedText: expectedQuote
          },
          currentSnapshot
        );
        throw new KosworkBrowserRecoveryError(
          "OBSERVATION_TEXT_SUBSTITUTED",
          `Обнаружена подмена текста после наблюдения на вкладке "${currentSnapshot.tabId}" (v${observedSnapshot.pageVersion} -> v${currentSnapshot.pageVersion}).`,
          {
            tabId: currentSnapshot.tabId,
            observedPageVersion: observedSnapshot.pageVersion,
            currentPageVersion: currentSnapshot.pageVersion,
            startUtf16: targetSpec.startUtf16,
            endUtf16: targetSpec.endUtf16,
            expectedText: expectedQuote,
            actualTextAtOffsets: actualExpandedText,
            recoveryCandidates
          }
        );
      }

      return {
        valid: true,
        recoveredShift: true,
        newStartUtf16: shiftedIdx,
        newEndUtf16: shiftedIdx + expectedQuote.length,
        pageVersion: currentSnapshot.pageVersion
      };
    }
  }

  // 2. Check interactive control label/text substitution if targeting a control
  if (targetSpec.controlId || targetSpec.deepSelector) {
    const obsCtrl = (observedSnapshot.controls || []).find(
      (c) =>
        (targetSpec.controlId && c.id === targetSpec.controlId) ||
        (targetSpec.deepSelector && c.deepSelector === targetSpec.deepSelector)
    );
    const curCtrl = (currentSnapshot.controls || []).find(
      (c) =>
        (targetSpec.controlId && c.id === targetSpec.controlId) ||
        (targetSpec.deepSelector && c.deepSelector === targetSpec.deepSelector)
    );

    if (obsCtrl && !curCtrl) {
      const recoveryCandidates = findRecoveryCandidates(
        {
          kind: "control",
          id: obsCtrl.id,
          name: obsCtrl.name,
          role: obsCtrl.role,
          label: obsCtrl.label,
          deepSelector: obsCtrl.deepSelector
        },
        currentSnapshot
      );
      throw new KosworkBrowserRecoveryError(
        "TARGET_CONTROL_MISSING_AFTER_MUTATION",
        `Целевой элемент "${obsCtrl.id}" исчез после динамического обновления страницы.`,
        {
          controlId: obsCtrl.id,
          observedPageVersion: observedSnapshot.pageVersion,
          currentPageVersion: currentSnapshot.pageVersion,
          recoveryCandidates
        }
      );
    }

    if (obsCtrl && curCtrl) {
      const expectedLabel = String(targetSpec.expectedLabel || obsCtrl.label || "").trim();
      const currentLabel = String(curCtrl.label || "").trim();
      if (expectedLabel && currentLabel && expectedLabel !== currentLabel) {
        const similarity = computeJaccardTokenSimilarity(expectedLabel, currentLabel);
        if (similarity < 0.65) {
          throw new KosworkBrowserRecoveryError(
            "OBSERVATION_TEXT_SUBSTITUTED",
            `Текст интерактивного элемента "${curCtrl.id}" был подменён после наблюдения ("${expectedLabel}" -> "${currentLabel}"). Ввод/нажатие заблокировано.`,
            {
              controlId: curCtrl.id,
              observedLabel: expectedLabel,
              currentLabel,
              similarity: Number(similarity.toFixed(3)),
              observedPageVersion: observedSnapshot.pageVersion,
              currentPageVersion: currentSnapshot.pageVersion
            }
          );
        }
      }
    }
  }

  return {
    valid: true,
    recoveredShift: false,
    pageVersion: currentSnapshot.pageVersion
  };
}

/**
 * Tracks manual user interactions and takeover state per tab.
 * Any manual action by the user invalidates observations taken prior to that action.
 */
class UserTakeoverTracker {
  constructor() {
    this.tabStates = new Map();
  }

  ensureTab(tabId) {
    const key = String(tabId || "tab-1");
    if (!this.tabStates.has(key)) {
      this.tabStates.set(key, {
        tabId: key,
        userEpoch: 0,
        manualTakeoverActive: false,
        lastUserAction: null,
        lastUserActionAt: null,
        history: []
      });
    }
    return this.tabStates.get(key);
  }

  getCurrentEpoch(tabId) {
    return this.ensureTab(tabId).userEpoch;
  }

  recordUserAction(tabId, action = {}) {
    const state = this.ensureTab(tabId);
    state.userEpoch += 1;
    if (action.takeover !== undefined) {
      state.manualTakeoverActive = Boolean(action.takeover);
    }
    const entry = {
      epoch: state.userEpoch,
      type: String(action.type || "user_manual_action"),
      detail: action.detail || null,
      recordedAt: action.recordedAt || new Date().toISOString()
    };
    state.lastUserAction = entry.type;
    state.lastUserActionAt = entry.recordedAt;
    state.history.push(entry);
    return {
      tabId: state.tabId,
      userEpoch: state.userEpoch,
      manualTakeoverActive: state.manualTakeoverActive,
      previousObservationsInvalidated: true,
      lastUserAction: entry
    };
  }

  releaseTakeover(tabId) {
    const state = this.ensureTab(tabId);
    state.manualTakeoverActive = false;
    return {
      tabId: state.tabId,
      userEpoch: state.userEpoch,
      manualTakeoverActive: false
    };
  }

  assertObservationValid(tabId, observedUserEpoch) {
    const state = this.ensureTab(tabId);
    if (state.manualTakeoverActive) {
      throw new KosworkBrowserRecoveryError(
        "USER_TAKEOVER_ACTIVE",
        `Пользователь перехватил управление вкладкой "${state.tabId}". Автоматические действия приостановлены до возврата управления.`,
        {
          tabId: state.tabId,
          userEpoch: state.userEpoch,
          lastUserAction: state.lastUserAction
        }
      );
    }

    if (
      observedUserEpoch !== undefined &&
      observedUserEpoch !== null &&
      Number(observedUserEpoch) !== state.userEpoch
    ) {
      throw new KosworkBrowserRecoveryError(
        "OBSERVATION_INVALIDATED_BY_USER",
        `Ручное действие пользователя (${state.lastUserAction || "user_input"}) на вкладке "${state.tabId}" сделало старое наблюдение (epoch ${observedUserEpoch}) непригодным для дальнейшего ввода (текущий epoch ${state.userEpoch}). Требуется повторное наблюдение страницы.`,
        {
          tabId: state.tabId,
          observedUserEpoch: Number(observedUserEpoch),
          currentUserEpoch: state.userEpoch,
          lastUserAction: state.lastUserAction,
          lastUserActionAt: state.lastUserActionAt
        }
      );
    }

    return true;
  }
}

module.exports = {
  KosworkBrowserRecoveryError,
  UserTakeoverTracker,
  computeJaccardTokenSimilarity,
  findRecoveryCandidates,
  verifyObservationIntegrity,
  verifyTabReceipt
};
