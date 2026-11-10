"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function escapeXml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const KIND_PALETTE = {
  agent: { fill: "#dbeafe", stroke: "#1d4ed8", text: "#1e3a8a" },
  service: { fill: "#e0f2fe", stroke: "#0369a1", text: "#0c4a6e" },
  database: { fill: "#dcfce7", stroke: "#15803d", text: "#14532d" },
  security: { fill: "#fef3c7", stroke: "#b45309", text: "#78350f" }
};

/**
 * Compiles a layered architecture graph into:
 * 1. Standalone Hierarchical Vector SVG (`svg`)
 * 2. Mermaid Flowchart (`mermaid`)
 * 3. Graphviz DOT (`dot`)
 */
function buildArchitectureDiagramBundle(spec = {}) {
  const title = spec.title || "Kosmora Architecture Topology";
  const nodes = Array.isArray(spec.nodes) ? spec.nodes : [];
  const edges = Array.isArray(spec.edges) ? spec.edges : [];

  // Group nodes by layer (0, 1, 2, ...)
  const byLayer = new Map();
  let maxLayer = 0;
  for (const n of nodes) {
    const layer = Math.max(0, Number(n.layer) || 0);
    if (layer > maxLayer) maxLayer = layer;
    const list = byLayer.get(layer) || [];
    list.push(n);
    byLayer.set(layer, list);
  }

  const nodeWidth = 170;
  const nodeHeight = 46;
  const hGap = 44;
  const vGap = 74;
  const topOffset = 58;

  let maxRowNodes = 1;
  for (const list of byLayer.values()) {
    if (list.length > maxRowNodes) maxRowNodes = list.length;
  }

  const canvasWidth = Math.max(640, maxRowNodes * (nodeWidth + hGap) + 80);
  const canvasHeight = topOffset + (maxLayer + 1) * (nodeHeight + vGap) + 30;

  const coords = new Map();
  for (let l = 0; l <= maxLayer; l++) {
    const row = byLayer.get(l) || [];
    const rowTotalWidth = row.length * nodeWidth + Math.max(0, row.length - 1) * hGap;
    const startX = Math.round((canvasWidth - rowTotalWidth) / 2);
    const y = topOffset + l * (nodeHeight + vGap);

    row.forEach((n, idx) => {
      const x = startX + idx * (nodeWidth + hGap);
      coords.set(n.id, {
        x,
        y,
        cx: x + Math.round(nodeWidth / 2),
        cy: y + Math.round(nodeHeight / 2),
        bottomY: y + nodeHeight,
        topY: y
      });
    });
  }

  const edgesSvg = edges
    .map((e) => {
      const src = coords.get(e.from);
      const dst = coords.get(e.to);
      if (!src || !dst) return "";
      const x1 = src.cx;
      const y1 = src.bottomY;
      const x2 = dst.cx;
      const y2 = dst.topY - 6;
      const midX = Math.round((x1 + x2) / 2);
      const midY = Math.round((y1 + y2) / 2);
      const labelSvg = e.label
        ? `<text x="${midX + 6}" y="${midY}" font-family="Segoe UI, system-ui, sans-serif" font-size="11" fill="#475569">${escapeXml(e.label)}</text>`
        : "";
      return `<g class="edge">
        <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#64748b" stroke-width="1.8" marker-end="url(#arrow)" />
        ${labelSvg}
      </g>`;
    })
    .join("\n");

  const nodesSvg = nodes
    .map((n) => {
      const pos = coords.get(n.id);
      if (!pos) return "";
      const palette = KIND_PALETTE[n.kind] || KIND_PALETTE.service;
      return `<g class="node" id="node-${escapeXml(n.id)}" transform="translate(${pos.x}, ${pos.y})">
        <rect width="${nodeWidth}" height="${nodeHeight}" rx="8" fill="${palette.fill}" stroke="${palette.stroke}" stroke-width="1.8" />
        <text x="${Math.round(nodeWidth / 2)}" y="28" text-anchor="middle" font-family="Segoe UI, system-ui, sans-serif" font-size="12.5" font-weight="600" fill="${palette.text}">${escapeXml(n.label || n.id)}</text>
      </g>`;
    })
    .join("\n");

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvasWidth} ${canvasHeight}" width="${canvasWidth}" height="${canvasHeight}" role="img" aria-label="${escapeXml(title)}">
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 1 L 10 5 L 0 9 z" fill="#64748b" />
    </marker>
  </defs>
  <rect width="100%" height="100%" fill="#ffffff" />
  <text x="${Math.round(canvasWidth / 2)}" y="32" text-anchor="middle" font-family="Segoe UI, system-ui, sans-serif" font-size="16" font-weight="700" fill="#0f172a">${escapeXml(title)}</text>
  ${edgesSvg}
  ${nodesSvg}
</svg>`;

  const mermaidLines = [
    "flowchart TD",
    ...nodes.map((n) => `  ${n.id}["${String(n.label || n.id).replace(/"/g, "'")}"]`),
    ...edges.map((e) =>
      e.label ? `  ${e.from} -->|${String(e.label).replace(/\|/g, "/")}| ${e.to}` : `  ${e.from} --> ${e.to}`
    )
  ];

  const dotLines = [
    "digraph KosmoraArchitecture {",
    "  rankdir=TB;",
    '  node [shape=box, style="rounded,filled", fontname="Segoe UI"];',
    ...nodes.map((n) => `  "${n.id}" [label="${String(n.label || n.id).replace(/"/g, '\\"')}"];`),
    ...edges.map((e) =>
      e.label
        ? `  "${e.from}" -> "${e.to}" [label="${String(e.label).replace(/"/g, '\\"')}"];`
        : `  "${e.from}" -> "${e.to}";`
    ),
    "}"
  ];

  return {
    svg,
    mermaid: mermaidLines.join("\n"),
    dot: dotLines.join("\n")
  };
}

function saveDiagramBundleToWorkspace(workspaceDir, baseName, spec) {
  if (!workspaceDir || typeof workspaceDir !== "string") {
    throw new Error("WORKSPACE_REQUIRED");
  }
  const cleanBase = path
    .basename(baseName || "architecture")
    .replace(/\.(svg|mmd|dot)$/i, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_");
  const resolvedWorkspace = path.resolve(workspaceDir);
  const svgPath = path.resolve(resolvedWorkspace, `${cleanBase}.svg`);
  const mmdPath = path.resolve(resolvedWorkspace, `${cleanBase}.mmd`);
  const dotPath = path.resolve(resolvedWorkspace, `${cleanBase}.dot`);

  if (!svgPath.startsWith(resolvedWorkspace + path.sep)) {
    throw new Error("PATH_TRAVERSAL_BLOCKED");
  }

  fs.mkdirSync(resolvedWorkspace, { recursive: true });
  const bundle = buildArchitectureDiagramBundle(spec);
  fs.writeFileSync(svgPath, bundle.svg, "utf8");
  fs.writeFileSync(mmdPath, bundle.mermaid, "utf8");
  fs.writeFileSync(dotPath, bundle.dot, "utf8");

  return {
    svgPath,
    mmdPath,
    dotPath,
    svgBytes: Buffer.byteLength(bundle.svg, "utf8"),
    sha256: crypto.createHash("sha256").update(bundle.svg, "utf8").digest("hex")
  };
}

module.exports = {
  buildArchitectureDiagramBundle,
  saveDiagramBundleToWorkspace
};
