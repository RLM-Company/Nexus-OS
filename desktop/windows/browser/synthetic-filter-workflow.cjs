"use strict";

const {
  ingestDownloadedSourceIntoResearchSnapshot
} = require("./downloaded-source-ingestor.cjs");

/**
 * Koswork Interactive Synthetic Form Filter, Post-Submit Verification & Download Ingestor Workflow
 * (`desktop/windows/browser/synthetic-filter-workflow.cjs`).
 *
 * Implements the full interactive form research procedure on synthetic/local sites:
 * 1. Navigates to the form/catalog page (`engine.navigate`).
 * 2. Pauses immediately (`status: "paused_for_user"`) if CAPTCHA or login gate is detected.
 * 3. Fills filter/form fields (`engine.fillForm`) and optionally attaches allowed workspace files (`engine.selectFiles`).
 * 4. Submits the form (`engine.submitForm`) and verifies the post-submit DOM mutation effect (`effectVerified === true`).
 * 5. Extracts UTF-16 excerpts from the post-submit DOM snapshot (`engine.extractExcerpt`).
 * 6. Optionally downloads the resulting specification file into the allowed workspace folder (`engine.downloadFromPage`)
 *    and ingests it into a versioned UTF-16 snapshot (`ingestDownloadedSourceIntoResearchSnapshot`).
 */
async function executeInteractiveFormFilterAndExtractWorkflow({
  engine,
  tabId = null,
  url,
  fields = {},
  fileAttachments = null, // { controlId, filePaths }
  submitControlId = null,
  extractTerms = [],
  downloadSpec = null, // { downloadControlId, filename, extractTerm }
  signal = null
} = {}) {
  if (!engine) {
    throw new Error("BROWSER_ENGINE_REQUIRED_FOR_FILTER_WORKFLOW");
  }

  const navResult = await engine.navigate({
    tabId,
    url,
    actor: "agent",
    signal
  });

  if (navResult.status === "paused_for_user") {
    return {
      status: "paused_for_user",
      tabId: navResult.tabId,
      url: navResult.url,
      authGate: navResult.authGate
    };
  }

  const activeTabId = navResult.tabId;

  let attachedFilesResult = null;
  if (fileAttachments && fileAttachments.controlId && Array.isArray(fileAttachments.filePaths)) {
    attachedFilesResult = engine.selectFiles({
      tabId: activeTabId,
      controlId: fileAttachments.controlId,
      filePaths: fileAttachments.filePaths
    });
  }

  const fillResult = engine.fillForm({
    tabId: activeTabId,
    fields
  });

  const submitResult = await engine.submitForm({
    tabId: activeTabId,
    submitControlId
  });

  const postSubmitExcerpts = [];
  for (const term of extractTerms) {
    const exc = engine.extractExcerpt(activeTabId, { searchTerm: term });
    if (exc) {
      postSubmitExcerpts.push(exc);
    }
  }

  let downloadedSource = null;
  if (downloadSpec) {
    const dlRecord = await engine.downloadFromPage({
      tabId: activeTabId,
      downloadControlId: downloadSpec.downloadControlId || null,
      filename: downloadSpec.filename || "filtered-export.txt"
    });
    const ingested = ingestDownloadedSourceIntoResearchSnapshot(dlRecord, {
      pageDate: submitResult.snapshot.pageDate,
      eventDate: submitResult.snapshot.eventDate
    });
    const downloadedExcerpt = downloadSpec.extractTerm
      ? ingested.extractExcerpt({ searchTerm: downloadSpec.extractTerm })
      : null;

    downloadedSource = {
      downloadRecord: dlRecord,
      snapshot: ingested.snapshot,
      excerpt: downloadedExcerpt
    };
  }

  return {
    status: submitResult.effectVerified ? "completed" : "no_effect_detected",
    tabId: activeTabId,
    url: navResult.url,
    effectVerified: submitResult.effectVerified,
    domVerification: submitResult.effectVerification,
    attachedFiles: attachedFilesResult ? attachedFilesResult.attachedFiles : [],
    fillResult,
    submitResult,
    postSubmitExcerpts,
    downloadedSource
  };
}

module.exports = {
  executeInteractiveFormFilterAndExtractWorkflow
};
