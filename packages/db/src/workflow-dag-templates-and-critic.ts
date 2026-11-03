import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  PortableWorkflowDefinitionPackage,
  PortableWorkflowNode
} from "./workflow-portability-and-zip-exporter.ts";

export interface CriticEvaluationResult {
  passed: boolean;
  missingRequirements: string[];
  missingExpectedResults: string[];
  emptyStepOutputs: string[];
  score: number;
  summaryRu: string;
}

export interface TopologicalWavePlan {
  waves: string[][];
  orderedNodeIds: string[];
}

/**
 * Returns the 3 canonical initial Koswork scenario templates defined in PR #428
 * (`docs/handoff/KOSWORK_REUSABLE_WORKFLOWS_2026-11-02_RU.md`):
 * 1. Отчёт по документу (`document_report`)
 * 2. Текст в рабочие материалы (`text_to_materials`)
 * 3. Анализ источника с итоговой запиской (`source_analysis_summary`)
 */
export function getInitialKosworkScenarioTemplates(): Record<
  "document_report" | "text_to_materials" | "source_analysis_summary",
  PortableWorkflowDefinitionPackage
> {
  return {
    document_report: {
      schemaVersion: "koswork-workflow-portable-v1",
      name: "Отчёт по документу",
      description: "Анализирует выбранный документ проекта, выделяет ключевые факты и формирует проверенный отчёт.",
      parameters: [
        {
          name: "sourceDoc",
          description: "Документ текущего проекта",
          type: "project_document",
          required: true
        },
        {
          name: "focusQuestion",
          description: "Целевой вопрос или фокус отчёта",
          type: "text",
          required: true
        },
        {
          name: "detailLevel",
          description: "Уровень детализации",
          type: "select",
          required: true,
          defaultValue: "standard",
          options: ["concise", "standard", "detailed"]
        }
      ],
      nodes: [
        {
          id: "extract-facts",
          title: "Извлечение проверяемых фактов из документа",
          kind: "work_prompt",
          promptTemplate:
            "Прочитай документ {{sourceDoc}} и выдели точные факты и цитаты по вопросу: {{focusQuestion}}."
        },
        {
          id: "draft-report",
          title: "Составление структурированного отчёта",
          kind: "work_prompt",
          dependsOn: ["extract-facts"],
          promptTemplate:
            "Сформируй отчёт (уровень детализации: {{detailLevel}}) по вопросу {{focusQuestion}} с привязкой к документу {{sourceDoc}}."
        },
        {
          id: "critic-check",
          title: "Проверка Критиком полноты и цитат",
          kind: "critic_review",
          dependsOn: ["draft-report"],
          promptTemplate:
            "Проверь отсутствие вымышленных данных и соответствие отчёта исходному документу {{sourceDoc}}."
        }
      ],
      requirements: ["document_reader", "text_writer", "critic_verifier"],
      expected_results: ["report.md", "citations-summary.json"]
    },
    text_to_materials: {
      schemaVersion: "koswork-workflow-portable-v1",
      name: "Текст в рабочие материалы",
      description: "Преобразует входной текст и параметры в структурированный рабочий материал проекта.",
      parameters: [
        {
          name: "rawInputText",
          description: "Исходный текст или заметки",
          type: "text",
          required: true
        },
        {
          name: "includeActionItems",
          description: "Выделить список задач",
          type: "boolean",
          required: false,
          defaultValue: true
        }
      ],
      nodes: [
        {
          id: "structure-material",
          title: "Структурирование рабочего материала",
          kind: "work_prompt",
          promptTemplate:
            "Преобразуй входной текст в рабочий материал проекта (задачи: {{includeActionItems}}): {{rawInputText}}"
        },
        {
          id: "critic-material",
          title: "Проверка структуры материала",
          kind: "critic_review",
          dependsOn: ["structure-material"],
          promptTemplate: "Убедись, что все численные и датовые условия из входного текста сохранены."
        }
      ],
      requirements: ["text_writer", "critic_verifier"],
      expected_results: ["working-material.md"]
    },
    source_analysis_summary: {
      schemaVersion: "koswork-workflow-portable-v1",
      name: "Анализ источника с итоговой запиской",
      description: "Разбирает справочную ссылку и документ проекта, формируя итоговую аналитическую записку.",
      parameters: [
        {
          name: "referenceUrl",
          description: "Справочная ссылка на источник",
          type: "url",
          required: true
        },
        {
          name: "maxSections",
          description: "Максимальное число разделов записки",
          type: "number",
          required: false,
          defaultValue: 4
        }
      ],
      nodes: [
        {
          id: "analyze-source",
          title: "Разбор источника и контекста",
          kind: "work_prompt",
          promptTemplate:
            "Проанализируй справочный источник {{referenceUrl}} и выдели до {{maxSections}} ключевых разделов."
        },
        {
          id: "write-memo",
          title: "Подготовка итоговой записки",
          kind: "work_prompt",
          dependsOn: ["analyze-source"],
          promptTemplate:
            "Напиши итоговую аналитическую записку (не более {{maxSections}} разделов) со ссылкой {{referenceUrl}}."
        },
        {
          id: "critic-memo",
          title: "Проверка Критиком итоговой записки",
          kind: "critic_review",
          dependsOn: ["write-memo"],
          promptTemplate: "Проверь наличие ссылки {{referenceUrl}} и соблюдение лимита разделов ({{maxSections}})."
        }
      ],
      requirements: ["source_citation_checker", "text_writer", "critic_verifier"],
      expected_results: ["summary-memo.md"]
    }
  };
}

/**
 * Validates that workflow nodes form a valid DAG without missing dependencies or cycles,
 * and returns deterministic topological execution waves.
 */
export function validateAndBuildTopologicalWaves(nodes: PortableWorkflowNode[]): TopologicalWavePlan {
  if (nodes.length === 0 || nodes.length > 32) {
    throw new Error("WORKFLOW_DAG_INVALID_NODE_COUNT");
  }

  const nodeMap = new Map<string, PortableWorkflowNode>();
  for (const n of nodes) {
    if (!n.id || nodeMap.has(n.id)) {
      throw new Error(`WORKFLOW_DAG_DUPLICATE_OR_EMPTY_ID:${n.id}`);
    }
    nodeMap.set(n.id, n);
  }

  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const n of nodes) {
    inDegree.set(n.id, 0);
    dependents.set(n.id, []);
  }

  for (const n of nodes) {
    const deps = n.dependsOn ?? [];
    const uniqueDeps = new Set(deps);
    for (const depId of uniqueDeps) {
      if (!nodeMap.has(depId)) {
        throw new Error(`WORKFLOW_DAG_UNKNOWN_DEPENDENCY:${n.id}->${depId}`);
      }
      if (depId === n.id) {
        throw new Error(`WORKFLOW_DAG_CYCLE_DETECTED:${n.id}`);
      }
      inDegree.set(n.id, (inDegree.get(n.id) ?? 0) + 1);
      dependents.get(depId)!.push(n.id);
    }
  }

  const waves: string[][] = [];
  const orderedNodeIds: string[] = [];
  let currentWave = nodes.filter((n) => (inDegree.get(n.id) ?? 0) === 0).map((n) => n.id);

  while (currentWave.length > 0) {
    waves.push(currentWave);
    const nextWave: string[] = [];
    for (const u of currentWave) {
      orderedNodeIds.push(u);
      for (const v of dependents.get(u) ?? []) {
        const nextDeg = (inDegree.get(v) ?? 1) - 1;
        inDegree.set(v, nextDeg);
        if (nextDeg === 0) {
          nextWave.push(v);
        }
      }
    }
    currentWave = nextWave;
  }

  if (orderedNodeIds.length !== nodes.length) {
    throw new Error("WORKFLOW_DAG_CYCLE_DETECTED");
  }

  return { waves, orderedNodeIds };
}

/**
 * Reorders workflow steps according to `desiredOrderIds` while verifying that
 * no step appears before any of its `dependsOn` prerequisites.
 */
export function reorderWorkflowStepsSafely(
  nodes: PortableWorkflowNode[],
  desiredOrderIds: string[]
): PortableWorkflowNode[] {
  validateAndBuildTopologicalWaves(nodes);
  if (desiredOrderIds.length !== nodes.length) {
    throw new Error("WORKFLOW_REORDER_LENGTH_MISMATCH");
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const reordered: PortableWorkflowNode[] = [];
  const seen = new Set<string>();

  for (const id of desiredOrderIds) {
    const node = byId.get(id);
    if (!node || seen.has(id)) {
      throw new Error(`WORKFLOW_REORDER_INVALID_ID:${id}`);
    }
    for (const dep of node.dependsOn ?? []) {
      if (!seen.has(dep)) {
        throw new Error(`WORKFLOW_REORDER_VIOLATES_DEPENDENCY:${id}_BEFORE_${dep}`);
      }
    }
    seen.add(id);
    reordered.push(node);
  }

  return reordered;
}

/**
 * Built-in Critic step evaluator for Koswork workflows: verifies that all non-critic steps
 * produced non-empty output, all `expected_results` artifacts are present, and required
 * source references/numbers were preserved.
 */
export function evaluateWorkflowCriticCheck(options: {
  definition: PortableWorkflowDefinitionPackage;
  stepOutputs: Record<string, string>;
  producedArtifacts: Record<string, string>;
  mandatoryTokensToPreserve?: string[];
}): CriticEvaluationResult {
  const emptyStepOutputs: string[] = [];
  for (const node of options.definition.nodes) {
    if (node.kind === "critic_review") continue;
    const out = (options.stepOutputs[node.id] ?? "").trim();
    if (!out) {
      emptyStepOutputs.push(node.id);
    }
  }

  const missingExpectedResults: string[] = [];
  for (const expectedName of options.definition.expected_results) {
    const body = (options.producedArtifacts[expectedName] ?? "").trim();
    if (!body) {
      missingExpectedResults.push(expectedName);
    }
  }

  const combinedOutput = [
    ...Object.values(options.stepOutputs),
    ...Object.values(options.producedArtifacts)
  ]
    .join("\n")
    .normalize("NFKC")
    .toLowerCase();

  const missingRequirements: string[] = [];
  for (const token of options.mandatoryTokensToPreserve ?? []) {
    if (!combinedOutput.includes(token.normalize("NFKC").toLowerCase())) {
      missingRequirements.push(token);
    }
  }

  const totalChecks =
    options.definition.nodes.length +
    options.definition.expected_results.length +
    (options.mandatoryTokensToPreserve?.length ?? 0);
  const failedChecks =
    emptyStepOutputs.length + missingExpectedResults.length + missingRequirements.length;
  const score =
    totalChecks > 0 ? Number(Math.max(0, (totalChecks - failedChecks) / totalChecks).toFixed(4)) : 1;
  const passed = failedChecks === 0;

  return {
    passed,
    missingRequirements,
    missingExpectedResults,
    emptyStepOutputs,
    score,
    summaryRu: passed
      ? "Проверка Критика пройдена: все шаги, ожидаемые файлы и обязательные ссылки присутствуют."
      : `Проверка Критика выявила пропуски (пустых шагов: ${emptyStepOutputs.length}, отсутствующих файлов: ${missingExpectedResults.length}, потерянных условий: ${missingRequirements.length}).`
  };
}

/**
 * Manages versioned workflow mutations (`expected_version` optimistic locking, SQL-enforced
 * version immutability, archive/restore, copy, and privacy export/delete) on `0062_reusable_workflows.sql`.
 */
export class WorkflowLifecycleAndPrivacyManager {
  constructor(private readonly sqlite: DatabaseSync) {
    this.ensureSchema();
  }

  ensureSchema(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS kosmora_workflow_definitions (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        state_json TEXT NOT NULL,
        archived_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        client_creation_id TEXT,
        creation_json TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS kosmora_workflow_def_client_idx
        ON kosmora_workflow_definitions(owner_id, project_id, client_creation_id)
        WHERE client_creation_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS kosmora_workflow_versions (
        workflow_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        definition_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (workflow_id, version)
      );

      CREATE TRIGGER IF NOT EXISTS workflow_version_immutable
      BEFORE UPDATE ON kosmora_workflow_versions
      BEGIN
        SELECT RAISE(ABORT, 'WORKFLOW_VERSION_IMMUTABLE');
      END;
    `);
  }

  createIdempotent(options: {
    ownerId: string;
    projectId: string;
    clientCreationId: string;
    definition: PortableWorkflowDefinitionPackage;
  }): { workflowId: string; version: number; deduplicated: boolean } {
    validateAndBuildTopologicalWaves(options.definition.nodes);

    const existing = this.sqlite
      .prepare(
        "SELECT id, version, creation_json FROM kosmora_workflow_definitions WHERE owner_id = ? AND project_id = ? AND client_creation_id = ?"
      )
      .get(options.ownerId, options.projectId, options.clientCreationId) as
      | { id: string; version: number; creation_json: string }
      | undefined;

    const defJson = JSON.stringify(options.definition);
    if (existing) {
      if (existing.creation_json !== defJson) {
        throw new Error("WORKFLOW_CREATION_ID_PAYLOAD_MISMATCH");
      }
      return { workflowId: existing.id, version: existing.version, deduplicated: true };
    }

    const workflowId = `wf-${randomUUID()}`;
    const now = new Date().toISOString();

    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      this.sqlite
        .prepare(
          `INSERT INTO kosmora_workflow_definitions (
            id, project_id, owner_id, version, state_json, archived_at,
            created_at, updated_at, client_creation_id, creation_json
          ) VALUES (?, ?, ?, 1, ?, NULL, ?, ?, ?, ?)`
        )
        .run(
          workflowId,
          options.projectId,
          options.ownerId,
          defJson,
          now,
          now,
          options.clientCreationId,
          defJson
        );

      this.sqlite
        .prepare(
          "INSERT INTO kosmora_workflow_versions (workflow_id, version, definition_json, created_at) VALUES (?, 1, ?, ?)"
        )
        .run(workflowId, defJson, now);

      this.sqlite.exec("COMMIT");
    } catch (err) {
      try {
        this.sqlite.exec("ROLLBACK");
      } catch {
        // ignore
      }
      throw err;
    }

    return { workflowId, version: 1, deduplicated: false };
  }

  updateWithExpectedVersion(options: {
    ownerId: string;
    projectId: string;
    workflowId: string;
    expectedVersion: number;
    definition: PortableWorkflowDefinitionPackage;
  }): { workflowId: string; version: number } {
    validateAndBuildTopologicalWaves(options.definition.nodes);

    const row = this.sqlite
      .prepare(
        "SELECT version, archived_at FROM kosmora_workflow_definitions WHERE id = ? AND owner_id = ? AND project_id = ?"
      )
      .get(options.workflowId, options.ownerId, options.projectId) as
      | { version: number; archived_at: string | null }
      | undefined;

    if (!row) {
      throw new Error("WORKFLOW_NOT_FOUND");
    }
    if (row.archived_at) {
      throw new Error("WORKFLOW_ARCHIVED_CANNOT_EDIT");
    }
    if (row.version !== options.expectedVersion) {
      throw new Error(`WORKFLOW_VERSION_CONFLICT:expected_${options.expectedVersion}_actual_${row.version}`);
    }
    if (row.version >= 200) {
      throw new Error("WORKFLOW_MAX_200_VERSIONS_REACHED");
    }

    const nextVer = row.version + 1;
    const defJson = JSON.stringify(options.definition);
    const now = new Date().toISOString();

    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      this.sqlite
        .prepare(
          "UPDATE kosmora_workflow_definitions SET version = ?, state_json = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND version = ?"
        )
        .run(nextVer, defJson, now, options.workflowId, options.ownerId, options.expectedVersion);

      this.sqlite
        .prepare(
          "INSERT INTO kosmora_workflow_versions (workflow_id, version, definition_json, created_at) VALUES (?, ?, ?, ?)"
        )
        .run(options.workflowId, nextVer, defJson, now);

      this.sqlite.exec("COMMIT");
    } catch (err) {
      try {
        this.sqlite.exec("ROLLBACK");
      } catch {
        // ignore
      }
      throw err;
    }

    return { workflowId: options.workflowId, version: nextVer };
  }

  exportOwnerPrivacyData(ownerId: string): {
    definitionsCount: number;
    versionsCount: number;
    digestSha256: string;
  } {
    const defs = this.sqlite
      .prepare("SELECT * FROM kosmora_workflow_definitions WHERE owner_id = ? ORDER BY id ASC")
      .all(ownerId) as Array<{ id: string }>;

    let versionsCount = 0;
    for (const d of defs) {
      const vCnt = this.sqlite
        .prepare("SELECT COUNT(*) AS cnt FROM kosmora_workflow_versions WHERE workflow_id = ?")
        .get(d.id) as { cnt: number };
      versionsCount += vCnt.cnt;
    }

    return {
      definitionsCount: defs.length,
      versionsCount,
      digestSha256: createHash("sha256").update(JSON.stringify(defs), "utf8").digest("hex")
    };
  }

  deleteOwnerPrivacyData(ownerId: string): { deletedDefinitions: number } {
    const defs = this.sqlite
      .prepare("SELECT id FROM kosmora_workflow_definitions WHERE owner_id = ?")
      .all(ownerId) as Array<{ id: string }>;

    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      for (const d of defs) {
        this.sqlite
          .prepare("DELETE FROM kosmora_workflow_versions WHERE workflow_id = ?")
          .run(d.id);
      }
      const res = this.sqlite
        .prepare("DELETE FROM kosmora_workflow_definitions WHERE owner_id = ?")
        .run(ownerId);
      this.sqlite.exec("COMMIT");
      return { deletedDefinitions: res.changes };
    } catch (err) {
      try {
        this.sqlite.exec("ROLLBACK");
      } catch {
        // ignore
      }
      throw err;
    }
  }
}
