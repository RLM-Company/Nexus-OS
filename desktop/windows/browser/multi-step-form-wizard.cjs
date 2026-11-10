"use strict";

const { ingestDownloadedSourceIntoResearchSnapshot } = require("./downloaded-source-ingestor.cjs");

/**
 * Koswork Multi-Step Wizard Form & Validation-Aware Submission Runner
 * (`desktop/windows/browser/multi-step-form-wizard.cjs`).
 *
 * Deepens Requirement #4:
 * "Довести ввод в обычные формы, выбор файлов и скачивание в разрешённую папку
 *  на синтетических сайтах. После отправки сверять эффект. CAPTCHA/логины — пауза
 *  для пользователя. Не обходить ограничения доступа и не расширять file permissions."
 */

function detectFormValidationErrors(snapshot) {
  const text = String(snapshot?.fullTextUtf16 || "");
  const errorPatterns = [
    /(?:ошибка валидации|поле обязательно|некорректное значение|validation error|invalid input|required field missing)\s*[:—-]?\s*([^\n.]+)/i
  ];
  const matchedMessages = [];
  for (const pat of errorPatterns) {
    const m = text.match(pat);
    if (m) {
      matchedMessages.push(m[0].trim());
    }
  }
  return {
    hasValidationErrors: matchedMessages.length > 0,
    messages: matchedMessages
  };
}

async function executeMultiStepFormWizard({
  engine,
  tabId = "wizard-tab-1",
  url,
  steps = [],
  finalDownload = null,
  signal = null
} = {}) {
  if (!engine) {
    throw new Error("FORM_WIZARD_REQUIRES_ENGINE");
  }

  const nav = await engine.navigate({
    tabId,
    url,
    actor: "agent",
    signal
  });

  if (nav.status === "paused_for_user") {
    return {
      status: "paused_for_user",
      pausedAtStep: 0,
      tabId: nav.tabId,
      url: nav.url,
      stepResults: []
    };
  }

  const stepResults = [];
  let currentObservation = nav.snapshot;

  for (let i = 0; i < steps.length; i += 1) {
    if (signal?.aborted) {
      const err = new Error("FORM_WIZARD_CANCELLED");
      err.code = "FORM_WIZARD_CANCELLED";
      throw err;
    }

    const step = steps[i];
    const stepId = step.stepId || `step-${i + 1}`;

    if (step.fields && Object.keys(step.fields).length > 0) {
      const fillRes = engine.fillForm({
        tabId: nav.tabId,
        observedSnapshot: currentObservation,
        fields: step.fields
      });
      if (fillRes.status === "paused_for_user") {
        return {
          status: "paused_for_user",
          pausedAtStep: i + 1,
          stepId,
          reason: fillRes.reason,
          stepResults
        };
      }
      currentObservation = fillRes.snapshot;
    }

    let attachedFiles = null;
    if (step.fileAttachment && Array.isArray(step.fileAttachment.filePaths)) {
      attachedFiles = engine.selectFiles({
        tabId: nav.tabId,
        controlId: step.fileAttachment.controlId,
        filePaths: step.fileAttachment.filePaths,
        observedSnapshot: currentObservation
      });
      currentObservation = attachedFiles.snapshot;
    }

    const submitRes = await engine.submitForm({
      tabId: nav.tabId,
      submitControlId: step.submitControlId || null,
      observedSnapshot: currentObservation
    });

    if (submitRes.status === "paused_for_user") {
      return {
        status: "paused_for_user",
        pausedAtStep: i + 1,
        stepId,
        reason: submitRes.reason,
        stepResults
      };
    }

    currentObservation = submitRes.snapshot;
    const validationCheck = detectFormValidationErrors(currentObservation);

    if (validationCheck.hasValidationErrors) {
      return {
        status: "validation_failed",
        failedAtStep: i + 1,
        stepId,
        validationErrors: validationCheck.messages,
        snapshot: currentObservation,
        stepResults
      };
    }

    let stepExcerpt = null;
    if (step.expectedTextAfterSubmit) {
      stepExcerpt = engine.extractExcerpt(nav.tabId, {
        searchTerm: step.expectedTextAfterSubmit
      });
    }

    stepResults.push({
      stepIndex: i + 1,
      stepId,
      effectVerified: submitRes.effectVerified,
      pageVersion: currentObservation.pageVersion,
      attachedFilesCount: attachedFiles ? attachedFiles.attachedFiles.length : 0,
      stepExcerpt
    });
  }

  let downloadedArtifact = null;
  if (finalDownload) {
    const dl = await engine.downloadFromPage({
      tabId: nav.tabId,
      downloadControlId: finalDownload.downloadControlId || null,
      filename: finalDownload.filename || "wizard-export.txt",
      content: finalDownload.content
    });
    const ingested = ingestDownloadedSourceIntoResearchSnapshot(dl, {
      pageDate: currentObservation.pageDate,
      eventDate: currentObservation.eventDate
    });
    const excerpt = finalDownload.extractTerm
      ? ingested.extractExcerpt({ searchTerm: finalDownload.extractTerm })
      : null;

    downloadedArtifact = {
      downloadResult: dl,
      snapshot: ingested.snapshot,
      excerpt
    };
  }

  return {
    status: "completed",
    tabId: nav.tabId,
    url: nav.url,
    totalStepsCompleted: stepResults.length,
    stepResults,
    downloadedArtifact,
    finalSnapshot: currentObservation
  };
}

module.exports = {
  detectFormValidationErrors,
  executeMultiStepFormWizard
};
