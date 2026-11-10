"use strict";
/**
 * Kosmora / Koswork Visual DOM Mutation & Action Verification Engine (Wave 18)
 *
 * Captures pre-action and post-action interactive accessibility / DOM snapshots
 * in Electron WebContentsView and verifies whether a browser action (click, type,
 * submit, select) produced a concrete state transition:
 * - Detects newly revealed modal dialogs, dropdown menus, toast notifications, or validation alerts
 * - Detects URL navigation or input value changes
 * - Identifies "no-op / dead clicks" (zero DOM mutation and zero focus/value delta) and generates
 *   deterministic self-healing fallback coordinates or keyboard actions
 */

const crypto = require("node:crypto");

/**
 * Normalizes a DOM / accessibility tree snapshot into a canonical map of interactive nodes.
 * @param {object} rawSnapshot
 */
function normalizeDomSnapshot(rawSnapshot) {
  const url = String(rawSnapshot?.url || "about:blank");
  const title = String(rawSnapshot?.title || "");
  const activeElementId = String(rawSnapshot?.activeElementId || "");
  const nodes = Array.isArray(rawSnapshot?.nodes) ? rawSnapshot.nodes : [];

  const nodeMap = new Map();
  for (const n of nodes) {
    if (!n || !n.id) continue;
    const norm = {
      id: String(n.id),
      tag: String(n.tag || "div").toLowerCase(),
      role: String(n.role || "").toLowerCase(),
      text: String(n.text || "").trim(),
      value: String(n.value ?? ""),
      visible: Boolean(n.visible !== false),
      disabled: Boolean(n.disabled === true),
      ariaExpanded: n.ariaExpanded !== undefined ? Boolean(n.ariaExpanded) : undefined,
      checked: n.checked !== undefined ? Boolean(n.checked) : undefined,
      bbox: n.bbox || { x: 0, y: 0, width: 0, height: 0 }
    };
    nodeMap.set(norm.id, norm);
  }

  const canonicalJson = JSON.stringify({
    url,
    title,
    activeElementId,
    nodes: Array.from(nodeMap.values())
  });
  const snapshotHash = crypto.createHash("sha256").update(canonicalJson, "utf8").digest("hex");

  return {
    url,
    title,
    activeElementId,
    nodeMap,
    snapshotHash
  };
}

/**
 * Computes structural and state mutations between pre-action and post-action DOM snapshots.
 */
function verifyBrowserActionMutation(preRaw, postRaw, intendedAction = {}) {
  const pre = normalizeDomSnapshot(preRaw);
  const post = normalizeDomSnapshot(postRaw);

  const addedNodes = [];
  const removedNodes = [];
  const mutatedNodes = [];
  const modalOrAlertNodes = [];

  for (const [id, postNode] of post.nodeMap.entries()) {
    const preNode = pre.nodeMap.get(id);
    if (!preNode) {
      if (postNode.visible) {
        addedNodes.push(postNode);
        if (
          postNode.role === "dialog" ||
          postNode.role === "alert" ||
          postNode.role === "menu" ||
          postNode.tag === "dialog"
        ) {
          modalOrAlertNodes.push(postNode);
        }
      }
      continue;
    }

    const changes = [];
    if (preNode.visible !== postNode.visible) {
      changes.push(`visibility:${preNode.visible}->${postNode.visible}`);
      if (
        postNode.visible &&
        (postNode.role === "dialog" || postNode.role === "alert" || postNode.role === "menu")
      ) {
        modalOrAlertNodes.push(postNode);
      }
    }
    if (preNode.value !== postNode.value) {
      changes.push(`value:'${preNode.value}'->'${postNode.value}'`);
    }
    if (preNode.text !== postNode.text) {
      changes.push(`text:'${preNode.text}'->'${postNode.text}'`);
    }
    if (preNode.ariaExpanded !== postNode.ariaExpanded) {
      changes.push(`ariaExpanded:${preNode.ariaExpanded}->${postNode.ariaExpanded}`);
    }
    if (preNode.checked !== postNode.checked) {
      changes.push(`checked:${preNode.checked}->${postNode.checked}`);
    }
    if (preNode.disabled !== postNode.disabled) {
      changes.push(`disabled:${preNode.disabled}->${postNode.disabled}`);
    }

    if (changes.length > 0) {
      mutatedNodes.push({
        id,
        tag: postNode.tag,
        role: postNode.role,
        changes
      });
    }
  }

  for (const [id, preNode] of pre.nodeMap.entries()) {
    if (!post.nodeMap.has(id) && preNode.visible) {
      removedNodes.push(preNode);
    }
  }

  const urlChanged = pre.url !== post.url;
  const focusChanged = pre.activeElementId !== post.activeElementId;
  const totalDomDeltas =
    addedNodes.length +
    removedNodes.length +
    mutatedNodes.length +
    (urlChanged ? 1 : 0) +
    (focusChanged ? 1 : 0);

  const isDeadAction = totalDomDeltas === 0;

  let remedialSuggestion = null;
  if (isDeadAction) {
    const targetId = intendedAction.targetId || "unknown";
    const targetNode = post.nodeMap.get(targetId);
    if (targetNode && targetNode.disabled) {
      remedialSuggestion = `Target element '${targetId}' is disabled. Wait for prerequisite form fields to validate before clicking.`;
    } else if (targetNode && targetNode.bbox && targetNode.bbox.width > 0) {
      const centerX = Math.round(targetNode.bbox.x + targetNode.bbox.width / 2);
      const centerY = Math.round(targetNode.bbox.y + targetNode.bbox.height / 2);
      remedialSuggestion = `Dead action detected on '${targetId}'. Scroll element into view, focus explicitly, and dispatch synthetic click at center (${centerX}, ${centerY}) or trigger keyboard Enter.`;
    } else {
      remedialSuggestion = `No DOM mutation observed after ${intendedAction.type || "action"} on '${targetId}'. Re-query Shadow DOM / iframe tree and retry via keyboard navigation.`;
    }
  }

  return {
    actionVerified: !isDeadAction,
    isDeadAction,
    urlChanged,
    focusChanged,
    preSnapshotHash: pre.snapshotHash,
    postSnapshotHash: post.snapshotHash,
    totalDomDeltas,
    addedCount: addedNodes.length,
    removedCount: removedNodes.length,
    mutatedCount: mutatedNodes.length,
    addedNodes,
    removedNodes,
    mutatedNodes,
    modalOrAlertNodes,
    remedialSuggestion
  };
}

module.exports = {
  normalizeDomSnapshot,
  verifyBrowserActionMutation
};
