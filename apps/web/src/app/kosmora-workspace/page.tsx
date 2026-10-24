/**
 * @cosmora/web — Kosmora Dual-Pane Canvas, Provenance Inspector & Graph Navigator View Model
 * Covers F033, F040, F045, F046, F048, F049, F053, F057, F059, F102, F115, F127
 */

import type { CanvasWorkspaceState } from "../../../../packages/contracts/src/kosmora-canvas.ts";
import type { RuntimeArtifact } from "../../../../packages/contracts/src/kosmora-protocol.ts";
import type { ContextWindowXRayReport } from "../../../../packages/core/src/kosmora-intelligence-graph.ts";

export interface KosmoraWorkspaceViewModel {
  workspace: CanvasWorkspaceState;
  active_artifact: RuntimeArtifact | null;
  context_xray: ContextWindowXRayReport;
  command_palette_open: boolean;
  provenance_inspector_open: boolean;
  graph_navigator_mode: "2d" | "3d";
}

export function buildKosmoraWorkspaceViewModel(params: {
  workspace: CanvasWorkspaceState;
  active_artifact: RuntimeArtifact | null;
  context_xray: ContextWindowXRayReport;
  command_palette_open?: boolean;
  provenance_inspector_open?: boolean;
  graph_navigator_mode?: "2d" | "3d";
}): KosmoraWorkspaceViewModel {
  return {
    workspace: params.workspace,
    active_artifact: params.active_artifact,
    context_xray: params.context_xray,
    command_palette_open: params.command_palette_open ?? false,
    provenance_inspector_open: params.provenance_inspector_open ?? true,
    graph_navigator_mode: params.graph_navigator_mode ?? "2d",
  };
}

export function renderKosmoraWorkspaceHtmlPreview(vm: KosmoraWorkspaceViewModel): string {
  const activeTab = vm.workspace.tabs.find((t) => t.tab_id === vm.workspace.active_tab_id);
  const badgeLabel =
    activeTab?.verification_badge === "critic_approved"
      ? "Проверено Критиком (Approved)"
      : activeTab?.verification_badge === "manual_edit"
        ? "Ручная правка пользователя"
        : "Требует ревью";

  return [
    `<section class="kosmora-dual-pane" data-theme="${vm.workspace.theme_preset}">`,
    `  <aside class="kosmora-left-chat" id="${vm.workspace.left_chat_thread_id}">`,
    `    <header>Kosmora Chat & Skills (/skill, @skill) | X-Ray: ${vm.context_xray.utilization_pct}%</header>`,
    `  </aside>`,
    `  <main class="kosmora-right-canvas" data-fullscreen="${vm.workspace.present_mode_fullscreen}">`,
    `    <nav class="canvas-tabs">Tabs: ${vm.workspace.tabs.map((t) => `${t.title} (${t.current_version})`).join(" | ")}</nav>`,
    `    <div class="critic-badge">${badgeLabel}</div>`,
    `    <article class="canvas-editor">${activeTab?.versions[activeTab.versions.length - 1]?.content ?? ""}</article>`,
    `  </main>`,
    `  ${
      vm.provenance_inspector_open && vm.active_artifact
        ? `<aside class="provenance-inspector">Provenance Task: ${vm.active_artifact.task_id} | Route: ${vm.active_artifact.provenance.model_route_id}</aside>`
        : ""
    }`,
    `</section>`,
  ].join("\n");
}
