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
  integrity?: {
    published: boolean;
    readback: string;
    sha256: string;
    bytes: number;
    owner_id?: string;
    project_id: string;
    work_id: string;
    attempt?: number;
    version: number;
  };
  verification?: {
    file_created: boolean;
    file_bytes: string;
    content_review: string;
    code_executed: boolean;
    owner_accepted: boolean;
  };
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
const assertOptionalIntegrity = (
  integrity: File["integrity"],
  graph: WorkDag,
  file: File,
  digest: string,
  byteLength: number,
  attempt: number | undefined
) => {
  if (!integrity) return;
  if (
    integrity.published !== true ||
    integrity.readback !== "sha256_and_bytes_match" ||
    integrity.sha256 !== digest ||
    integrity.bytes !== byteLength ||
    (integrity.owner_id !== undefined && integrity.owner_id !== graph.owner_id) ||
    integrity.project_id !== graph.project_id ||
    integrity.work_id !== file.work_id ||
    (integrity.attempt !== undefined && integrity.attempt !== attempt) ||
    integrity.version !== file.version
  )
    throw new WorkDagConflict("DEPENDENCY_ARTIFACT_MISSING");
};
const assertOptionalVerification = (verification: File["verification"]) => {
  if (!verification) return;
  if (
    verification.file_created !== true ||
    verification.file_bytes !== "verified" ||
    verification.code_executed !== false ||
    verification.owner_accepted !== false
  )
    throw new WorkDagConflict("DEPENDENCY_ARTIFACT_MISSING");
};

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
    const digest = createHash("sha256").update(bytes).digest("hex");
    const attempt = node.attempts.find((a) => a.work_id === file.work_id)?.number;
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
      digest !== file.sha256 ||
      digest !== declared.sha256
    )
      throw new WorkDagConflict("DEPENDENCY_ARTIFACT_MISSING");
    // Optional assertions from newer callers are checked, never required. Legacy
    // valid exports intentionally have no attempts or decorative status objects.
    assertOptionalIntegrity(file.integrity, graph, file, digest, bytes.length, attempt);
    assertOptionalVerification(file.verification);
    // Numeric folders/prefixes isolate duplicate names and exclude untrusted IDs/titles from paths.
    const path = `steps/${String(nodeIndex + 1).padStart(2, "0")}/${String(index + 1).padStart(3, "0")}-${file.name}`;
    entries.push({ path, bytes });
    const publicIntegrity = {
      published: true,
      readback: "sha256_and_bytes_match",
      sha256: digest,
      bytes: bytes.length,
      project_id: graph.project_id,
      work_id: file.work_id,
      version: file.version,
      ...(attempt === undefined ? {} : { attempt })
    };
    const publicVerification = {
      file_created: true,
      file_bytes: "verified",
      content_review: file.review?.verdict === "PASS" ? "model_critic_pass" : "not_passed",
      code_executed: false,
      owner_accepted: false
    };
    return {
      path,
      node_id: file.node_id,
      title: file.title,
      artifact_id: file.id,
      work_id: file.work_id,
      original_name: file.name,
      version: file.version,
      sha256: digest,
      bytes: bytes.length,
      review: file.review,
      sources: file.sources,
      integrity: publicIntegrity,
      verification: publicVerification
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
    verification_legend: {
      file_created: "Published immutable artifact record exists and was read back.",
      file_bytes: "SHA-256 and byte length match the published version.",
      content_review:
        "Model/Critic verdict; not byte validation, code execution or owner acceptance.",
      code_executed: "No code from these artifacts is executed by this archive.",
      owner_accepted: "Owner has not accepted these server results through this archive."
    },
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
    "SHA-256, длина в байтах, версия, проект, работа и попытка повторно сверены в manifest.json.",
    "Решение Критика — оценка содержания моделью, а не проверка байтов, запуск кода или подтверждение владельца.",
    "Архив не выполняет код из файлов и не подтверждает физическое действие.",
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
