import { verifyF033Module } from "./f033-dual-pane-kosmora-canvas.js";
import { verifyF034Module } from "./f034-versioned-canvas-reports.js";
import { verifyF035Module } from "./f035-file-analysis-report-binding.js";
import { verifyF036Module } from "./f036-visual-artifact-version-diff.js";
import { verifyF037Module } from "./f037-interactive-presentation-editor.js";
import { verifyF038Module } from "./f038-xlsx-formula-table-generator.js";
import { verifyF039Module } from "./f039-desktop-archive-batch-download.js";
import { verifyF040Module } from "./f040-refined-canvas-controls.js";
import { verifyF041Module } from "./f041-inplace-selection-regeneration.js";
import { verifyF042Module } from "./f042-architectural-diagram-renderer.js";
import { verifyF043Module } from "./f043-ui-component-preview-sandbox.js";
import { verifyF044Module } from "./f044-interactive-chart-widgets.js";
import { verifyF045Module } from "./f045-multitab-canvas-manager.js";
import { verifyF046Module } from "./f046-canvas-split-view.js";
import { verifyF047Module } from "./f047-inline-review-threads.js";
import { verifyF048Module } from "./f048-artifact-verification-badge.js";
import { verifyF049Module } from "./f049-provenance-inspector-ui.js";
import { verifyF050Module } from "./f050-two-way-manual-edit-sync.js";
import { verifyF051Module } from "./f051-corporate-pdf-report-exporter.js";
import { verifyF052Module } from "./f052-markdown-notion-synchronizer.js";
import { verifyF053Module } from "./f053-floating-toc-navigator.js";
import { verifyF054Module } from "./f054-section-overwrite-locking.js";
import { verifyF055Module } from "./f055-cross-document-dynamic-variables.js";
import { verifyF056Module } from "./f056-artifact-templates-library.js";
import { verifyF057Module } from "./f057-dark-high-contrast-slide-themes.js";
import { verifyF058Module } from "./f058-broken-link-citation-validator.js";
import { verifyF059Module } from "./f059-fullscreen-present-mode.js";
import { verifyF060Module } from "./f060-oneclick-table-to-slides.js";
import { verifyF061Module } from "./f061-report-tts-audio-summary.js";
import { verifyF062Module } from "./f062-canvas-change-audit-log.js";
import { verifyF063Module } from "./f063-canvas-trash-bin-restore.js";
import { verifyF064Module } from "./f064-master-document-stitcher.js";

// Stage Barrel Export for packages/core/src/stage2-canvas (32 feature modules)
export { Stage2CanvasKernel } from "./stage-kernel.js";
export * from "./f033-dual-pane-kosmora-canvas.js";
export * from "./f034-versioned-canvas-reports.js";
export * from "./f035-file-analysis-report-binding.js";
export * from "./f036-visual-artifact-version-diff.js";
export * from "./f037-interactive-presentation-editor.js";
export * from "./f038-xlsx-formula-table-generator.js";
export * from "./f039-desktop-archive-batch-download.js";
export * from "./f040-refined-canvas-controls.js";
export * from "./f041-inplace-selection-regeneration.js";
export * from "./f042-architectural-diagram-renderer.js";
export * from "./f043-ui-component-preview-sandbox.js";
export * from "./f044-interactive-chart-widgets.js";
export * from "./f045-multitab-canvas-manager.js";
export * from "./f046-canvas-split-view.js";
export * from "./f047-inline-review-threads.js";
export * from "./f048-artifact-verification-badge.js";
export * from "./f049-provenance-inspector-ui.js";
export * from "./f050-two-way-manual-edit-sync.js";
export * from "./f051-corporate-pdf-report-exporter.js";
export * from "./f052-markdown-notion-synchronizer.js";
export * from "./f053-floating-toc-navigator.js";
export * from "./f054-section-overwrite-locking.js";
export * from "./f055-cross-document-dynamic-variables.js";
export * from "./f056-artifact-templates-library.js";
export * from "./f057-dark-high-contrast-slide-themes.js";
export * from "./f058-broken-link-citation-validator.js";
export * from "./f059-fullscreen-present-mode.js";
export * from "./f060-oneclick-table-to-slides.js";
export * from "./f061-report-tts-audio-summary.js";
export * from "./f062-canvas-change-audit-log.js";
export * from "./f063-canvas-trash-bin-restore.js";
export * from "./f064-master-document-stitcher.js";

export function verifyStage_stage2_canvas(): Array<{ featureId: string; passed: boolean; executionId: string; provenanceDigest: string }> {
  return [
    verifyF033Module(),
    verifyF034Module(),
    verifyF035Module(),
    verifyF036Module(),
    verifyF037Module(),
    verifyF038Module(),
    verifyF039Module(),
    verifyF040Module(),
    verifyF041Module(),
    verifyF042Module(),
    verifyF043Module(),
    verifyF044Module(),
    verifyF045Module(),
    verifyF046Module(),
    verifyF047Module(),
    verifyF048Module(),
    verifyF049Module(),
    verifyF050Module(),
    verifyF051Module(),
    verifyF052Module(),
    verifyF053Module(),
    verifyF054Module(),
    verifyF055Module(),
    verifyF056Module(),
    verifyF057Module(),
    verifyF058Module(),
    verifyF059Module(),
    verifyF060Module(),
    verifyF061Module(),
    verifyF062Module(),
    verifyF063Module(),
    verifyF064Module()
  ];
}
