import { verifyF033Module } from "./f033-dual-pane-kosmora-canvas.ts";
import { verifyF034Module } from "./f034-versioned-canvas-reports.ts";
import { verifyF035Module } from "./f035-file-analysis-report-binding.ts";
import { verifyF036Module } from "./f036-visual-artifact-version-diff.ts";
import { verifyF037Module } from "./f037-interactive-presentation-editor.ts";
import { verifyF038Module } from "./f038-xlsx-formula-table-generator.ts";
import { verifyF039Module } from "./f039-desktop-archive-batch-download.ts";
import { verifyF040Module } from "./f040-refined-canvas-controls.ts";
import { verifyF041Module } from "./f041-inplace-selection-regeneration.ts";
import { verifyF042Module } from "./f042-architectural-diagram-renderer.ts";
import { verifyF043Module } from "./f043-ui-component-preview-sandbox.ts";
import { verifyF044Module } from "./f044-interactive-chart-widgets.ts";
import { verifyF045Module } from "./f045-multitab-canvas-manager.ts";
import { verifyF046Module } from "./f046-canvas-split-view.ts";
import { verifyF047Module } from "./f047-inline-review-threads.ts";
import { verifyF048Module } from "./f048-artifact-verification-badge.ts";
import { verifyF049Module } from "./f049-provenance-inspector-ui.ts";
import { verifyF050Module } from "./f050-two-way-manual-edit-sync.ts";
import { verifyF051Module } from "./f051-corporate-pdf-report-exporter.ts";
import { verifyF052Module } from "./f052-markdown-notion-synchronizer.ts";
import { verifyF053Module } from "./f053-floating-toc-navigator.ts";
import { verifyF054Module } from "./f054-section-overwrite-locking.ts";
import { verifyF055Module } from "./f055-cross-document-dynamic-variables.ts";
import { verifyF056Module } from "./f056-artifact-templates-library.ts";
import { verifyF057Module } from "./f057-dark-high-contrast-slide-themes.ts";
import { verifyF058Module } from "./f058-broken-link-citation-validator.ts";
import { verifyF059Module } from "./f059-fullscreen-present-mode.ts";
import { verifyF060Module } from "./f060-oneclick-table-to-slides.ts";
import { verifyF061Module } from "./f061-report-tts-audio-summary.ts";
import { verifyF062Module } from "./f062-canvas-change-audit-log.ts";
import { verifyF063Module } from "./f063-canvas-trash-bin-restore.ts";
import { verifyF064Module } from "./f064-master-document-stitcher.ts";

// Stage Barrel Export for packages/core/src/stage2-canvas (32 feature modules)
export * from "./f033-dual-pane-kosmora-canvas.ts";
export * from "./f034-versioned-canvas-reports.ts";
export * from "./f035-file-analysis-report-binding.ts";
export * from "./f036-visual-artifact-version-diff.ts";
export * from "./f037-interactive-presentation-editor.ts";
export * from "./f038-xlsx-formula-table-generator.ts";
export * from "./f039-desktop-archive-batch-download.ts";
export * from "./f040-refined-canvas-controls.ts";
export * from "./f041-inplace-selection-regeneration.ts";
export * from "./f042-architectural-diagram-renderer.ts";
export * from "./f043-ui-component-preview-sandbox.ts";
export * from "./f044-interactive-chart-widgets.ts";
export * from "./f045-multitab-canvas-manager.ts";
export * from "./f046-canvas-split-view.ts";
export * from "./f047-inline-review-threads.ts";
export * from "./f048-artifact-verification-badge.ts";
export * from "./f049-provenance-inspector-ui.ts";
export * from "./f050-two-way-manual-edit-sync.ts";
export * from "./f051-corporate-pdf-report-exporter.ts";
export * from "./f052-markdown-notion-synchronizer.ts";
export * from "./f053-floating-toc-navigator.ts";
export * from "./f054-section-overwrite-locking.ts";
export * from "./f055-cross-document-dynamic-variables.ts";
export * from "./f056-artifact-templates-library.ts";
export * from "./f057-dark-high-contrast-slide-themes.ts";
export * from "./f058-broken-link-citation-validator.ts";
export * from "./f059-fullscreen-present-mode.ts";
export * from "./f060-oneclick-table-to-slides.ts";
export * from "./f061-report-tts-audio-summary.ts";
export * from "./f062-canvas-change-audit-log.ts";
export * from "./f063-canvas-trash-bin-restore.ts";
export * from "./f064-master-document-stitcher.ts";

export function verifyStage_stage2_canvas(): Array<{ featureId: string; passed: boolean }> {
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
    verifyF064Module(),
  ];
}
