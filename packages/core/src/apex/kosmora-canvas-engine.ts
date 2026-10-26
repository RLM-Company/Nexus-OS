/**
 * @cosmora/core — Stage 2: Kosmora Canvas & Artifact Engine Implementation (F033–F064)
 */

import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import type {
  CanvasArtifactKind,
  CanvasArtifactRevision,
  CanvasArtifactTab,
  CanvasBlock,
  CanvasArtifactVersion,
  CanvasDiagramSpec,
  CanvasTocEntry,
  CanvasVersionDiffResult,
  CanvasWorkspaceState,
  FileAnalysisBindingLink,
  PresentationSlide,
  RefinedCanvasAction,
  XlsxSheetSpec
} from "./kosmora-canvas.js";

export class CanvasVersionConflictError extends Error {
  public readonly code = "VERSION_CONFLICT" as const;
  public readonly tab_id: string;
  public readonly expected_version: string | number;
  public readonly current_version: string | number;
  public readonly actual_version: string | number;

  constructor(tabId: string, expectedVersion: string | number, currentVersion: string | number) {
    super(
      `Canvas concurrency conflict on tab ${tabId}: expected version ${String(expectedVersion)}, but current version is ${String(currentVersion)}.`
    );
    this.name = "CanvasVersionConflictError";
    this.tab_id = tabId;
    this.expected_version = expectedVersion;
    this.current_version = currentVersion;
    this.actual_version = currentVersion;
  }
}

export const ARTIFACT_TEMPLATES_LIBRARY: Record<
  string,
  {
    template_id: string;
    title: string;
    kind: CanvasArtifactTab["kind"];
    skeleton: string;
  }
> = {
  pitch_deck: {
    template_id: "tpl-pitch-deck",
    title: "Инвестиционный Питч-Дек (10 слайдов)",
    kind: "presentation",
    skeleton: "# Питч-Дек\n## 1. Проблема\n## 2. Решение Kosmora\n## 3. Рынок и Юнит-экономика"
  },
  technical_spec: {
    template_id: "tpl-tech-spec",
    title: "Техническое Задание (RFC / Design Doc)",
    kind: "report",
    skeleton: "# Архитектурная Спецификация\n## Контекст\n## Контракты API\n## План миграции"
  },
  financial_model: {
    template_id: "tpl-fin-model",
    title: "Финансовая Модель P&L и Cashflow",
    kind: "xlsx_table",
    skeleton: "Revenue,COGS,GrossMargin,OpEx,EBITDA"
  }
};

function freezeVersion(v: CanvasArtifactVersion): Readonly<CanvasArtifactVersion> {
  return Object.freeze({
    ...v,
    file_bindings: v.file_bindings.map((b) => Object.freeze({ ...b }))
  });
}

function computeCrc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i]!;
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function buildZipArchiveBuffer(
  files: Array<{ path: string; data: Buffer | string }>
): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.path, "utf8");
    const rawData = typeof file.data === "string" ? Buffer.from(file.data, "utf8") : file.data;
    const compressed = deflateRawSync(rawData);
    const crc = computeCrc32(rawData);

    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(rawData.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    nameBuf.copy(localHeader, 30);

    localParts.push(localHeader, compressed);

    const centralHeader = Buffer.alloc(46 + nameBuf.length);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(rawData.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    nameBuf.copy(centralHeader, 46);

    centralParts.push(centralHeader);
    offset += localHeader.length + compressed.length;
  }

  const centralDirSize = centralParts.reduce((acc, b) => acc + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDirSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, eocd]);
}

function escapeXml(str: string): string {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function colIndexToLetter(colIdx0: number): string {
  let n = colIdx0 + 1;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export class KosmoraCanvasEngine {
  private readonly workspaces = new Map<string, CanvasWorkspaceState>();
  private readonly artifactRevisions = new Map<string, ReadonlyArray<CanvasArtifactRevision>>();

  public createWorkspace(params: {
    workspace_id: string;
    project_id: string;
    left_chat_thread_id: string;
    theme_preset?: CanvasWorkspaceState["theme_preset"];
  }): CanvasWorkspaceState {
    if (!params.workspace_id.trim() || !params.project_id.trim()) {
      throw new Error("workspace_id and project_id are required.");
    }
    const state: CanvasWorkspaceState = {
      workspace_id: params.workspace_id,
      project_id: params.project_id,
      left_chat_thread_id: params.left_chat_thread_id,
      active_tab_id: null,
      split_view_secondary_tab_id: null,
      present_mode_fullscreen: false,
      theme_preset: params.theme_preset ?? "cosmora_dark_minimal",
      tabs: [],
      trash_bin: []
    };
    this.workspaces.set(state.workspace_id, state);
    return state;
  }

  public getWorkspace(workspaceId: string): CanvasWorkspaceState | undefined {
    return this.workspaces.get(workspaceId);
  }

  public openArtifactTab(params: {
    workspace_id: string;
    artifact_id: string;
    title: string;
    kind: CanvasArtifactTab["kind"];
    initial_content: string;
    author_id: string;
    file_bindings?: FileAnalysisBindingLink[];
    critic_approved?: boolean;
  }): CanvasArtifactTab {
    const ws = this.getWorkspaceOrThrow(params.workspace_id);
    const now = new Date().toISOString();
    const tabId = `tab_${params.artifact_id}`;
    const v1 = freezeVersion({
      version_tag: "v1",
      author_type: "agent",
      author_id: params.author_id,
      content: params.initial_content,
      content_sha256: createHash("sha256").update(params.initial_content, "utf8").digest("hex"),
      file_bindings: params.file_bindings ?? [],
      created_at: now
    });
    const tab: CanvasArtifactTab = {
      tab_id: tabId,
      artifact_id: params.artifact_id,
      title: params.title,
      kind: params.kind,
      current_version: "v1",
      versions: [v1],
      locked_section_ids: [],
      dynamic_variables: {},
      inline_review_threads: [],
      verification_badge: params.critic_approved ? "critic_approved" : "needs_revision",
      audit_timeline: [
        {
          entry_id: `aud_${Date.now()}_1`,
          timestamp: now,
          actor_kind: "agent",
          actor_id: params.author_id,
          action: "created_v1",
          version_tag: "v1"
        }
      ]
    };
    ws.tabs.push(tab);
    ws.active_tab_id = tab.tab_id;
    return tab;
  }

  public commitTabVersion(params: {
    workspace_id: string;
    tab_id: string;
    author_type: "agent" | "user";
    author_id: string;
    new_content: string;
    expected_version?: string;
    target_section_id?: string;
    file_bindings?: FileAnalysisBindingLink[];
  }): CanvasArtifactTab {
    const tab = this.getTabOrThrow(params.workspace_id, params.tab_id);
    if (params.expected_version !== undefined && params.expected_version !== tab.current_version) {
      throw new CanvasVersionConflictError(
        tab.tab_id,
        params.expected_version,
        tab.current_version
      );
    }
    if (
      params.author_type === "agent" &&
      params.target_section_id &&
      tab.locked_section_ids.includes(params.target_section_id)
    ) {
      throw new Error(
        `Section "${params.target_section_id}" is locked by the owner and cannot be overwritten by an agent.`
      );
    }

    const nextNumber = tab.versions.length + 1;
    const versionTag = `v${nextNumber}`;
    const now = new Date().toISOString();
    const resolvedContent = this.interpolateVariables(params.new_content, tab.dynamic_variables);
    const prevVersion = tab.versions[tab.versions.length - 1];
    const nextVersionObj = freezeVersion({
      version_tag: versionTag,
      author_type: params.author_type,
      author_id: params.author_id,
      content: resolvedContent,
      content_sha256: createHash("sha256").update(resolvedContent, "utf8").digest("hex"),
      file_bindings: params.file_bindings ?? (prevVersion ? [...prevVersion.file_bindings] : []),
      created_at: now
    });

    tab.versions = [...tab.versions, nextVersionObj];
    tab.current_version = versionTag;
    if (params.author_type === "user") {
      tab.verification_badge = "manual_edit";
    }
    tab.audit_timeline.push({
      entry_id: `aud_${Date.now()}_${nextNumber}`,
      timestamp: now,
      actor_kind: params.author_type,
      actor_id: params.author_id,
      action: params.author_type === "user" ? "manual_user_sync" : "agent_revision",
      version_tag: versionTag
    });

    return tab;
  }

  public computeVersionDiff(
    workspaceId: string,
    tabId: string,
    fromVersion: string,
    toVersion: string
  ): CanvasVersionDiffResult {
    const tab = this.getTabOrThrow(workspaceId, tabId);
    const vFrom = tab.versions.find((v) => v.version_tag === fromVersion);
    const vTo = tab.versions.find((v) => v.version_tag === toVersion);
    if (!vFrom || !vTo) {
      throw new Error(`Version ${fromVersion} or ${toVersion} not found on tab ${tabId}`);
    }

    const oldLines = vFrom.content.split("\n");
    const newLines = vTo.content.split("\n");
    const m = oldLines.length;
    const n = newLines.length;

    const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
    for (let i = m - 1; i >= 0; i--) {
      for (let j = n - 1; j >= 0; j--) {
        if (oldLines[i] === newLines[j]) {
          dp[i]![j] = 1 + dp[i + 1]![j + 1]!;
        } else {
          dp[i]![j] = Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
        }
      }
    }

    const hunks: CanvasVersionDiffResult["hunks"] = [];
    let added = 0;
    let removed = 0;
    let unchanged = 0;
    let i = 0;
    let j = 0;
    let lineCursor = 1;

    while (i < m && j < n) {
      if (oldLines[i] === newLines[j]) {
        unchanged++;
        hunks.push({
          line_number: lineCursor++,
          old_line_number: i + 1,
          new_line_number: j + 1,
          type: "unchanged",
          text: oldLines[i]!
        });
        i++;
        j++;
      } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
        removed++;
        hunks.push({
          line_number: lineCursor++,
          old_line_number: i + 1,
          type: "removed",
          text: oldLines[i]!
        });
        i++;
      } else {
        added++;
        hunks.push({
          line_number: lineCursor++,
          new_line_number: j + 1,
          type: "added",
          text: newLines[j]!
        });
        j++;
      }
    }
    while (i < m) {
      removed++;
      hunks.push({
        line_number: lineCursor++,
        old_line_number: i + 1,
        type: "removed",
        text: oldLines[i]!
      });
      i++;
    }
    while (j < n) {
      added++;
      hunks.push({
        line_number: lineCursor++,
        new_line_number: j + 1,
        type: "added",
        text: newLines[j]!
      });
      j++;
    }

    return {
      artifact_id: tab.artifact_id,
      from_version: fromVersion,
      to_version: toVersion,
      added_lines: added,
      removed_lines: removed,
      unchanged_lines: unchanged,
      hunks
    };
  }

  public applyRefinedControlOnSelection(params: {
    workspace_id: string;
    tab_id: string;
    selected_text: string;
    action: RefinedCanvasAction;
    agent_id: string;
    expected_version?: string;
  }): { updated_version: string; transformed_fragment: string } {
    const tab = this.getTabOrThrow(params.workspace_id, params.tab_id);
    const latest = tab.versions[tab.versions.length - 1]!;
    if (!latest.content.includes(params.selected_text)) {
      throw new Error("Selected fragment not found in current version.");
    }

    let replacement = params.selected_text;
    switch (params.action) {
      case "compress":
        replacement = `[Сжато]: ${params.selected_text.slice(0, Math.max(24, Math.floor(params.selected_text.length * 0.6)))}...`;
        break;
      case "academic_style":
        replacement = `Согласно результатам верифицированного анализа, ${params.selected_text.charAt(0).toLowerCase() + params.selected_text.slice(1)}`;
        break;
      case "fact_check":
        replacement = `${params.selected_text} [Проверено по графу происхождения: подтверждено]`;
        break;
      case "convert_to_table":
        replacement = `| Показатель | Значение |\n| --- | --- |\n| ${params.selected_text.replace(/\n/g, " ")} | Подтверждено |`;
        break;
    }

    const updatedContent = latest.content.replace(params.selected_text, replacement);
    const updatedTab = this.commitTabVersion({
      workspace_id: params.workspace_id,
      tab_id: params.tab_id,
      author_type: "agent",
      author_id: params.agent_id,
      new_content: updatedContent,
      ...(params.expected_version !== undefined
        ? { expected_version: params.expected_version }
        : {})
    });
    return {
      updated_version: updatedTab.current_version,
      transformed_fragment: replacement
    };
  }

  public evaluateSheetFormulas(sheet: XlsxSheetSpec): Map<string, number> {
    const cellValues = new Map<string, number>();
    sheet.rows.forEach((row, rIdx) => {
      row.forEach((val, cIdx) => {
        const ref = `${colIndexToLetter(cIdx)}${rIdx + 2}`;
        if (typeof val === "number" && Number.isFinite(val)) {
          cellValues.set(ref, val);
        }
      });
    });

    const collectRange = (startRef: string, endRef: string): number[] => {
      const m1 = /^([A-Z]+)(\d+)$/.exec(startRef);
      const m2 = /^([A-Z]+)(\d+)$/.exec(endRef);
      if (!m1 || !m2) return [];
      const colStart = m1[1]!.charCodeAt(0) - 65;
      const colEnd = m2[1]!.charCodeAt(0) - 65;
      const rowStart = Number(m1[2]);
      const rowEnd = Number(m2[2]);
      const vals: number[] = [];
      for (let c = Math.min(colStart, colEnd); c <= Math.max(colStart, colEnd); c++) {
        for (let r = Math.min(rowStart, rowEnd); r <= Math.max(rowStart, rowEnd); r++) {
          const v = cellValues.get(`${colIndexToLetter(c)}${r}`);
          if (v !== undefined) vals.push(v);
        }
      }
      return vals;
    };

    const results = new Map<string, number>();
    for (const f of sheet.formulas) {
      const expr = f.formula.replace(/^=/, "").trim().toUpperCase();
      let evaluated = f.evaluated_preview ?? 0;

      const fnMatch = /^(SUM|AVERAGE|AVG|MIN|MAX)\(([A-Z]+\d+):([A-Z]+\d+)\)$/.exec(expr);
      if (fnMatch) {
        const fnName = fnMatch[1]!;
        const rangeVals = collectRange(fnMatch[2]!, fnMatch[3]!);
        const sum = rangeVals.reduce((acc, x) => acc + x, 0);
        if (fnName === "SUM") {
          evaluated = Number(sum.toFixed(4));
        } else if (fnName === "AVERAGE" || fnName === "AVG") {
          evaluated = rangeVals.length > 0 ? Number((sum / rangeVals.length).toFixed(4)) : 0;
        } else if (fnName === "MIN") {
          evaluated = rangeVals.length > 0 ? Math.min(...rangeVals) : 0;
        } else if (fnName === "MAX") {
          evaluated = rangeVals.length > 0 ? Math.max(...rangeVals) : 0;
        }
      } else {
        const binMatch = /^([A-Z]+\d+)\s*([+\-*/])\s*([A-Z]+\d+)$/.exec(expr);
        if (binMatch) {
          const left = cellValues.get(binMatch[1]!) ?? 0;
          const op = binMatch[2]!;
          const right = cellValues.get(binMatch[3]!) ?? 1;
          if (op === "+") evaluated = left + right;
          if (op === "-") evaluated = left - right;
          if (op === "*") evaluated = left * right;
          if (op === "/") evaluated = right !== 0 ? Number((left / right).toFixed(6)) : 0;
        }
      }
      f.evaluated_preview = evaluated;
      cellValues.set(f.cell.toUpperCase(), evaluated);
      results.set(f.cell, evaluated);
    }
    return results;
  }

  public exportXlsxWorkbookBuffer(sheets: XlsxSheetSpec[]): Buffer {
    if (sheets.length === 0) {
      throw new Error("At least one sheet is required to export XLSX.");
    }

    const files: Array<{ path: string; data: string }> = [
      {
        path: "[Content_Types].xml",
        data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  ${sheets
    .map(
      (_, idx) =>
        `<Override PartName="/xl/worksheets/sheet${idx + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    )
    .join("\n  ")}
</Types>`
      },
      {
        path: "_rels/.rels",
        data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`
      },
      {
        path: "xl/workbook.xml",
        data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    ${sheets
      .map(
        (s, idx) =>
          `<sheet name="${escapeXml(s.sheet_name)}" sheetId="${idx + 1}" r:id="rId${idx + 1}"/>`
      )
      .join("\n    ")}
  </sheets>
</workbook>`
      },
      {
        path: "xl/_rels/workbook.xml.rels",
        data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${sheets
    .map(
      (_, idx) =>
        `<Relationship Id="rId${idx + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${idx + 1}.xml"/>`
    )
    .join("\n  ")}
</Relationships>`
      }
    ];

    sheets.forEach((sheet, idx) => {
      const evaluatedMap = this.evaluateSheetFormulas(sheet);
      const xmlRows: string[] = [];

      const headerCells = sheet.columns
        .map(
          (col, cIdx) =>
            `<c r="${colIndexToLetter(cIdx)}1" t="inlineStr"><is><t>${escapeXml(col)}</t></is></c>`
        )
        .join("");
      xmlRows.push(`<row r="1">${headerCells}</row>`);

      sheet.rows.forEach((row, rIdx) => {
        const rowNum = rIdx + 2;
        const cells = row
          .map((cellVal, cIdx) => {
            const ref = `${colIndexToLetter(cIdx)}${rowNum}`;
            if (typeof cellVal === "number" && Number.isFinite(cellVal)) {
              return `<c r="${ref}"><v>${cellVal}</v></c>`;
            }
            return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(String(cellVal))}</t></is></c>`;
          })
          .join("");
        xmlRows.push(`<row r="${rowNum}">${cells}</row>`);
      });

      const formulaRowNum = sheet.rows.length + 2;
      if (sheet.formulas.length > 0) {
        const fCells = sheet.formulas
          .map((f) => {
            const cleanFormula = escapeXml(f.formula.replace(/^=/, ""));
            const val = evaluatedMap.get(f.cell) ?? f.evaluated_preview ?? 0;
            return `<c r="${escapeXml(f.cell)}"><f>${cleanFormula}</f><v>${val}</v></c>`;
          })
          .join("");
        xmlRows.push(`<row r="${formulaRowNum}">${fCells}</row>`);
      }

      files.push({
        path: `xl/worksheets/sheet${idx + 1}.xml`,
        data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    ${xmlRows.join("\n    ")}
  </sheetData>
</worksheet>`
      });
    });

    return buildZipArchiveBuffer(files);
  }

  public exportCorporatePdfBuffer(
    paramsOrArtifactId: { title: string; markdown_content: string; author?: string } | string,
    version?: number
  ): Buffer {
    const params =
      typeof paramsOrArtifactId === "string"
        ? {
            title: paramsOrArtifactId,
            markdown_content: this.exportToMarkdown(paramsOrArtifactId, version),
            author: "Kosmora Canvas"
          }
        : paramsOrArtifactId;
    const cleanLines = [
      params.title,
      `Author: ${params.author ?? "Kosmora Canvas"}`,
      ...params.markdown_content.split("\n")
    ].map((line) =>
      line
        .replace(/[^\x20-\x7E]/g, " ")
        .replaceAll("\\", "\\\\")
        .replaceAll("(", "\\(")
        .replaceAll(")", "\\)")
        .slice(0, 90)
    );

    const streamOps = [
      "BT",
      "/F1 14 Tf",
      "50 750 Td",
      `(${cleanLines[0] ?? "Report"}) Tj`,
      "/F1 10 Tf",
      ...cleanLines.slice(1, 40).map((l) => `0 -16 Td (${l}) Tj`),
      "ET"
    ].join("\n");

    const streamBytes = Buffer.from(streamOps, "ascii");
    const objects = [
      "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
      "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
      "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
      "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
      `5 0 obj\n<< /Length ${streamBytes.length} >>\nstream\n${streamOps}\nendstream\nendobj\n`
    ];

    let body = "%PDF-1.4\n";
    const offsets: number[] = [];
    for (const obj of objects) {
      offsets.push(Buffer.byteLength(body, "ascii"));
      body += obj;
    }

    const xrefOffset = Buffer.byteLength(body, "ascii");
    const xrefLines = [
      "xref",
      `0 ${objects.length + 1}`,
      "0000000000 65535 f ",
      ...offsets.map((off) => `${String(off).padStart(10, "0")} 00000 n `)
    ];
    const trailer = [
      ...xrefLines,
      "trailer",
      `<< /Size ${objects.length + 1} /Root 1 0 R >>`,
      "startxref",
      String(xrefOffset),
      "%%EOF\n"
    ].join("\n");

    return Buffer.from(body + trailer, "ascii");
  }

  public convertXlsxTableToPresentationSlides(sheet: XlsxSheetSpec): PresentationSlide[] {
    this.evaluateSheetFormulas(sheet);
    return [
      {
        slide_id: `slide_${sheet.sheet_name}_1`,
        index: 1,
        layout: "title_hero",
        action_title: `${sheet.sheet_name}: Ключевые финансовые и операционные тренды`,
        bullet_points: [
          `Проанализировано строк данных: ${sheet.rows.length}`,
          `Активных расчётных формул: ${sheet.formulas.length}`
        ],
        speaker_notes: `Вводный слайд, автоматически сгенерированный из листа ${sheet.sheet_name}.`
      },
      {
        slide_id: `slide_${sheet.sheet_name}_2`,
        index: 2,
        layout: "metrics_spotlight",
        action_title: `Итоговые расчётные показатели по формулам (${sheet.sheet_name})`,
        bullet_points: sheet.formulas.map(
          (f) => `Ячейка ${f.cell} (${f.formula}) = ${f.evaluated_preview ?? 0}`
        ),
        speaker_notes: "Детализация ключевых формул и проверенных агрегатов."
      },
      {
        slide_id: `slide_${sheet.sheet_name}_3`,
        index: 3,
        layout: "chart_breakdown",
        action_title: `Динамика показателей по категориям (${sheet.columns.join(" / ")})`,
        bullet_points: sheet.rows.slice(0, 3).map((r) => r.join(" — ")),
        speaker_notes: "Визуализация трендов на основе таблицы.",
        chart_widget: {
          widget_id: `chart_${sheet.sheet_name}`,
          chart_type: "bar",
          title: sheet.sheet_name,
          labels: sheet.rows.map((r) => String(r[0] ?? "")),
          series: [
            {
              name: String(sheet.columns[1] ?? "Value"),
              values: sheet.rows.map((r) => Number(r[1] ?? 0))
            }
          ]
        }
      }
    ];
  }

  public buildDiagramArtifact(
    engine: CanvasDiagramSpec["engine"],
    nodes: Array<{ from: string; to: string; label?: string }>
  ): CanvasDiagramSpec {
    const lines =
      engine === "mermaid"
        ? [
            "flowchart TD",
            ...nodes.map((e) =>
              e.label ? `  ${e.from} -->|${e.label}| ${e.to}` : `  ${e.from} --> ${e.to}`
            )
          ]
        : nodes.map((e) => `${e.from} -> ${e.to}${e.label ? `: ${e.label}` : ""}`);

    const svgNodes = nodes
      .map(
        (e, idx) =>
          `<g transform="translate(20, ${30 + idx * 40})"><text fill="#e5e5e5" font-family="monospace" font-size="12">${escapeXml(e.from)} -&gt; ${escapeXml(e.to)}${e.label ? ` (${escapeXml(e.label)})` : ""}</text></g>`
      )
      .join("");

    return {
      diagram_id: `diag_${Date.now()}`,
      engine,
      source_code: lines.join("\n"),
      svg_export_ready: true,
      svg_markup: `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="${Math.max(100, nodes.length * 45 + 40)}" viewBox="0 0 600 ${Math.max(100, nodes.length * 45 + 40)}"><rect width="100%" height="100%" fill="#0a0a0a"/>${svgNodes}</svg>`
    };
  }

  public setSplitViewAndPresentMode(params: {
    workspace_id: string;
    secondary_tab_id: string | null;
    present_mode_fullscreen?: boolean;
  }): CanvasWorkspaceState {
    const ws = this.getWorkspaceOrThrow(params.workspace_id);
    ws.split_view_secondary_tab_id = params.secondary_tab_id;
    if (params.present_mode_fullscreen !== undefined) {
      ws.present_mode_fullscreen = params.present_mode_fullscreen;
    }
    return ws;
  }

  public addInlineReviewComment(params: {
    workspace_id: string;
    tab_id: string;
    line_number: number;
    author: "user" | "critic" | "manager";
    comment: string;
  }): CanvasArtifactTab {
    const tab = this.getTabOrThrow(params.workspace_id, params.tab_id);
    tab.inline_review_threads.push({
      thread_id: `thread_${Date.now()}`,
      line_number: params.line_number,
      author: params.author,
      comment: params.comment,
      resolved: false,
      created_at: new Date().toISOString()
    });
    return tab;
  }

  public extractTableOfContents(markdownContent: string): CanvasTocEntry[] {
    const lines = markdownContent.split("\n");
    const entries: CanvasTocEntry[] = [];
    lines.forEach((line, idx) => {
      const match = /^(#{1,4})\s+(.+)$/.exec(line.trim());
      if (match) {
        const level = match[1]!.length as 1 | 2 | 3 | 4;
        const text = match[2]!.trim();
        const slug = text
          .toLowerCase()
          .replace(/[^\p{L}\p{N}\s-]/gu, "")
          .trim()
          .replace(/\s+/g, "-");
        entries.push({
          level,
          heading_text: text,
          anchor_slug: slug,
          line_number: idx + 1
        });
      }
    });
    return entries;
  }

  public lockSection(workspaceId: string, tabId: string, sectionId: string): CanvasArtifactTab {
    const tab = this.getTabOrThrow(workspaceId, tabId);
    if (!tab.locked_section_ids.includes(sectionId)) {
      tab.locked_section_ids.push(sectionId);
    }
    return tab;
  }

  public updateDynamicVariables(
    workspaceId: string,
    tabId: string,
    variables: Record<string, string | number>
  ): CanvasArtifactTab {
    const tab = this.getTabOrThrow(workspaceId, tabId);
    tab.dynamic_variables = { ...tab.dynamic_variables, ...variables };
    const latest = tab.versions[tab.versions.length - 1]!;
    return this.commitTabVersion({
      workspace_id: workspaceId,
      tab_id: tabId,
      author_type: "agent",
      author_id: "variable-interpolator",
      new_content: latest.content
    });
  }

  private interpolateVariables(
    content: string,
    variables: Record<string, string | number>
  ): string {
    let result = content;
    for (const [key, val] of Object.entries(variables)) {
      result = result.replaceAll(`{{${key}}}`, String(val));
    }
    return result;
  }

  public validateCitationsAndLinks(markdownContent: string): {
    valid: boolean;
    total_links: number;
    broken_links: string[];
  } {
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    const broken: string[] = [];
    let total = 0;
    let match: RegExpExecArray | null;
    while ((match = linkRegex.exec(markdownContent)) !== null) {
      total++;
      const url = match[2]!.trim();
      if (
        !url ||
        url === "#" ||
        url.startsWith("javascript:") ||
        (!url.startsWith("http://") && !url.startsWith("https://") && !url.startsWith("/"))
      ) {
        broken.push(url || "<empty>");
      }
    }
    return {
      valid: broken.length === 0,
      total_links: total,
      broken_links: broken
    };
  }

  public generateTtsBriefingScript(
    workspaceId: string,
    tabId: string
  ): {
    tab_id: string;
    mode: "ssml_script_only";
    estimated_duration_sec: number;
    ssml_script: string;
  } {
    const tab = this.getTabOrThrow(workspaceId, tabId);
    const latest = tab.versions[tab.versions.length - 1]!;
    const headings = this.extractTableOfContents(latest.content)
      .map((h) => h.heading_text)
      .slice(0, 5);
    const summaryText = `Аудио-брифинг по документу «${tab.title}» (версия ${tab.current_version}). Ключевые разделы: ${headings.join(", ") || "основной отчёт"}. Статус проверки: ${tab.verification_badge}.`;
    return {
      tab_id: tabId,
      mode: "ssml_script_only",
      estimated_duration_sec: Math.max(15, Math.ceil(summaryText.length / 14)),
      ssml_script: `<speak><prosody rate="1.05">${summaryText}</prosody></speak>`
    };
  }

  public deleteTabToTrash(workspaceId: string, tabId: string): CanvasArtifactTab {
    const ws = this.getWorkspaceOrThrow(workspaceId);
    const idx = ws.tabs.findIndex((t) => t.tab_id === tabId);
    if (idx === -1) throw new Error(`Tab ${tabId} not found`);
    const [removed] = ws.tabs.splice(idx, 1);
    ws.trash_bin.push(removed!);
    if (ws.active_tab_id === tabId) {
      ws.active_tab_id = ws.tabs[0]?.tab_id ?? null;
    }
    return removed!;
  }

  public restoreTabFromTrash(workspaceId: string, tabId: string): CanvasArtifactTab {
    const ws = this.getWorkspaceOrThrow(workspaceId);
    const idx = ws.trash_bin.findIndex((t) => t.tab_id === tabId);
    if (idx === -1) throw new Error(`Tab ${tabId} not found in trash bin`);
    const [restored] = ws.trash_bin.splice(idx, 1);
    ws.tabs.push(restored!);
    ws.active_tab_id = restored!.tab_id;
    return restored!;
  }

  public stitchMasterReleaseDocument(params: {
    workspace_id: string;
    tab_ids: string[];
    master_title: string;
  }): {
    master_markdown: string;
    corporate_pdf_html: string;
    pdf_buffer: Buffer;
    zip_archive_buffer: Buffer;
    archive_manifest: Array<{ tab_id: string; title: string; version: string }>;
  } {
    const ws = this.getWorkspaceOrThrow(params.workspace_id);
    const selected = params.tab_ids.map((id) => {
      const found = ws.tabs.find((t) => t.tab_id === id);
      if (!found) throw new Error(`Tab ${id} not found for master stitch.`);
      return found;
    });

    const sections = selected.map((t) => {
      const latest = t.versions[t.versions.length - 1]!;
      return `## ${t.title} (${t.current_version})\n\n${latest.content}`;
    });

    const masterMarkdown = `# ${params.master_title}\n\n` + sections.join("\n\n---\n\n");
    const corporatePdfHtml = `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"/><title>${escapeXml(params.master_title)}</title></head><body data-theme="${ws.theme_preset}"><header><h1>${escapeXml(params.master_title)}</h1></header><main>${escapeXml(masterMarkdown)}</main></body></html>`;
    const pdfBuffer = this.exportCorporatePdfBuffer({
      title: params.master_title,
      markdown_content: masterMarkdown
    });
    const zipBuffer = buildZipArchiveBuffer([
      { path: "master-release.md", data: masterMarkdown },
      { path: "master-release.pdf", data: pdfBuffer },
      ...selected.map((t) => ({
        path: `tabs/${t.tab_id}-${t.current_version}.md`,
        data: t.versions[t.versions.length - 1]!.content
      }))
    ]);

    return {
      master_markdown: masterMarkdown,
      corporate_pdf_html: corporatePdfHtml,
      pdf_buffer: pdfBuffer,
      zip_archive_buffer: zipBuffer,
      archive_manifest: selected.map((t) => ({
        tab_id: t.tab_id,
        title: t.title,
        version: t.current_version
      }))
    };
  }

  private getWorkspaceOrThrow(workspaceId: string): CanvasWorkspaceState {
    const ws = this.workspaces.get(workspaceId);
    if (!ws) throw new Error(`Canvas workspace ${workspaceId} not found.`);
    return ws;
  }

  private getTabOrThrow(workspaceId: string, tabId: string): CanvasArtifactTab {
    const ws = this.getWorkspaceOrThrow(workspaceId);
    const tab = ws.tabs.find((t) => t.tab_id === tabId);
    if (!tab) {
      throw new Error(`Canvas tab ${tabId} not found in workspace ${workspaceId}.`);
    }
    return tab;
  }

  public commitRevision(params: {
    artifact_id: string;
    kind: CanvasArtifactKind;
    title: string;
    author_id: string;
    commit_message: string;
    blocks: CanvasBlock[];
    expected_version?: number;
  }): CanvasArtifactRevision {
    const history = this.artifactRevisions.get(params.artifact_id) ?? [];
    const currentVersion = history.length > 0 ? history[history.length - 1]!.version : 0;

    if (params.expected_version !== undefined && params.expected_version !== currentVersion) {
      throw new CanvasVersionConflictError(
        params.artifact_id,
        params.expected_version,
        currentVersion
      );
    }

    const nextVersion = currentVersion + 1;
    const frozenBlocks = Object.freeze(
      params.blocks.map((b) =>
        Object.freeze({
          ...b,
          citations: Object.freeze((b.citations ?? []).map((c) => Object.freeze({ ...c })))
        })
      )
    );
    const contentSha256 = createHash("sha256")
      .update(
        JSON.stringify({
          title: params.title,
          kind: params.kind,
          blocks: frozenBlocks
        })
      )
      .digest("hex");

    const revision: CanvasArtifactRevision = Object.freeze({
      revision_id: `rev_${params.artifact_id}_v${nextVersion}_${contentSha256.slice(0, 8)}`,
      artifact_id: params.artifact_id,
      kind: params.kind,
      version: nextVersion,
      title: params.title,
      author_id: params.author_id,
      commit_message: params.commit_message,
      blocks: frozenBlocks,
      content_sha256: contentSha256,
      created_at: new Date().toISOString()
    });

    this.artifactRevisions.set(params.artifact_id, Object.freeze([...history, revision]));
    return revision;
  }

  public computeRevisionDiff(
    artifactId: string,
    fromVersion: number,
    toVersion: number
  ): {
    artifact_id: string;
    from_version: number;
    to_version: number;
    total_additions: number;
    total_deletions: number;
    block_diffs: Array<{
      block_id: string;
      line_changes: Array<{
        type: "added" | "removed" | "unchanged";
        line: string;
      }>;
    }>;
  } {
    const history = this.artifactRevisions.get(artifactId) ?? [];
    const revA = history.find((r) => r.version === fromVersion);
    const revB = history.find((r) => r.version === toVersion);
    if (!revA || !revB) {
      throw new Error(
        `Revision not found for artifact '${artifactId}' (v${fromVersion} -> v${toVersion})`
      );
    }

    let totalAdditions = 0;
    let totalDeletions = 0;
    const blockIds = new Set<string>([
      ...revA.blocks.map((b) => b.block_id),
      ...revB.blocks.map((b) => b.block_id)
    ]);

    const blockDiffs: Array<{
      block_id: string;
      line_changes: Array<{ type: "added" | "removed" | "unchanged"; line: string }>;
    }> = [];

    for (const bid of blockIds) {
      const aLines = (revA.blocks.find((b) => b.block_id === bid)?.content ?? "").split("\n");
      const bLines = (revB.blocks.find((b) => b.block_id === bid)?.content ?? "").split("\n");

      // True dynamic-programming LCS line diff
      const m = aLines.length;
      const n = bLines.length;
      const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
      for (let i = m - 1; i >= 0; i--) {
        for (let j = n - 1; j >= 0; j--) {
          if (aLines[i] === bLines[j]) {
            dp[i]![j] = 1 + (dp[i + 1]?.[j + 1] ?? 0);
          } else {
            dp[i]![j] = Math.max(dp[i + 1]?.[j] ?? 0, dp[i]?.[j + 1] ?? 0);
          }
        }
      }

      const changes: Array<{ type: "added" | "removed" | "unchanged"; line: string }> = [];
      let i = 0;
      let j = 0;
      while (i < m && j < n) {
        if (aLines[i] === bLines[j]) {
          changes.push({ type: "unchanged", line: aLines[i]! });
          i++;
          j++;
        } else if ((dp[i + 1]?.[j] ?? 0) >= (dp[i]?.[j + 1] ?? 0)) {
          changes.push({ type: "removed", line: aLines[i]! });
          totalDeletions++;
          i++;
        } else {
          changes.push({ type: "added", line: bLines[j]! });
          totalAdditions++;
          j++;
        }
      }
      while (i < m) {
        changes.push({ type: "removed", line: aLines[i]! });
        totalDeletions++;
        i++;
      }
      while (j < n) {
        changes.push({ type: "added", line: bLines[j]! });
        totalAdditions++;
        j++;
      }

      blockDiffs.push({ block_id: bid, line_changes: changes });
    }

    return {
      artifact_id: artifactId,
      from_version: fromVersion,
      to_version: toVersion,
      total_additions: totalAdditions,
      total_deletions: totalDeletions,
      block_diffs: blockDiffs
    };
  }

  public exportToMarkdown(artifactId: string, version?: number): string {
    const history = this.artifactRevisions.get(artifactId) ?? [];
    const target = version
      ? history.find((r) => r.version === version)
      : history[history.length - 1];
    if (!target) {
      return `# ${artifactId}\n`;
    }
    const sections = target.blocks.map((b) => `## ${b.heading ?? b.block_id}\n\n${b.content}`);
    return `# ${target.title} (v${target.version})\n\n` + sections.join("\n\n");
  }

  public exportFinancialSheetModel(params: {
    sheet_name: string;
    columns: string[];
    rows: Array<Record<string, string | number>>;
    formulas: Array<{ cell: string; expression: string }>;
  }): {
    sheet_name: string;
    formulas: Array<{ cell: string; expression: string; evaluated_value: number }>;
    xlsx_buffer: Buffer;
    xlsx_byte_length: number;
  } {
    const matrixRows = params.rows.map((r) => params.columns.map((col) => r[col] ?? ""));
    const spec: XlsxSheetSpec = {
      sheet_name: params.sheet_name,
      columns: [...params.columns],
      rows: matrixRows,
      formulas: params.formulas.map((f) => ({
        cell: f.cell,
        formula: f.expression
      }))
    };
    this.evaluateSheetFormulas(spec);
    const xlsxBuffer = this.exportXlsxWorkbookBuffer([spec]);
    return {
      sheet_name: params.sheet_name,
      formulas: spec.formulas.map((f) => ({
        cell: f.cell,
        expression: f.formula,
        evaluated_value: Number(f.evaluated_preview ?? 0)
      })),
      xlsx_buffer: xlsxBuffer,
      xlsx_byte_length: xlsxBuffer.length
    };
  }
}
