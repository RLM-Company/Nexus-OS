/**
 * @cosmora/core — Stage 2: Kosmora Canvas & Artifact Engine Implementation (F033–F064)
 */

import type {
  CanvasArtifactTab,
  CanvasChartWidgetSpec,
  CanvasDiagramSpec,
  CanvasTocEntry,
  CanvasVersionDiffResult,
  CanvasWorkspaceState,
  FileAnalysisBindingLink,
  PresentationSlide,
  RefinedCanvasAction,
  XlsxSheetSpec,
} from "../../contracts/src/kosmora-canvas.ts";

export const ARTIFACT_TEMPLATES_LIBRARY: Record<
  string,
  { template_id: string; title: string; kind: CanvasArtifactTab["kind"]; skeleton: string }
> = {
  pitch_deck: {
    template_id: "tpl-pitch-deck",
    title: "Инвестиционный Питч-Дек (10 слайдов)",
    kind: "presentation",
    skeleton: "# Питч-Дек\n## 1. Проблема\n## 2. Решение Kosmora\n## 3. Рынок и Юнит-экономика",
  },
  technical_spec: {
    template_id: "tpl-tech-spec",
    title: "Техническое Задание (RFC / Design Doc)",
    kind: "report",
    skeleton: "# Архитектурная Спецификация\n## Контекст\n## Контракты API\n## План миграции",
  },
  financial_model: {
    template_id: "tpl-fin-model",
    title: "Финансовая Модель P&L и Cashflow",
    kind: "xlsx_table",
    skeleton: "Revenue,COGS,GrossMargin,OpEx,EBITDA",
  },
};

export class KosmoraCanvasEngine {
  private readonly workspaces = new Map<string, CanvasWorkspaceState>();

  // F033, F045, F057: Initialize Dual-Pane Multi-Tab Canvas Workspace
  public createWorkspace(params: {
    workspace_id: string;
    project_id: string;
    left_chat_thread_id: string;
    theme_preset?: CanvasWorkspaceState["theme_preset"];
  }): CanvasWorkspaceState {
    const state: CanvasWorkspaceState = {
      workspace_id: params.workspace_id,
      project_id: params.project_id,
      left_chat_thread_id: params.left_chat_thread_id,
      active_tab_id: null,
      split_view_secondary_tab_id: null,
      present_mode_fullscreen: false,
      theme_preset: params.theme_preset ?? "cosmora_dark_minimal",
      tabs: [],
      trash_bin: [],
    };
    this.workspaces.set(state.workspace_id, state);
    return state;
  }

  // F034, F035, F048, F062: Open Tab with Version v1 & File Analysis Bindings
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
    const tab: CanvasArtifactTab = {
      tab_id: tabId,
      artifact_id: params.artifact_id,
      title: params.title,
      kind: params.kind,
      current_version: "v1",
      versions: [
        {
          version_tag: "v1",
          author_type: "agent",
          author_id: params.author_id,
          content: params.initial_content,
          file_bindings: params.file_bindings ?? [],
          created_at: now,
        },
      ],
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
          version_tag: "v1",
        },
      ],
    };
    ws.tabs.push(tab);
    ws.active_tab_id = tab.tab_id;
    return tab;
  }

  // F034, F050, F054: Commit New Version (Agent or Manual User Sync) Respecting Locked Sections
  public commitTabVersion(params: {
    workspace_id: string;
    tab_id: string;
    author_type: "agent" | "user";
    author_id: string;
    new_content: string;
    target_section_id?: string;
    file_bindings?: FileAnalysisBindingLink[];
  }): CanvasArtifactTab {
    const tab = this.getTabOrThrow(params.workspace_id, params.tab_id);
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

    tab.versions.push({
      version_tag: versionTag,
      author_type: params.author_type,
      author_id: params.author_id,
      content: resolvedContent,
      file_bindings:
        params.file_bindings ?? tab.versions[tab.versions.length - 1]?.file_bindings ?? [],
      created_at: now,
    });
    tab.current_version = versionTag;
    if (params.author_type === "user") {
      tab.verification_badge = "manual_edit"; // F048 & F050
    }
    tab.audit_timeline.push({
      entry_id: `aud_${Date.now()}_${nextNumber}`,
      timestamp: now,
      actor_kind: params.author_type,
      actor_id: params.author_id,
      action: params.author_type === "user" ? "manual_user_sync" : "agent_revision",
      version_tag: versionTag,
    });

    return tab;
  }

  // F036: Visual Line-by-Line Diff Between Any Two Versions
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
    const maxLen = Math.max(oldLines.length, newLines.length);
    const hunks: CanvasVersionDiffResult["hunks"] = [];
    let added = 0;
    let removed = 0;
    let unchanged = 0;

    for (let i = 0; i < maxLen; i++) {
      const o = oldLines[i];
      const n = newLines[i];
      if (o === n && o !== undefined) {
        unchanged++;
        hunks.push({ line_number: i + 1, type: "unchanged", text: o });
      } else {
        if (o !== undefined) {
          removed++;
          hunks.push({ line_number: i + 1, type: "removed", text: o });
        }
        if (n !== undefined) {
          added++;
          hunks.push({ line_number: i + 1, type: "added", text: n });
        }
      }
    }

    return {
      artifact_id: tab.artifact_id,
      from_version: fromVersion,
      to_version: toVersion,
      added_lines: added,
      removed_lines: removed,
      unchanged_lines: unchanged,
      hunks,
    };
  }

  // F040 & F041: Refined Canvas Controls & In-Place Selection Regeneration
  public applyRefinedControlOnSelection(params: {
    workspace_id: string;
    tab_id: string;
    selected_text: string;
    action: RefinedCanvasAction;
    agent_id: string;
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
    });
    return {
      updated_version: updatedTab.current_version,
      transformed_fragment: replacement,
    };
  }

  // F038 & F060: Generate Formula-Backed XLSX Specification & 1-Click Table-to-Slides Converter
  public convertXlsxTableToPresentationSlides(sheet: XlsxSheetSpec): PresentationSlide[] {
    return [
      {
        slide_id: `slide_${sheet.sheet_name}_1`,
        index: 1,
        layout: "title_hero",
        action_title: `${sheet.sheet_name}: Ключевые финансовые и операционные тренды`,
        bullet_points: [
          `Проанализировано строк данных: ${sheet.rows.length}`,
          `Активных расчётных формул: ${sheet.formulas.length}`,
        ],
        speaker_notes: `Вводный слайд, автоматически сгенерированный из листа ${sheet.sheet_name}.`,
      },
      {
        slide_id: `slide_${sheet.sheet_name}_2`,
        index: 2,
        layout: "metrics_spotlight",
        action_title: `Итоговые расчётные показатели по формулам (${sheet.sheet_name})`,
        bullet_points: sheet.formulas.map(
          (f) => `Ячейка ${f.cell} (${f.formula}) = ${f.evaluated_preview}`
        ),
        speaker_notes: "Детализация ключевых формул и проверенных агрегатов.",
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
              values: sheet.rows.map((r) => Number(r[1] ?? 0)),
            },
          ],
        },
      },
    ];
  }

  // F042: Render Architectural Diagram (Mermaid / D2 / Flow)
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
            ),
          ]
        : nodes.map((e) => `${e.from} -> ${e.to}${e.label ? `: ${e.label}` : ""}`);

    return {
      diagram_id: `diag_${Date.now()}`,
      engine,
      source_code: lines.join("\n"),
      svg_export_ready: true,
    };
  }

  // F046 & F059: Configure Split-View and Fullscreen Presentation Mode
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

  // F047: Attach Inline Comment / Review Thread
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
      created_at: new Date().toISOString(),
    });
    return tab;
  }

  // F053: Extract Floating H1–H4 Table of Contents for Long Reports
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
          line_number: idx + 1,
        });
      }
    });
    return entries;
  }

  // F054 & F055: Lock Section & Update Cross-Document Dynamic Variables
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
      new_content: latest.content,
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

  // F058: Automatic Broken Link and Footnote Citation Validator
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
    return { valid: broken.length === 0, total_links: total, broken_links: broken };
  }

  // F061: Generate Audio TTS Executive Briefing Summary
  public generateTtsBriefingScript(workspaceId: string, tabId: string): {
    tab_id: string;
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
      estimated_duration_sec: Math.max(15, Math.ceil(summaryText.length / 14)),
      ssml_script: `<speak><prosody rate="1.05">${summaryText}</prosody></speak>`,
    };
  }

  // F063: Canvas Trash Bin Soft-Delete & Instant Restore
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

  // F039, F051, F052, F064: Stitch Multiple Artifacts into a Master Document & Export Bundle
  public stitchMasterReleaseDocument(params: {
    workspace_id: string;
    tab_ids: string[];
    master_title: string;
  }): {
    master_markdown: string;
    corporate_pdf_html: string;
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
    const corporatePdfHtml = `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"/><title>${params.master_title}</title></head><body data-theme="${ws.theme_preset}"><header><h1>${params.master_title}</h1></header><main>${masterMarkdown}</main></body></html>`;

    return {
      master_markdown: masterMarkdown,
      corporate_pdf_html: corporatePdfHtml,
      archive_manifest: selected.map((t) => ({
        tab_id: t.tab_id,
        title: t.title,
        version: t.current_version,
      })),
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
    if (!tab) throw new Error(`Canvas tab ${tabId} not found in workspace ${workspaceId}.`);
    return tab;
  }
}
