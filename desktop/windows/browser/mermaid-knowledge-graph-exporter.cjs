"use strict";

const { createKosworkWorkspaceService } = require("../workspace/workspace-service.cjs");

/**
 * Koswork Research Knowledge Graph & Mermaid Visual Timeline Exporter
 * (`desktop/windows/browser/mermaid-knowledge-graph-exporter.cjs`).
 *
 * Deepens Requirements #2, #3 & #5:
 * - Synthesizes a multi-site research report into a directed Provenance Knowledge Graph
 *   (`nodes`, `edges`) and renders embedded Mermaid `flowchart LR` + chronological
 *   `timeline` diagrams (`eventDate` vs `pageDate` vs `fetchedAt`) saved via
 *   `workspace-service.cjs` (`reports/<slug>-knowledge-graph.md` and `.json`).
 */

function sanitizeMermaidLabel(str = "") {
  return String(str ?? "")
    .replace(/["[\]{}()<>|#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildResearchKnowledgeGraphAndMermaidReport(report = {}) {
  const question = report.question || "Многосайтовое исследование Koswork";
  const nodes = [];
  const edges = [];
  const timelineEvents = [];

  const qNodeId = "Q0";
  nodes.push({ id: qNodeId, kind: "question", label: question });

  let srcIndex = 1;
  let claimIndex = 1;
  const sourceNodeByUrl = new Map();

  function ensureSourceNode(url, title, pageDate, eventDate, fetchedAt, status = "200") {
    const cleanUrl = String(url || "https://corpus.local/unknown");
    if (sourceNodeByUrl.has(cleanUrl)) {
      return sourceNodeByUrl.get(cleanUrl);
    }
    const id = `S${srcIndex}`;
    srcIndex += 1;
    const node = {
      id,
      kind: "source",
      url: cleanUrl,
      title: title || cleanUrl,
      pageDate: pageDate || null,
      eventDate: eventDate || null,
      fetchedAt: fetchedAt || null,
      httpStatus: status
    };
    sourceNodeByUrl.set(cleanUrl, node);
    nodes.push(node);
    edges.push({ from: qNodeId, to: id, relation: "opened_source" });

    if (eventDate || pageDate) {
      timelineEvents.push({
        date: eventDate || pageDate,
        dateKind: eventDate ? "eventDate" : "pageDate",
        sourceId: id,
        url: cleanUrl,
        title: title || cleanUrl
      });
    }
    return node;
  }

  for (const row of report.comparisonRows || []) {
    const optionName = row.optionName || "Option";
    for (const [criterion, cell] of Object.entries(row.cells || {})) {
      if (!cell || !cell.quote || !Number.isInteger(cell.startUtf16) || cell.startUtf16 < 0) {
        continue;
      }
      const srcNode = ensureSourceNode(
        cell.sourceUrl,
        cell.sourceTitle,
        cell.pageDate,
        cell.pageDate && cell.eventDate ? cell.eventDate : cell.eventDate,
        cell.fetchedAt,
        "200"
      );
      const claimId = `C${claimIndex}`;
      claimIndex += 1;

      nodes.push({
        id: claimId,
        kind: "verified_claim",
        optionName,
        criterion,
        value: cell.displayValue || cell.value || "",
        quote: cell.quote,
        startUtf16: cell.startUtf16,
        endUtf16: cell.endUtf16,
        sourceUrl: cell.sourceUrl
      });

      edges.push({
        from: srcNode.id,
        to: claimId,
        relation: `utf16_[${cell.startUtf16}..${cell.endUtf16}]`
      });
    }
  }

  for (const unav of report.unavailableSources || []) {
    ensureSourceNode(
      unav.url,
      `HTTP ${unav.statusCode || 503} Недоступен`,
      null,
      null,
      null,
      String(unav.statusCode || 503)
    );
  }

  timelineEvents.sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const mermaidLines = [
    "# Граф знаний происхождения данных и хронология источников (Mermaid)",
    "",
    `**Исследовательский вопрос:** ${question}`,
    "",
    "## 1. Направленный граф происхождения утверждений (`flowchart LR`)",
    "```mermaid",
    "flowchart LR",
    `  ${qNodeId}["${sanitizeMermaidLabel(question)}"]`
  ];

  for (const node of nodes) {
    if (node.kind === "source") {
      mermaidLines.push(
        `  ${node.id}["${sanitizeMermaidLabel(node.title)} (HTTP ${node.httpStatus}, eventDate: ${node.eventDate || "n/a"}, pageDate: ${node.pageDate || "n/a"})"]`
      );
    } else if (node.kind === "verified_claim") {
      mermaidLines.push(
        `  ${node.id}["${sanitizeMermaidLabel(node.optionName)} / ${sanitizeMermaidLabel(node.criterion)}: ${sanitizeMermaidLabel(node.value)} [${node.startUtf16}..${node.endUtf16}]"]`
      );
    }
  }

  for (const edge of edges) {
    mermaidLines.push(`  ${edge.from} -->|${sanitizeMermaidLabel(edge.relation)}| ${edge.to}`);
  }
  mermaidLines.push("```", "");

  mermaidLines.push(
    "## 2. Хронологическая шкала дат источников (`timeline`)",
    "```mermaid",
    "timeline",
    `  title Хронология источников (eventDate / pageDate)`
  );
  for (const ev of timelineEvents) {
    mermaidLines.push(
      `  ${ev.date} : ${sanitizeMermaidLabel(ev.title)} (${ev.dateKind})`
    );
  }
  mermaidLines.push("```", "");

  return {
    question,
    nodesCount: nodes.length,
    edgesCount: edges.length,
    timelineEventsCount: timelineEvents.length,
    nodes,
    edges,
    timelineEvents,
    markdownContent: mermaidLines.join("\n")
  };
}

async function saveMermaidKnowledgeGraphViaWorkspace({
  workspaceRoot,
  slug = "research-knowledge-graph",
  report = {},
  signal = null
} = {}) {
  const graphBundle = buildResearchKnowledgeGraphAndMermaidReport(report);
  const svc = createKosworkWorkspaceService();
  await svc.connectFolder({ folderPath: workspaceRoot, signal });

  const markdownFile = await svc.createFile({
    relativePath: `reports/${slug}.md`,
    content: graphBundle.markdownContent,
    createParents: true,
    signal
  });
  const jsonFile = await svc.createFile({
    relativePath: `reports/${slug}.json`,
    content: JSON.stringify(graphBundle, null, 2) + "\n",
    createParents: true,
    signal
  });

  return {
    graphBundle,
    markdownFile,
    jsonFile
  };
}

module.exports = {
  buildResearchKnowledgeGraphAndMermaidReport,
  saveMermaidKnowledgeGraphViaWorkspace
};
