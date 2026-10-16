import { createHash } from "node:crypto";
import type { WorkArtifactVersion, WorkDag, WorkDagNode } from "@cosmora/contracts";
import { WorkDagConflict } from "@cosmora/db";
import { createArchive } from "./account-settings/privacy/archive.js";

type File = WorkArtifactVersion & {
  node_id: string;
  title: string;
  content: string;
  review: NonNullable<WorkDagNode["result"]>["review"];
  sources: NonNullable<WorkDagNode["result"]>["sources"];
};
const maxArchiveBytes = 4_000_000;
const statusLabels: Record<WorkDagNode["status"], string> = {
  pending: "Готов к запуску",
  blocked: "Заблокирован",
  running: "Выполняется",
  completed: "Завершён",
  failed: "Ошибка",
  cancelled: "Отменён"
};
const markdown = (value: string) =>
  value.replace(/[\r\n]/g, " ").replace(/[\\`*_{}[\]<>()#+\-.!|]/g, "\\$&");

/** Deterministic, inert ZIP download from one reconciled graph; no model or filesystem writes. */
export function buildWorkResultsArchive(graph: WorkDag, files: File[]): Buffer {
  const entries: { path: string; bytes: Buffer }[] = [];
  const manifestFiles = files.map((file, index) => {
    const nodeIndex = graph.nodes.findIndex((node) => node.id === file.node_id);
    if (
      nodeIndex < 0 ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]*\.(md|txt|json|html|css|js|ts|py|csv)$/.test(file.name) ||
      file.name.length > 100
    )
      throw new WorkDagConflict("RESULTS_INVALID_ARTIFACT");
    const node = graph.nodes[nodeIndex]!;
    const declared = node.artifacts.find((artifact) => artifact.id === file.id);
    const bytes = Buffer.from(file.content, "utf8");
    if (
      node.status !== "completed" ||
      !declared ||
      !file.published ||
      file.project_id !== graph.project_id ||
      declared.work_id !== file.work_id ||
      declared.version !== file.version ||
      declared.name !== file.name ||
      declared.sha256 !== file.sha256 ||
      declared.bytes !== file.bytes ||
      bytes.length !== file.bytes ||
      createHash("sha256").update(bytes).digest("hex") !== file.sha256
    )
      throw new WorkDagConflict("DEPENDENCY_ARTIFACT_MISSING");
    // Numeric folders/prefixes isolate duplicate names and exclude untrusted IDs/titles from paths.
    const path = `steps/${String(nodeIndex + 1).padStart(2, "0")}/${String(index + 1).padStart(3, "0")}-${file.name}`;
    entries.push({ path, bytes });
    return {
      path,
      node_id: file.node_id,
      title: file.title,
      artifact_id: file.id,
      work_id: file.work_id,
      original_name: file.name,
      version: file.version,
      sha256: file.sha256,
      bytes: file.bytes,
      review: file.review,
      sources: file.sources
    };
  });
  const completed = graph.nodes.filter((node) => node.status === "completed").length;
  const manifest = {
    format: "kosmora.work-results.v1",
    graph_id: graph.id,
    graph_version: graph.version,
    title: graph.title,
    updated_at: graph.updated_at,
    archived: Boolean(graph.archived_at),
    complete: completed === graph.nodes.length,
    completed_steps: completed,
    total_steps: graph.nodes.length,
    steps: graph.nodes.map((node) => ({
      id: node.id,
      title: node.title,
      status: node.status,
      blocked_reason: node.blocked_reason,
      files: manifestFiles.filter((file) => file.node_id === node.id).map((file) => file.path)
    })),
    files: manifestFiles
  };
  const report = [
    "# Результаты плана",
    "",
    markdown(graph.title),
    "",
    `Завершено шагов: ${completed} из ${graph.nodes.length}.`,
    manifest.complete
      ? "Все шаги завершены."
      : "Это частичный результат: незавершённые шаги перечислены ниже.",
    "",
    "В архив включены только опубликованные файлы завершённых шагов.",
    "Контрольные суммы SHA-256, версии, источники модели и решения Критика сохранены в manifest.json.",
    "Тексты личных Skills, разрешения и неопубликованные черновики в этот пакет не включены.",
    "",
    "| Шаг | Состояние | Файлы |",
    "| --- | --- | --- |",
    ...graph.nodes.map((node, index) => {
      const links =
        manifestFiles
          .filter((file) => file.node_id === node.id)
          .map((file) => `[${markdown(file.original_name)}](${file.path})`)
          .join(", ") || "—";
      return `| ${index + 1}. ${markdown(node.title)} | ${statusLabels[node.status]} | ${links} |`;
    }),
    ""
  ].join("\n");
  entries.unshift(
    { path: "README.md", bytes: Buffer.from(report) },
    {
      path: "manifest.json",
      bytes: Buffer.from(JSON.stringify(manifest, null, 2) + "\n")
    }
  );
  try {
    return createArchive(entries, maxArchiveBytes);
  } catch (error) {
    if (error instanceof Error && error.message === "PRIVACY_ARCHIVE_OVERLIMIT")
      throw new WorkDagConflict("RESULTS_LIMIT");
    throw error;
  }
}
