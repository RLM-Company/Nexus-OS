"use strict";
/**
 * Kosmora / Koswork Multi-Monitor DPI-Aware Coordinate Calibrator & Set-of-Mark (SoM) Mapper (Wave 22)
 *
 * Solves Windows multi-monitor Per-Monitor V2 DPI scaling discrepancies (100%, 125%, 150%, 175%, 200%)
 * and negative secondary monitor origins during autonomous desktop/browser actuation:
 * 1. Translates normalized `[0..1000, 0..1000]` LLM vision coordinates into exact physical Win32
 *    screen pixels (`physicalX`, `physicalY`) and logical DIP coordinates (`dipX`, `dipY`).
 * 2. Builds Set-of-Mark (SoM) numeric bounding-box registries (`#1`, `#2`, ...) with hit-target
 *    clamping so clicks never land on window borders or outside the active monitor viewport.
 */

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

/**
 * Normalizes a Windows display descriptor.
 * @param {object} display
 */
function normalizeDisplayDescriptor(display) {
  const scaleFactor = Number(display?.scaleFactor) > 0 ? Number(display.scaleFactor) : 1.0;
  const dipBounds = display?.dipBounds || { x: 0, y: 0, width: 1920, height: 1080 };
  const physicalBounds = display?.physicalBounds || {
    x: Math.round(dipBounds.x * scaleFactor),
    y: Math.round(dipBounds.y * scaleFactor),
    width: Math.round(dipBounds.width * scaleFactor),
    height: Math.round(dipBounds.height * scaleFactor)
  };

  return {
    id: String(display?.id || "display-primary"),
    scaleFactor,
    dipBounds,
    physicalBounds
  };
}

/**
 * Translates normalized `[0..1000]` vision model coordinates into exact logical DIP
 * and physical screen pixel coordinates on the target monitor.
 */
function mapNormalizedVisionToScreen(normX, normY, displayRaw) {
  const display = normalizeDisplayDescriptor(displayRaw);
  const clampedNormX = clamp(Number(normX) || 0, 0, 1000);
  const clampedNormY = clamp(Number(normY) || 0, 0, 1000);

  const ratioX = clampedNormX / 1000;
  const ratioY = clampedNormY / 1000;

  // Compute safe interior coordinates (inset by 2px from monitor edges)
  const dipX = Math.round(
    display.dipBounds.x + clamp(ratioX * display.dipBounds.width, 2, display.dipBounds.width - 2)
  );
  const dipY = Math.round(
    display.dipBounds.y + clamp(ratioY * display.dipBounds.height, 2, display.dipBounds.height - 2)
  );

  const physicalX = Math.round(
    display.physicalBounds.x +
      clamp(ratioX * display.physicalBounds.width, 2, display.physicalBounds.width - 2)
  );
  const physicalY = Math.round(
    display.physicalBounds.y +
      clamp(ratioY * display.physicalBounds.height, 2, display.physicalBounds.height - 2)
  );

  return {
    displayId: display.id,
    scaleFactor: display.scaleFactor,
    normalized: { x: clampedNormX, y: clampedNormY },
    dip: { x: dipX, y: dipY },
    physical: { x: physicalX, y: physicalY }
  };
}

/**
 * Builds a Set-of-Mark (SoM) visual grounding catalog from interactive UI elements
 * and resolves safe click coordinates for any mark ID (`#1`, `#2`, ...).
 */
class SetOfMarkCoordinateCatalog {
  constructor(displayRaw) {
    this.display = normalizeDisplayDescriptor(displayRaw);
    this.marks = new Map();
  }

  /**
   * Registers interactive elements and assigns sequential `[#1..#N]` Set-of-Mark tags.
   * @param {Array<{ id: string, label?: string, role?: string, dipBbox: { x: number, y: number, width: number, height: number } }>} elements
   */
  buildCatalog(elements) {
    this.marks.clear();
    const list = Array.isArray(elements) ? elements : [];
    const catalog = [];

    for (let i = 0; i < list.length; i++) {
      const el = list[i];
      if (!el || !el.dipBbox) continue;
      const markId = i + 1;
      const b = el.dipBbox;

      const centerDipX = Math.round(b.x + b.width / 2);
      const centerDipY = Math.round(b.y + b.height / 2);

      // Clamp to display DIP bounds
      const safeDipX = clamp(
        centerDipX,
        this.display.dipBounds.x + 2,
        this.display.dipBounds.x + this.display.dipBounds.width - 2
      );
      const safeDipY = clamp(
        centerDipY,
        this.display.dipBounds.y + 2,
        this.display.dipBounds.y + this.display.dipBounds.height - 2
      );

      // Convert relative offset from display DIP origin into physical pixels
      const relDipX = safeDipX - this.display.dipBounds.x;
      const relDipY = safeDipY - this.display.dipBounds.y;

      const physicalX = Math.round(
        this.display.physicalBounds.x + relDipX * this.display.scaleFactor
      );
      const physicalY = Math.round(
        this.display.physicalBounds.y + relDipY * this.display.scaleFactor
      );

      const entry = {
        markId,
        tag: `#${markId}`,
        elementId: String(el.id || `el-${markId}`),
        label: String(el.label || ""),
        role: String(el.role || "button"),
        dipBbox: b,
        safeClickDip: { x: safeDipX, y: safeDipY },
        safeClickPhysical: { x: physicalX, y: physicalY }
      };

      this.marks.set(markId, entry);
      catalog.push(entry);
    }

    return catalog;
  }

  resolveMarkTarget(markIdOrTag) {
    const num =
      typeof markIdOrTag === "number"
        ? markIdOrTag
        : Number.parseInt(String(markIdOrTag).replace(/^#/, ""), 10);

    return this.marks.get(num) || null;
  }
}

module.exports = {
  normalizeDisplayDescriptor,
  mapNormalizedVisionToScreen,
  SetOfMarkCoordinateCatalog
};
