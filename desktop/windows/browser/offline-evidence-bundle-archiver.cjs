"use strict";

const { createKosworkWorkspaceService } = require("../workspace/workspace-service.cjs");

/**
 * Koswork RFC 2557 MHTML & Offline Self-Contained Evidence Bundle Archiver
 * (`desktop/windows/browser/offline-evidence-bundle-archiver.cjs`).
 *
 * Deepens Requirement #1, #3 & #5:
 * - Packages all visited versioned snapshots (`url`, `title`, `pageVersion`, `snapshotId`,
 *   `contentSha256`, `pageDate`, `eventDate`, `fetchedAt`, `fullTextUtf16`, `tabReceipt`)
 *   and verified excerpts into:
 *   1. An RFC 2557 Multipart MHTML web archive (`reports/<slug>-evidence.mhtml`) that
 *      can be inspected offline even if external web pages later change or go offline.
 *   2. A deterministic JSON Evidence Bundle (`reports/<slug>-evidence-bundle.json`) that
 *      can be reloaded offline via `restoreSnapshotsFromEvidenceBundle`.
 */

function buildMultipartMhtmlArchive({
  title = "Koswork Browser Research Evidence Archive",
  generatedAt = new Date().toISOString(),
  snapshots = []
} = {}) {
  const boundary = "----=_NextPart_Koswork_Browser_Research_MHTML";
  const rootUrl = snapshots[0]?.url || "https://koswork.local/research-archive";

  const lines = [
    `From: <Saved by Koswork Browser Research Engine>`,
    `Subject: ${title}`,
    `Date: ${new Date(generatedAt).toUTCString()}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/related; type="text/html"; boundary="${boundary}"`,
    ``,
    `This is a multi-part message in MIME format (RFC 2557 MHTML Evidence Archive).`,
    ``
  ];

  for (const snap of snapshots) {
    if (!snap || !snap.url) continue;
    const escapedText = String(snap.fullTextUtf16 || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    lines.push(
      `--${boundary}`,
      `Content-Type: text/html; charset="utf-8"`,
      `Content-Transfer-Encoding: 8bit`,
      `Content-Location: ${snap.url}`,
      `X-Koswork-Snapshot-Id: ${snap.snapshotId || ""}`,
      `X-Koswork-Page-Version: ${snap.pageVersion ?? 1}`,
      `X-Koswork-Content-Sha256: ${snap.contentSha256 || ""}`,
      `X-Koswork-Page-Date: ${snap.pageDate || ""}`,
      `X-Koswork-Event-Date: ${snap.eventDate || ""}`,
      `X-Koswork-Fetched-At: ${snap.fetchedAt || generatedAt}`,
      ``,
      `<!doctype html>`,
      `<html lang="ru">`,
      `<head><meta charset="utf-8" /><title>${snap.title || snap.url}</title></head>`,
      `<body><pre data-utf16-length="${(snap.fullTextUtf16 || "").length}">${escapedText}</pre></body>`,
      `</html>`,
      ``
    );
  }

  lines.push(`--${boundary}--`, ``);
  return {
    rootUrl,
    partCount: snapshots.length,
    mhtmlText: lines.join("\r\n")
  };
}

async function saveOfflineEvidenceBundleToWorkspace({
  workspaceRoot,
  bundleSlug = "research-evidence",
  question = "",
  snapshots = [],
  confirmedClaims = [],
  signal = null
} = {}) {
  if (!workspaceRoot) {
    throw new Error("OFFLINE_BUNDLE_REQUIRES_WORKSPACE_ROOT");
  }

  const generatedAt = new Date().toISOString();
  const mhtml = buildMultipartMhtmlArchive({
    title: `Koswork Evidence Archive: ${question || bundleSlug}`,
    generatedAt,
    snapshots
  });

  const bundleJsonObj = {
    schemaVersion: "koswork.browser-research.offline-bundle.v1",
    question,
    generatedAt,
    snapshots: snapshots.map((s) => ({
      tabId: s.tabId,
      url: s.url,
      canonicalUrl: s.canonicalUrl || s.url,
      title: s.title,
      httpStatus: s.httpStatus ?? 200,
      pageVersion: s.pageVersion ?? 1,
      snapshotId: s.snapshotId,
      contentSha256: s.contentSha256,
      pageDate: s.pageDate || null,
      eventDate: s.eventDate || null,
      fetchedAt: s.fetchedAt || generatedAt,
      totalLengthUtf16: (s.fullTextUtf16 || "").length,
      fullTextUtf16: s.fullTextUtf16 || "",
      tabReceipt: s.tabReceipt || null
    })),
    confirmedClaims
  };

  const svc = createKosworkWorkspaceService();
  await svc.connectFolder({ folderPath: workspaceRoot, signal });

  const mhtmlFile = await svc.createFile({
    relativePath: `reports/${bundleSlug}-evidence.mhtml`,
    content: mhtml.mhtmlText,
    createParents: true,
    signal
  });

  const jsonFile = await svc.createFile({
    relativePath: `reports/${bundleSlug}-evidence-bundle.json`,
    content: JSON.stringify(bundleJsonObj, null, 2) + "\n",
    createParents: true,
    signal
  });

  return {
    partCount: mhtml.partCount,
    mhtmlFile,
    jsonFile,
    bundle: bundleJsonObj
  };
}

function restoreSnapshotsFromEvidenceBundle(bundleObj = {}) {
  const snapshotsByUrl = {};
  for (const s of bundleObj.snapshots || []) {
    if (!s || !s.url) continue;
    snapshotsByUrl[s.url] = { ...s };
  }
  return snapshotsByUrl;
}

module.exports = {
  buildMultipartMhtmlArchive,
  saveOfflineEvidenceBundleToWorkspace,
  restoreSnapshotsFromEvidenceBundle
};
