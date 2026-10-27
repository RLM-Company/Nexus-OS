/**
 * Kosmora Playbooks — Versioned Multi-Agent Mission Templates, Safe Template Engine,
 * Declarative Condition Evaluator, SHA-256 Immutability Verification, Version Diff,
 * and Atomic Mission Control Instantiation Service.
 */

import { createHash } from "node:crypto";
import {
  BUILT_IN_KOSMORA_PLAYBOOKS,
  PLAYBOOK_STATUSES,
  PLAYBOOK_VARIABLE_TYPES,
  PLAYBOOK_VISIBILITIES,
  type Playbook,
  type PlaybookAuditEvent,
  type PlaybookAuditEventType,
  type PlaybookDefinition,
  type PlaybookDiffResult,
  type PlaybookInstantiation,
  type PlaybookPreviewExcludedTask,
  type PlaybookPreviewResult,
  type PlaybookPreviewTaskNode,
  type PlaybookStatus,
  type PlaybookTaskDiffEntry,
  type PlaybookTaskPriority,
  type PlaybookTaskTemplate,
  type PlaybookVariable,
  type PlaybookVariableDiffEntry,
  type PlaybookVariableType,
  type PlaybookVersion,
  type PlaybookVisibility
} from "../../contracts/src/kosmora-playbooks.js";
import {
  KosmoraEnterpriseSecurityEngine,
  type TenantPrincipal
} from "./kosmora-enterprise-security.js";
import {
  KOSMORA_MISSION_AGENT_CATALOG,
  KosmoraMissionControlService,
  type Mission,
  type MissionAgentRole,
  type MissionDetailsSnapshot,
  type MissionPriority,
  type MissionTask,
  type MissionTaskExecutionMode
} from "./kosmora-mission-control.js";
import {
  KosmoraRuntimeStore,
  type StoredPlaybookAuditEventRow,
  type StoredPlaybookInstantiationRow,
  type StoredPlaybookRow,
  type StoredPlaybookVersionRow
} from "./kosmora-runtime-store.js";

export {
  BUILT_IN_KOSMORA_PLAYBOOKS,
  PLAYBOOK_STATUSES,
  PLAYBOOK_VARIABLE_TYPES,
  PLAYBOOK_VISIBILITIES
};

export type {
  Playbook,
  PlaybookAuditEvent,
  PlaybookAuditEventType,
  PlaybookDefinition,
  PlaybookDiffResult,
  PlaybookInstantiation,
  PlaybookPreviewExcludedTask,
  PlaybookPreviewResult,
  PlaybookPreviewTaskNode,
  PlaybookStatus,
  PlaybookTaskDiffEntry,
  PlaybookTaskPriority,
  PlaybookTaskTemplate,
  PlaybookVariable,
  PlaybookVariableDiffEntry,
  PlaybookVariableType,
  PlaybookVersion,
  PlaybookVisibility
};

export class PlaybookNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlaybookNotFoundError";
  }
}

export class PlaybookAccessDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlaybookAccessDeniedError";
  }
}

export class PlaybookValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlaybookValidationError";
  }
}

export class PlaybookVariableValidationError extends PlaybookValidationError {
  public readonly variable_key: string;
  constructor(variableKey: string, message: string) {
    super(message);
    this.name = "PlaybookVariableValidationError";
    this.variable_key = variableKey;
  }
}

export class PlaybookConditionSyntaxError extends PlaybookValidationError {
  constructor(expression: string, reason: string) {
    super(`Invalid condition expression '${expression}': ${reason}`);
    this.name = "PlaybookConditionSyntaxError";
  }
}

export class PlaybookImmutableVersionError extends Error {
  constructor(playbookId: string, versionNumber: number | string) {
    super(
      `Published playbook version '${versionNumber}' of playbook '${playbookId}' is immutable and cannot be modified.`
    );
    this.name = "PlaybookImmutableVersionError";
  }
}

export class PlaybookChecksumMismatchError extends Error {
  public readonly playbook_id: string;
  public readonly version_number: number;
  public readonly expected_checksum: string;
  public readonly actual_checksum: string;

  constructor(
    playbookId: string,
    versionNumber: number,
    expectedChecksum: string,
    actualChecksum: string
  ) {
    super(
      `SHA-256 checksum mismatch for playbook '${playbookId}' v${versionNumber}: expected ${expectedChecksum}, computed ${actualChecksum}.`
    );
    this.name = "PlaybookChecksumMismatchError";
    this.playbook_id = playbookId;
    this.version_number = versionNumber;
    this.expected_checksum = expectedChecksum;
    this.actual_checksum = actualChecksum;
  }
}

export class PlaybookVersionConflictError extends Error {
  public readonly playbook_id: string;
  public readonly expected_version: number;
  public readonly actual_version: number;

  constructor(
    playbookId: string,
    expectedVersion: number,
    actualVersion: number
  ) {
    super(
      `Optimistic concurrency conflict on playbook '${playbookId}': expected draft_version_lock ${expectedVersion}, actual ${actualVersion}.`
    );
    this.name = "PlaybookVersionConflictError";
    this.playbook_id = playbookId;
    this.expected_version = expectedVersion;
    this.actual_version = actualVersion;
  }
}

export class PlaybookDependencyCycleError extends PlaybookValidationError {
  constructor(message: string) {
    super(message);
    this.name = "PlaybookDependencyCycleError";
  }
}

export class PlaybookBudgetExceededError extends PlaybookValidationError {
  public readonly planned_budget: number;
  public readonly budget_limit: number;

  constructor(plannedBudget: number, budgetLimit: number) {
    super(
      `Planned playbook mission budget ($${plannedBudget.toFixed(2)}) exceeds allowed budget_limit ($${budgetLimit.toFixed(2)}).`
    );
    this.name = "PlaybookBudgetExceededError";
    this.planned_budget = plannedBudget;
    this.budget_limit = budgetLimit;
  }
}

export const SECRET_REDACTED_PLACEHOLDER = "[REDACTED_SECRET]" as const;

const SAFE_IDENTIFIER_REGEX = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;
const SAFE_CONDITION_REGEX =
  /^\s*(?:\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}|([a-zA-Z][a-zA-Z0-9_]*))\s*(==|!=|>=|<=|>|<)\s*(true|false|-?\d+(?:\.\d+)?|"[^"\r\n]*"|'[^'\r\n]*')\s*$/;

/**
 * Deterministic canonical JSON serializer + SHA-256 calculator for `PlaybookDefinition`.
 */
export function canonicalizePlaybookDefinition(
  definition: PlaybookDefinition
): { json: string; checksum_sha256: string } {
  const normalized: PlaybookDefinition = {
    mission_title_template: String(definition.mission_title_template ?? "").trim(),
    goal_template: String(definition.goal_template ?? "").trim(),
    context_template: String(definition.context_template ?? "").trim(),
    default_priority: definition.default_priority ?? "high",
    default_budget_limit: Number(definition.default_budget_limit ?? 25),
    variables: (definition.variables ?? []).map((v) => ({
      key: String(v.key).trim(),
      label: String(v.label).trim(),
      description: String(v.description ?? "").trim(),
      type: v.type,
      required: Boolean(v.required),
      ...(v.default_value !== undefined ? { default_value: v.default_value } : {}),
      ...(v.validation_rules ? { validation_rules: v.validation_rules } : {}),
      secret: Boolean(v.secret),
      ...(v.options ? { options: v.options } : {})
    })),
    tasks: (definition.tasks ?? []).map((t) => ({
      key: String(t.key).trim(),
      title_template: String(t.title_template).trim(),
      instruction_template: String(t.instruction_template).trim(),
      assigned_agent_role: t.assigned_agent_role,
      execution_mode: t.execution_mode ?? "autonomous",
      requested_tools: [...(t.requested_tools ?? [])],
      priority: t.priority ?? "medium",
      dependencies: [...(t.dependencies ?? [])],
      budget_limit: Number(t.budget_limit),
      max_attempts: Number(t.max_attempts ?? 3),
      condition_expression:
        t.condition_expression && String(t.condition_expression).trim().length > 0
          ? String(t.condition_expression).trim()
          : null,
      requires_owner_review: Boolean(t.requires_owner_review)
    }))
  };

  const json = JSON.stringify(normalized);
  const checksum = createHash("sha256").update(json).digest("hex");
  return { json, checksum_sha256: checksum };
}

/**
 * Parses and validates a safe declarative condition expression without `eval` or `Function`.
 */
export function parseSafeConditionExpression(expression: string): {
  variableKey: string;
  operator: "==" | "!=" | ">=" | "<=" | ">" | "<";
  literalValue: string | number | boolean;
} {
  const match = expression.match(SAFE_CONDITION_REGEX);
  if (!match) {
    throw new PlaybookConditionSyntaxError(
      expression,
      "Only simple comparisons '{{var}} <op> <literal>' with operators ==, !=, >=, <=, >, < are allowed."
    );
  }
  const variableKey = (match[1] || match[2] || "").trim();
  const operator = match[3] as "==" | "!=" | ">=" | "<=" | ">" | "<";
  const rawLiteral = match[4]!;

  let literalValue: string | number | boolean;
  if (rawLiteral === "true") {
    literalValue = true;
  } else if (rawLiteral === "false") {
    literalValue = false;
  } else if (
    (rawLiteral.startsWith('"') && rawLiteral.endsWith('"')) ||
    (rawLiteral.startsWith("'") && rawLiteral.endsWith("'"))
  ) {
    literalValue = rawLiteral.slice(1, -1);
  } else {
    literalValue = Number(rawLiteral);
  }

  return { variableKey, operator, literalValue };
}

export function evaluateSafeConditionExpression(
  expression: string,
  resolvedVariables: Readonly<Record<string, string | number | boolean>>
): { included: boolean; reason: string } {
  const parsed = parseSafeConditionExpression(expression);
  if (!(parsed.variableKey in resolvedVariables)) {
    throw new PlaybookConditionSyntaxError(
      expression,
      `Referenced variable '${parsed.variableKey}' is not defined in playbook variables.`
    );
  }

  const actual = resolvedVariables[parsed.variableKey];
  const target = parsed.literalValue;
  let passed = false;

  switch (parsed.operator) {
    case "==":
      passed = actual === target || String(actual) === String(target);
      break;
    case "!=":
      passed = actual !== target && String(actual) !== String(target);
      break;
    case ">=":
      passed = Number(actual) >= Number(target);
      break;
    case "<=":
      passed = Number(actual) <= Number(target);
      break;
    case ">":
      passed = Number(actual) > Number(target);
      break;
    case "<":
      passed = Number(actual) < Number(target);
      break;
  }

  return {
    included: passed,
    reason: passed
      ? `Условие выполнено: ${expression}`
      : `Задача исключена по условию: ${expression} (текущее значение ${parsed.variableKey} = ${JSON.stringify(actual)})`
  };
}

/**
 * Extracts all `{{variable_key}}` placeholders from a template string.
 * Rejects malformed `{{ ... }}` tokens (such as attempts at JS expressions inside braces).
 */
export function extractTemplatePlaceholders(template: string): string[] {
  const keys: string[] = [];
  const rawBraces = template.match(/\{\{([^}]*)\}\}/g) ?? [];
  for (const token of rawBraces) {
    const inner = token.slice(2, -2).trim();
    if (!SAFE_IDENTIFIER_REGEX.test(inner)) {
      throw new PlaybookValidationError(
        `Unsafe or invalid template placeholder '${token}'. Only '{{variable_key}}' identifiers are permitted.`
      );
    }
    keys.push(inner);
  }
  return keys;
}

/**
 * Safe text-only template interpolation (`{{key}}`). Never evaluates code or shell commands.
 * Secret variables are replaced with `[REDACTED_SECRET]` in rendered mission/task text.
 */
export function interpolateSafeTemplate(
  template: string,
  resolvedVariables: Readonly<Record<string, string | number | boolean>>,
  declaredVariablesMap: ReadonlyMap<string, PlaybookVariable>
): string {
  const placeholders = extractTemplatePlaceholders(template);
  for (const key of placeholders) {
    if (!declaredVariablesMap.has(key)) {
      throw new PlaybookVariableValidationError(
        key,
        `Template references unknown variable '{{${key}}}' which is not declared in playbook variables.`
      );
    }
  }

  return template.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g, (_, key: string) => {
    const decl = declaredVariablesMap.get(key);
    if (!decl) {
      throw new PlaybookVariableValidationError(
        key,
        `Unknown template variable '{{${key}}}'.`
      );
    }
    if (decl.secret) {
      return SECRET_REDACTED_PLACEHOLDER;
    }
    const val = resolvedVariables[key];
    return val === undefined || val === null ? "" : String(val);
  });
}

export interface PlaybookInstantiationCompleteResult {
  instantiation: PlaybookInstantiation;
  preview: PlaybookPreviewResult;
  mission: Mission;
  tasks: MissionTask[];
  mission_url: string;
}

export class KosmoraPlaybooksService {
  private idCounter = 0;

  constructor(
    private readonly store: KosmoraRuntimeStore,
    private readonly security: KosmoraEnterpriseSecurityEngine,
    private readonly missionControl: KosmoraMissionControlService
  ) {
    this.store.ensurePlaybooksSchema();
    this.seedBuiltInPlaybooks();
  }

  private nextId(prefix: string): string {
    this.idCounter += 1;
    const entropy = createHash("sha256")
      .update(`${prefix}:${Date.now()}:${this.idCounter}:${Math.random()}`)
      .digest("hex")
      .slice(0, 10);
    return `${prefix}_${entropy}`;
  }

  /**
   * Idempotently seeds the 5 built-in playbooks and their published v1 versions.
   */
  public seedBuiltInPlaybooks(): void {
    this.store.ensurePlaybooksSchema();
    const nowIso = "2026-10-26T00:00:00.000Z";

    for (const seed of BUILT_IN_KOSMORA_PLAYBOOKS) {
      const existing = this.store.getPlaybookRowById(seed.id);
      const { json, checksum_sha256 } = canonicalizePlaybookDefinition(
        seed.definition
      );

      if (!existing) {
        const playbookRow: StoredPlaybookRow = {
          id: seed.id,
          tenant_id: "global_built_in",
          project_id: null,
          owner_id: "system_kosmora",
          slug: seed.slug,
          title: seed.title,
          description: seed.description,
          category: seed.category,
          tags_json: JSON.stringify(seed.tags),
          visibility: "built_in",
          status: "active",
          current_version: 1,
          draft_definition_json: json,
          draft_version_lock: 1,
          created_at: nowIso,
          updated_at: nowIso,
          archived_at: null
        };
        this.store.insertPlaybookRow(playbookRow);
      }

      const existingVer = this.store.getPlaybookVersionRow(seed.id, 1);
      if (!existingVer) {
        const verRow: StoredPlaybookVersionRow = {
          id: `${seed.id}_v1`,
          playbook_id: seed.id,
          version_number: 1,
          changelog: seed.changelog,
          definition_json: json,
          created_by: "system_kosmora",
          created_at: nowIso,
          checksum_sha256,
          is_published: 1
        };
        this.store.insertPlaybookVersionRow(verRow);
      }
    }
  }

  private rowToPlaybook(row: StoredPlaybookRow): Playbook {
    const draftDef = JSON.parse(row.draft_definition_json) as PlaybookDefinition;
    return {
      id: row.id,
      tenant_id: row.tenant_id,
      project_id: row.project_id,
      owner_id: row.owner_id,
      slug: row.slug,
      title: row.title,
      description: row.description,
      category: row.category,
      tags: JSON.parse(row.tags_json || "[]") as string[],
      visibility: row.visibility as PlaybookVisibility,
      status: row.status as PlaybookStatus,
      current_version: Number(row.current_version),
      draft_definition: draftDef,
      draft_version_lock: Number(row.draft_version_lock),
      created_at: row.created_at,
      updated_at: row.updated_at,
      archived_at: row.archived_at
    };
  }

  private rowToPlaybookVersion(row: StoredPlaybookVersionRow): PlaybookVersion {
    const isPublished = Number(row.is_published) === 1;
    if (isPublished) {
      const actualChecksum = createHash("sha256")
        .update(row.definition_json)
        .digest("hex");
      if (actualChecksum !== row.checksum_sha256) {
        throw new PlaybookChecksumMismatchError(
          row.playbook_id,
          Number(row.version_number),
          row.checksum_sha256,
          actualChecksum
        );
      }
    }
    const definition = JSON.parse(row.definition_json) as PlaybookDefinition;
    return {
      id: row.id,
      playbook_id: row.playbook_id,
      version_number: Number(row.version_number),
      changelog: row.changelog,
      definition_json: row.definition_json,
      definition,
      created_by: row.created_by,
      created_at: row.created_at,
      checksum_sha256: row.checksum_sha256,
      is_published: isPublished
    };
  }

  private rowToInstantiation(
    row: StoredPlaybookInstantiationRow
  ): PlaybookInstantiation {
    return {
      id: row.id,
      playbook_id: row.playbook_id,
      playbook_version_id: row.playbook_version_id,
      resulting_mission_id: row.resulting_mission_id,
      owner_id: row.owner_id,
      tenant_id: row.tenant_id,
      project_id: row.project_id,
      resolved_variables_json: row.resolved_variables_json,
      resolved_variables: JSON.parse(row.resolved_variables_json || "{}") as Record<
        string,
        string | number | boolean
      >,
      initiated_at: row.initiated_at,
      created_at: row.created_at
    };
  }

  private rowToAuditEvent(row: StoredPlaybookAuditEventRow): PlaybookAuditEvent {
    return {
      id: row.id,
      tenant_id: row.tenant_id,
      project_id: row.project_id,
      playbook_id: row.playbook_id,
      playbook_version_id: row.playbook_version_id,
      resulting_mission_id: row.resulting_mission_id,
      actor_id: row.actor_id,
      event_type: row.event_type as PlaybookAuditEventType,
      payload: JSON.parse(row.payload_json || "{}") as Record<string, unknown>,
      created_at: row.created_at
    };
  }

  private recordPlaybookAuditEvent(params: {
    tenant_id: string;
    project_id: string | null;
    playbook_id: string;
    playbook_version_id?: string | null;
    resulting_mission_id?: string | null;
    actor_id: string;
    event_type: PlaybookAuditEventType;
    payload: Record<string, unknown>;
  }): PlaybookAuditEvent {
    const nowIso = new Date().toISOString();
    const row: StoredPlaybookAuditEventRow = {
      id: this.nextId("pba"),
      tenant_id: params.tenant_id,
      project_id: params.project_id,
      playbook_id: params.playbook_id,
      playbook_version_id: params.playbook_version_id ?? null,
      resulting_mission_id: params.resulting_mission_id ?? null,
      actor_id: params.actor_id,
      event_type: params.event_type,
      payload_json: JSON.stringify(params.payload),
      created_at: nowIso
    };
    this.store.insertPlaybookAuditEventRow(row);
    this.security.appendAuditEntry(
      params.tenant_id,
      params.actor_id,
      params.event_type,
      params.playbook_id,
      "allow",
      params.payload
    );
    return this.rowToAuditEvent(row);
  }

  private canPrincipalReadPlaybook(
    principal: TenantPrincipal,
    playbook: Playbook,
    requestedProjectId?: string | null
  ): boolean {
    if (playbook.visibility === "built_in") {
      return true;
    }
    if (playbook.tenant_id !== principal.tenant_id) {
      return false;
    }
    if (playbook.visibility === "private") {
      return playbook.owner_id === principal.user_id;
    }
    if (playbook.visibility === "project") {
      if (playbook.owner_id === principal.user_id) {
        return true;
      }
      if (requestedProjectId && playbook.project_id === requestedProjectId) {
        return true;
      }
      return false;
    }
    if (playbook.visibility === "organization") {
      return true;
    }
    return false;
  }

  private assertPrincipalCanReadPlaybook(
    principal: TenantPrincipal,
    playbook: Playbook,
    requestedProjectId?: string | null
  ): void {
    const auth = this.security.authorizeAction(
      principal,
      principal.tenant_id,
      principal.workspace_ids[0] ?? "ws_default",
      "workspace:read"
    );
    if (!auth.allowed) {
      throw new PlaybookAccessDeniedError(auth.reason);
    }
    if (!this.canPrincipalReadPlaybook(principal, playbook, requestedProjectId)) {
      throw new PlaybookAccessDeniedError(
        `Access denied: principal '${principal.user_id}' (tenant '${principal.tenant_id}') cannot access playbook '${playbook.id}' (visibility '${playbook.visibility}').`
      );
    }
  }

  private assertPrincipalCanModifyPlaybook(
    principal: TenantPrincipal,
    playbook: Playbook
  ): void {
    if (playbook.visibility === "built_in") {
      throw new PlaybookAccessDeniedError(
        `Built-in playbook '${playbook.id}' is read-only and cannot be modified or archived.`
      );
    }
    const auth = this.security.authorizeAction(
      principal,
      principal.tenant_id,
      principal.workspace_ids[0] ?? "ws_default",
      "workspace:write"
    );
    if (!auth.allowed) {
      throw new PlaybookAccessDeniedError(auth.reason);
    }
    if (playbook.tenant_id !== principal.tenant_id) {
      throw new PlaybookAccessDeniedError(
        `Cross-tenant modification denied for playbook '${playbook.id}'.`
      );
    }
    if (
      playbook.owner_id !== principal.user_id &&
      principal.role !== "owner" &&
      principal.role !== "admin"
    ) {
      throw new PlaybookAccessDeniedError(
        `User '${principal.user_id}' is not the owner of playbook '${playbook.id}'.`
      );
    }
  }

  /**
   * Validates a `PlaybookDefinition` for variable correctness, template placeholders,
   * condition syntax, agent role tool allowlists, and DAG acyclicity.
   */
  public validatePlaybookDefinition(definition: PlaybookDefinition): void {
    if (!definition || typeof definition !== "object") {
      throw new PlaybookValidationError("Playbook definition is required.");
    }
    if (
      !definition.mission_title_template ||
      definition.mission_title_template.trim().length === 0
    ) {
      throw new PlaybookValidationError(
        "Playbook mission_title_template cannot be empty."
      );
    }
    if (
      !definition.goal_template ||
      definition.goal_template.trim().length === 0
    ) {
      throw new PlaybookValidationError(
        "Playbook goal_template cannot be empty."
      );
    }
    if (!Array.isArray(definition.tasks) || definition.tasks.length === 0) {
      throw new PlaybookValidationError(
        "Playbook definition must contain at least one task template."
      );
    }

    const declaredVariables = new Map<string, PlaybookVariable>();
    for (const v of definition.variables ?? []) {
      if (!SAFE_IDENTIFIER_REGEX.test(v.key)) {
        throw new PlaybookValidationError(
          `Invalid variable key '${v.key}'. Keys must match ${SAFE_IDENTIFIER_REGEX}.`
        );
      }
      if (declaredVariables.has(v.key)) {
        throw new PlaybookValidationError(
          `Duplicate variable key '${v.key}' in playbook definition.`
        );
      }
      if (!PLAYBOOK_VARIABLE_TYPES.includes(v.type)) {
        throw new PlaybookValidationError(
          `Unsupported variable type '${v.type}' on variable '${v.key}'.`
        );
      }
      if (v.type === "select" && (!v.options || v.options.length === 0)) {
        throw new PlaybookValidationError(
          `Select variable '${v.key}' must define at least one option.`
        );
      }
      declaredVariables.set(v.key, v);
    }

    const checkTemplateVars = (tpl: string, contextLabel: string): void => {
      const refs = extractTemplatePlaceholders(tpl);
      for (const ref of refs) {
        if (!declaredVariables.has(ref)) {
          throw new PlaybookVariableValidationError(
            ref,
            `${contextLabel} references undeclared variable '{{${ref}}}'.`
          );
        }
      }
    };

    checkTemplateVars(
      definition.mission_title_template,
      "mission_title_template"
    );
    checkTemplateVars(definition.goal_template, "goal_template");
    if (definition.context_template) {
      checkTemplateVars(definition.context_template, "context_template");
    }

    const taskKeys = new Set<string>();
    for (const t of definition.tasks) {
      if (!SAFE_IDENTIFIER_REGEX.test(t.key)) {
        throw new PlaybookValidationError(
          `Invalid task template key '${t.key}'.`
        );
      }
      if (taskKeys.has(t.key)) {
        throw new PlaybookValidationError(
          `Duplicate task template key '${t.key}'.`
        );
      }
      taskKeys.add(t.key);

      if (!t.title_template || t.title_template.trim().length === 0) {
        throw new PlaybookValidationError(
          `Task '${t.key}' must have a non-empty title_template.`
        );
      }
      if (
        !t.instruction_template ||
        t.instruction_template.trim().length === 0
      ) {
        throw new PlaybookValidationError(
          `Task '${t.key}' must have a non-empty instruction_template.`
        );
      }

      checkTemplateVars(t.title_template, `Task '${t.key}' title_template`);
      checkTemplateVars(
        t.instruction_template,
        `Task '${t.key}' instruction_template`
      );

      const roleSpec = KOSMORA_MISSION_AGENT_CATALOG[t.assigned_agent_role];
      if (!roleSpec) {
        throw new PlaybookValidationError(
          `Task '${t.key}' specifies unknown agent role '${t.assigned_agent_role}'.`
        );
      }
      const forbiddenTools = (t.requested_tools ?? []).filter(
        (tool) => !roleSpec.allowed_tools.includes(tool)
      );
      if (forbiddenTools.length > 0) {
        throw new PlaybookValidationError(
          `Task '${t.key}' requests tools [${forbiddenTools.join(", ")}] which are not permitted for role '${t.assigned_agent_role}'.`
        );
      }

      if (!Number.isFinite(t.budget_limit) || t.budget_limit <= 0) {
        throw new PlaybookValidationError(
          `Task '${t.key}' must have a positive budget_limit.`
        );
      }
      if (!Number.isInteger(t.max_attempts) || t.max_attempts < 1) {
        throw new PlaybookValidationError(
          `Task '${t.key}' must have max_attempts >= 1.`
        );
      }

      if (t.condition_expression && t.condition_expression.trim().length > 0) {
        const parsedCond = parseSafeConditionExpression(t.condition_expression);
        if (!declaredVariables.has(parsedCond.variableKey)) {
          throw new PlaybookVariableValidationError(
            parsedCond.variableKey,
            `Task '${t.key}' condition_expression references undeclared variable '${parsedCond.variableKey}'.`
          );
        }
      }
    }

    this.assertTaskTemplatesAcyclic(definition.tasks);
  }

  private assertTaskTemplatesAcyclic(
    tasks: readonly PlaybookTaskTemplate[]
  ): void {
    const depMap = new Map<string, readonly string[]>();
    for (const t of tasks) {
      depMap.set(t.key, t.dependencies ?? []);
    }

    for (const t of tasks) {
      for (const dep of t.dependencies ?? []) {
        if (!depMap.has(dep)) {
          throw new PlaybookValidationError(
            `Task template '${t.key}' depends on unknown task key '${dep}'.`
          );
        }
        if (dep === t.key) {
          throw new PlaybookDependencyCycleError(
            `Task template '${t.key}' cannot depend on itself.`
          );
        }
      }
    }

    const visiting = new Set<string>();
    const visited = new Set<string>();

    const visit = (key: string, path: string[]): void => {
      if (visiting.has(key)) {
        throw new PlaybookDependencyCycleError(
          `Dependency cycle detected in playbook tasks: ${[...path, key].join(" -> ")}`
        );
      }
      if (visited.has(key)) return;
      visiting.add(key);
      for (const dep of depMap.get(key) ?? []) {
        visit(dep, [...path, key]);
      }
      visiting.delete(key);
      visited.add(key);
    };

    for (const t of tasks) {
      visit(t.key, []);
    }
  }

  /**
   * Validates user-supplied variable values against `definition.variables`.
   * Rejects unknown variables, missing required variables, type mismatches,
   * out-of-range numbers, invalid URLs, and invalid select options.
   */
  public resolveAndValidateVariables(
    definition: PlaybookDefinition,
    suppliedValues: Record<string, unknown> = {}
  ): {
    rawResolved: Record<string, string | number | boolean>;
    sanitizedResolved: Record<string, string | number | boolean>;
    secretKeys: string[];
  } {
    const declaredMap = new Map<string, PlaybookVariable>();
    for (const v of definition.variables) {
      declaredMap.set(v.key, v);
    }

    for (const suppliedKey of Object.keys(suppliedValues)) {
      if (!declaredMap.has(suppliedKey)) {
        throw new PlaybookVariableValidationError(
          suppliedKey,
          `Unknown variable '${suppliedKey}' is not declared in this playbook.`
        );
      }
    }

    const rawResolved: Record<string, string | number | boolean> = {};
    const sanitizedResolved: Record<string, string | number | boolean> = {};
    const secretKeys: string[] = [];

    for (const variable of definition.variables) {
      const hasSupplied =
        suppliedValues[variable.key] !== undefined &&
        suppliedValues[variable.key] !== null;
      const candidate = hasSupplied
        ? suppliedValues[variable.key]
        : variable.default_value;

      const isEmptyString =
        typeof candidate === "string" && candidate.trim().length === 0;

      if (candidate === undefined || candidate === null || isEmptyString) {
        if (variable.required) {
          throw new PlaybookVariableValidationError(
            variable.key,
            `Required variable '${variable.key}' ('${variable.label}') is missing or empty.`
          );
        }
        const fallback =
          variable.type === "boolean"
            ? false
            : variable.type === "number"
              ? 0
              : "";
        rawResolved[variable.key] = fallback;
        sanitizedResolved[variable.key] = variable.secret
          ? SECRET_REDACTED_PLACEHOLDER
          : fallback;
        if (variable.secret) {
          secretKeys.push(variable.key);
        }
        continue;
      }

      const rules = variable.validation_rules;

      switch (variable.type) {
        case "text":
        case "textarea": {
          if (typeof candidate !== "string") {
            throw new PlaybookVariableValidationError(
              variable.key,
              `Variable '${variable.key}' must be a string.`
            );
          }
          const val = candidate.trim();
          if (rules?.min_length !== undefined && val.length < rules.min_length) {
            throw new PlaybookVariableValidationError(
              variable.key,
              `Variable '${variable.key}' length (${val.length}) is shorter than min_length (${rules.min_length}).`
            );
          }
          if (rules?.max_length !== undefined && val.length > rules.max_length) {
            throw new PlaybookVariableValidationError(
              variable.key,
              `Variable '${variable.key}' length (${val.length}) exceeds max_length (${rules.max_length}).`
            );
          }
          if (rules?.pattern) {
            const regex = new RegExp(rules.pattern);
            if (!regex.test(val)) {
              throw new PlaybookVariableValidationError(
                variable.key,
                `Variable '${variable.key}' does not match required pattern '${rules.pattern}'.`
              );
            }
          }
          rawResolved[variable.key] = val;
          break;
        }
        case "number": {
          const num =
            typeof candidate === "number"
              ? candidate
              : typeof candidate === "string" &&
                  candidate.trim().length > 0 &&
                  !Number.isNaN(Number(candidate))
                ? Number(candidate)
                : NaN;
          if (!Number.isFinite(num)) {
            throw new PlaybookVariableValidationError(
              variable.key,
              `Variable '${variable.key}' must be a valid finite number.`
            );
          }
          if (rules?.min !== undefined && num < rules.min) {
            throw new PlaybookVariableValidationError(
              variable.key,
              `Variable '${variable.key}' (${num}) is less than minimum (${rules.min}).`
            );
          }
          if (rules?.max !== undefined && num > rules.max) {
            throw new PlaybookVariableValidationError(
              variable.key,
              `Variable '${variable.key}' (${num}) exceeds maximum (${rules.max}).`
            );
          }
          rawResolved[variable.key] = num;
          break;
        }
        case "boolean": {
          if (typeof candidate === "boolean") {
            rawResolved[variable.key] = candidate;
          } else if (candidate === "true") {
            rawResolved[variable.key] = true;
          } else if (candidate === "false") {
            rawResolved[variable.key] = false;
          } else {
            throw new PlaybookVariableValidationError(
              variable.key,
              `Variable '${variable.key}' must be a boolean (true or false).`
            );
          }
          break;
        }
        case "select": {
          if (typeof candidate !== "string") {
            throw new PlaybookVariableValidationError(
              variable.key,
              `Select variable '${variable.key}' must be a string option value.`
            );
          }
          const allowedValues = (variable.options ?? []).map((o) => o.value);
          if (!allowedValues.includes(candidate)) {
            throw new PlaybookVariableValidationError(
              variable.key,
              `Invalid option '${candidate}' for select variable '${variable.key}'. Allowed options: [${allowedValues.join(", ")}].`
            );
          }
          rawResolved[variable.key] = candidate;
          break;
        }
        case "url": {
          if (typeof candidate !== "string") {
            throw new PlaybookVariableValidationError(
              variable.key,
              `URL variable '${variable.key}' must be a string.`
            );
          }
          let parsedUrl: URL;
          try {
            parsedUrl = new URL(candidate.trim());
          } catch {
            throw new PlaybookVariableValidationError(
              variable.key,
              `Variable '${variable.key}' contains an invalid URL '${candidate}'.`
            );
          }
          const allowedProtocols = rules?.allowed_protocols ?? [
            "https:",
            "http:"
          ];
          if (
            !allowedProtocols.includes(parsedUrl.protocol) ||
            !parsedUrl.hostname
          ) {
            throw new PlaybookVariableValidationError(
              variable.key,
              `URL variable '${variable.key}' must use an allowed protocol (${allowedProtocols.join(", ")}) and include a valid hostname.`
            );
          }
          rawResolved[variable.key] = parsedUrl.toString();
          break;
        }
        default: {
          throw new PlaybookVariableValidationError(
            variable.key,
            `Unsupported variable type '${String(variable.type)}'.`
          );
        }
      }

      if (variable.secret) {
        secretKeys.push(variable.key);
        sanitizedResolved[variable.key] = SECRET_REDACTED_PLACEHOLDER;
      } else {
        sanitizedResolved[variable.key] = rawResolved[variable.key]!;
      }
    }

    return { rawResolved, sanitizedResolved, secretKeys };
  }

  public listCategories(params: {
    principal: TenantPrincipal;
    project_id?: string | null;
  }): Array<{ category: string; count: number; tags: string[] }> {
    const playbooks = this.listPlaybooks({
      principal: params.principal,
      project_id: params.project_id
    });
    const map = new Map<string, { count: number; tags: Set<string> }>();
    for (const pb of playbooks) {
      const entry = map.get(pb.category) ?? { count: 0, tags: new Set<string>() };
      entry.count += 1;
      for (const tag of pb.tags) {
        entry.tags.add(tag);
      }
      map.set(pb.category, entry);
    }
    return Array.from(map.entries()).map(([category, info]) => ({
      category,
      count: info.count,
      tags: Array.from(info.tags)
    }));
  }

  public listPlaybooks(params: {
    principal: TenantPrincipal;
    project_id?: string | null;
    category?: string;
    tag?: string;
    visibility?: PlaybookVisibility;
    status?: PlaybookStatus;
    search?: string;
  }): Playbook[] {
    const auth = this.security.authorizeAction(
      params.principal,
      params.principal.tenant_id,
      params.principal.workspace_ids[0] ?? "ws_default",
      "workspace:read"
    );
    if (!auth.allowed) {
      throw new PlaybookAccessDeniedError(auth.reason);
    }

    const rows = this.store.listPlaybookRows({
      category: params.category,
      visibility: params.visibility,
      status: params.status
    });

    const searchLower = params.search?.trim().toLowerCase();
    const tagFilter = params.tag?.trim().toLowerCase();

    return rows
      .map((r) => this.rowToPlaybook(r))
      .filter((pb) =>
        this.canPrincipalReadPlaybook(
          params.principal,
          pb,
          params.project_id ?? null
        )
      )
      .filter((pb) => {
        if (tagFilter && !pb.tags.some((t) => t.toLowerCase() === tagFilter)) {
          return false;
        }
        if (searchLower) {
          const haystack =
            `${pb.title} ${pb.description} ${pb.slug} ${pb.category} ${pb.tags.join(" ")}`.toLowerCase();
          if (!haystack.includes(searchLower)) {
            return false;
          }
        }
        return true;
      });
  }

  public getPlaybookDetails(params: {
    principal: TenantPrincipal;
    playbook_id: string;
    project_id?: string | null;
  }): {
    playbook: Playbook;
    versions: PlaybookVersion[];
    instantiations: PlaybookInstantiation[];
    audit_events: PlaybookAuditEvent[];
  } {
    const row = this.store.getPlaybookRowById(params.playbook_id);
    if (!row) {
      throw new PlaybookNotFoundError(
        `Playbook '${params.playbook_id}' not found.`
      );
    }
    const playbook = this.rowToPlaybook(row);
    this.assertPrincipalCanReadPlaybook(
      params.principal,
      playbook,
      params.project_id ?? playbook.project_id
    );

    const versions = this.store
      .listPlaybookVersionRows(playbook.id)
      .map((v) => this.rowToPlaybookVersion(v));

    const instantiations = this.store
      .listPlaybookInstantiationRows(playbook.id)
      .filter(
        (inst) =>
          inst.tenant_id === params.principal.tenant_id &&
          (params.principal.role === "owner" ||
            params.principal.role === "admin" ||
            inst.owner_id === params.principal.user_id)
      )
      .map((i) => this.rowToInstantiation(i));

    const auditEvents = this.store
      .listPlaybookAuditEventRows(playbook.id)
      .filter(
        (ev) =>
          playbook.visibility === "built_in" ||
          ev.tenant_id === params.principal.tenant_id
      )
      .map((e) => this.rowToAuditEvent(e));

    return {
      playbook,
      versions,
      instantiations,
      audit_events: auditEvents
    };
  }

  public createPlaybook(params: {
    principal: TenantPrincipal;
    project_id?: string | null;
    slug: string;
    title: string;
    description: string;
    category?: string;
    tags?: string[];
    visibility?: Exclude<PlaybookVisibility, "built_in">;
    definition: PlaybookDefinition;
    publish_immediately?: boolean;
    changelog?: string;
  }): { playbook: Playbook; published_version: PlaybookVersion | null } {
    const auth = this.security.authorizeAction(
      params.principal,
      params.principal.tenant_id,
      params.principal.workspace_ids[0] ?? "ws_default",
      "workspace:write"
    );
    if (!auth.allowed) {
      throw new PlaybookAccessDeniedError(auth.reason);
    }

    const visibility = params.visibility ?? "private";
    if ((visibility as string) === "built_in") {
      throw new PlaybookValidationError(
        "Users cannot create playbooks with 'built_in' visibility."
      );
    }
    const slug = params.slug.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-_]{1,63}$/.test(slug)) {
      throw new PlaybookValidationError(
        `Invalid playbook slug '${slug}'. Must contain lowercase alphanumeric characters, hyphens, or underscores.`
      );
    }
    const title = params.title.trim();
    if (!title) {
      throw new PlaybookValidationError("Playbook title is required.");
    }

    const projectId =
      visibility === "organization"
        ? null
        : (params.project_id?.trim() ?? "proj_default");

    const existingSlug = this.store.getPlaybookRowBySlug(
      params.principal.tenant_id,
      projectId,
      slug
    );
    if (existingSlug) {
      throw new PlaybookValidationError(
        `Playbook with slug '${slug}' already exists in this scope.`
      );
    }

    this.validatePlaybookDefinition(params.definition);
    const { json } = canonicalizePlaybookDefinition(params.definition);
    const nowIso = new Date().toISOString();

    const playbookRow: StoredPlaybookRow = {
      id: this.nextId("pbk"),
      tenant_id: params.principal.tenant_id,
      project_id: projectId,
      owner_id: params.principal.user_id,
      slug,
      title,
      description: (params.description ?? "").trim(),
      category: (params.category ?? "Пользовательские").trim(),
      tags_json: JSON.stringify(params.tags ?? []),
      visibility,
      status: "draft",
      current_version: 0,
      draft_definition_json: json,
      draft_version_lock: 1,
      created_at: nowIso,
      updated_at: nowIso,
      archived_at: null
    };

    this.store.insertPlaybookRow(playbookRow);
    let playbook = this.rowToPlaybook(playbookRow);

    this.recordPlaybookAuditEvent({
      tenant_id: playbook.tenant_id,
      project_id: playbook.project_id,
      playbook_id: playbook.id,
      actor_id: params.principal.user_id,
      event_type: "playbook.created",
      payload: {
        slug: playbook.slug,
        title: playbook.title,
        visibility: playbook.visibility
      }
    });

    let publishedVersion: PlaybookVersion | null = null;
    if (params.publish_immediately) {
      const pub = this.publishVersion({
        principal: params.principal,
        playbook_id: playbook.id,
        changelog: params.changelog ?? "Первая опубликованная версия (v1)."
      });
      playbook = pub.playbook;
      publishedVersion = pub.version;
    }

    return { playbook, published_version: publishedVersion };
  }

  public updatePlaybookDraft(params: {
    principal: TenantPrincipal;
    playbook_id: string;
    expected_draft_version_lock?: number;
    title?: string;
    description?: string;
    category?: string;
    tags?: string[];
    visibility?: Exclude<PlaybookVisibility, "built_in">;
    definition?: PlaybookDefinition;
    target_version?: number | string;
  }): Playbook {
    const row = this.store.getPlaybookRowById(params.playbook_id);
    if (!row) {
      throw new PlaybookNotFoundError(
        `Playbook '${params.playbook_id}' not found.`
      );
    }
    const current = this.rowToPlaybook(row);
    this.assertPrincipalCanModifyPlaybook(params.principal, current);

    if (current.status === "archived") {
      throw new PlaybookValidationError(
        `Playbook '${current.id}' is archived and cannot be modified.`
      );
    }

    if (params.target_version !== undefined) {
      throw new PlaybookImmutableVersionError(
        current.id,
        params.target_version
      );
    }

    const expectedLock =
      params.expected_draft_version_lock ?? current.draft_version_lock;
    const nextDefinition = params.definition ?? current.draft_definition;
    this.validatePlaybookDefinition(nextDefinition);
    const { json } = canonicalizePlaybookDefinition(nextDefinition);

    const nextVisibility = params.visibility ?? current.visibility;
    if ((nextVisibility as string) === "built_in") {
      throw new PlaybookValidationError(
        "Cannot change playbook visibility to 'built_in'."
      );
    }

    const updatedRow: StoredPlaybookRow = {
      ...row,
      title: params.title !== undefined ? params.title.trim() : current.title,
      description:
        params.description !== undefined
          ? params.description.trim()
          : current.description,
      category:
        params.category !== undefined
          ? params.category.trim()
          : current.category,
      tags_json: JSON.stringify(params.tags ?? current.tags),
      visibility: nextVisibility,
      draft_definition_json: json,
      draft_version_lock: expectedLock + 1,
      updated_at: new Date().toISOString()
    };

    const ok = this.store.updatePlaybookRowOptimistic(updatedRow, expectedLock);
    if (!ok) {
      const latest = this.store.getPlaybookRowById(current.id);
      throw new PlaybookVersionConflictError(
        current.id,
        expectedLock,
        latest?.draft_version_lock ?? -1
      );
    }

    const updated = this.rowToPlaybook(updatedRow);
    this.recordPlaybookAuditEvent({
      tenant_id: updated.tenant_id,
      project_id: updated.project_id,
      playbook_id: updated.id,
      actor_id: params.principal.user_id,
      event_type: "playbook.updated",
      payload: {
        draft_version_lock: updated.draft_version_lock,
        title: updated.title
      }
    });

    return updated;
  }

  /**
   * Publishes a new immutable `PlaybookVersion` (with SHA-256 checksum).
   * If `from_version` is specified, copies the definition from that historical published version
   * to create the new version (safe rollback via new version creation without mutating history).
   */
  public publishVersion(params: {
    principal: TenantPrincipal;
    playbook_id: string;
    changelog?: string;
    from_version?: number | string;
    expected_draft_version_lock?: number;
  }): { playbook: Playbook; version: PlaybookVersion } {
    const row = this.store.getPlaybookRowById(params.playbook_id);
    if (!row) {
      throw new PlaybookNotFoundError(
        `Playbook '${params.playbook_id}' not found.`
      );
    }
    const playbook = this.rowToPlaybook(row);
    this.assertPrincipalCanModifyPlaybook(params.principal, playbook);

    if (playbook.status === "archived") {
      throw new PlaybookValidationError(
        `Cannot publish a new version for archived playbook '${playbook.id}'.`
      );
    }

    const expectedLock =
      params.expected_draft_version_lock ?? playbook.draft_version_lock;

    let definitionToPublish = playbook.draft_definition;
    let sourceVersionNumber: number | null = null;

    if (params.from_version !== undefined && params.from_version !== null) {
      const sourceRow = this.store.getPlaybookVersionRow(
        playbook.id,
        params.from_version
      );
      if (!sourceRow) {
        throw new PlaybookNotFoundError(
          `Source version '${String(params.from_version)}' not found on playbook '${playbook.id}'.`
        );
      }
      const verifiedSource = this.rowToPlaybookVersion(sourceRow);
      definitionToPublish = verifiedSource.definition;
      sourceVersionNumber = verifiedSource.version_number;
    }

    this.validatePlaybookDefinition(definitionToPublish);
    const { json, checksum_sha256 } =
      canonicalizePlaybookDefinition(definitionToPublish);

    const nextVersionNumber = playbook.current_version + 1;
    const nowIso = new Date().toISOString();
    const changelog =
      params.changelog?.trim() ||
      (sourceVersionNumber !== null
        ? `Откат / создание новой версии v${nextVersionNumber} на основе опубликованной версии v${sourceVersionNumber}`
        : `Опубликована версия v${nextVersionNumber}`);

    const versionRow: StoredPlaybookVersionRow = {
      id: `${playbook.id}_v${nextVersionNumber}`,
      playbook_id: playbook.id,
      version_number: nextVersionNumber,
      changelog,
      definition_json: json,
      created_by: params.principal.user_id,
      created_at: nowIso,
      checksum_sha256,
      is_published: 1
    };

    const updatedPlaybookRow: StoredPlaybookRow = {
      ...row,
      status: "active",
      current_version: nextVersionNumber,
      draft_definition_json: json,
      draft_version_lock: expectedLock + 1,
      updated_at: nowIso
    };

    const ok = this.store.updatePlaybookRowOptimistic(
      updatedPlaybookRow,
      expectedLock
    );
    if (!ok) {
      const latest = this.store.getPlaybookRowById(playbook.id);
      throw new PlaybookVersionConflictError(
        playbook.id,
        expectedLock,
        latest?.draft_version_lock ?? -1
      );
    }

    this.store.insertPlaybookVersionRow(versionRow);
    const updatedPlaybook = this.rowToPlaybook(updatedPlaybookRow);
    const publishedVersion = this.rowToPlaybookVersion(versionRow);

    if (sourceVersionNumber !== null) {
      this.recordPlaybookAuditEvent({
        tenant_id: updatedPlaybook.tenant_id,
        project_id: updatedPlaybook.project_id,
        playbook_id: updatedPlaybook.id,
        playbook_version_id: publishedVersion.id,
        actor_id: params.principal.user_id,
        event_type: "playbook.version_cloned",
        payload: {
          from_version: sourceVersionNumber,
          new_version: nextVersionNumber,
          checksum_sha256
        }
      });
    }

    this.recordPlaybookAuditEvent({
      tenant_id: updatedPlaybook.tenant_id,
      project_id: updatedPlaybook.project_id,
      playbook_id: updatedPlaybook.id,
      playbook_version_id: publishedVersion.id,
      actor_id: params.principal.user_id,
      event_type: "playbook.version_published",
      payload: {
        version_number: nextVersionNumber,
        checksum_sha256,
        changelog
      }
    });

    return { playbook: updatedPlaybook, version: publishedVersion };
  }

  public listVersions(params: {
    principal: TenantPrincipal;
    playbook_id: string;
    project_id?: string | null;
  }): PlaybookVersion[] {
    const row = this.store.getPlaybookRowById(params.playbook_id);
    if (!row) {
      throw new PlaybookNotFoundError(
        `Playbook '${params.playbook_id}' not found.`
      );
    }
    const playbook = this.rowToPlaybook(row);
    this.assertPrincipalCanReadPlaybook(
      params.principal,
      playbook,
      params.project_id ?? playbook.project_id
    );

    return this.store
      .listPlaybookVersionRows(playbook.id)
      .map((v) => this.rowToPlaybookVersion(v));
  }

  public getVersion(params: {
    principal: TenantPrincipal;
    playbook_id: string;
    version_id: string | number;
    project_id?: string | null;
  }): PlaybookVersion {
    const row = this.store.getPlaybookRowById(params.playbook_id);
    if (!row) {
      throw new PlaybookNotFoundError(
        `Playbook '${params.playbook_id}' not found.`
      );
    }
    const playbook = this.rowToPlaybook(row);
    this.assertPrincipalCanReadPlaybook(
      params.principal,
      playbook,
      params.project_id ?? playbook.project_id
    );

    const verRow = this.store.getPlaybookVersionRow(
      playbook.id,
      params.version_id
    );
    if (!verRow) {
      throw new PlaybookNotFoundError(
        `Version '${String(params.version_id)}' not found on playbook '${playbook.id}'.`
      );
    }
    return this.rowToPlaybookVersion(verRow);
  }

  public diffVersions(params: {
    principal: TenantPrincipal;
    playbook_id: string;
    from_version: string | number;
    to_version: string | number;
    project_id?: string | null;
  }): PlaybookDiffResult {
    const fromVer = this.getVersion({
      principal: params.principal,
      playbook_id: params.playbook_id,
      version_id: params.from_version,
      project_id: params.project_id
    });
    const toVer = this.getVersion({
      principal: params.principal,
      playbook_id: params.playbook_id,
      version_id: params.to_version,
      project_id: params.project_id
    });

    const metadataChanges: Array<{
      field: string;
      before: unknown;
      after: unknown;
    }> = [];

    const metaFields: Array<keyof PlaybookDefinition> = [
      "mission_title_template",
      "goal_template",
      "context_template",
      "default_priority",
      "default_budget_limit"
    ];

    for (const field of metaFields) {
      if (
        JSON.stringify(fromVer.definition[field]) !==
        JSON.stringify(toVer.definition[field])
      ) {
        metadataChanges.push({
          field,
          before: fromVer.definition[field],
          after: toVer.definition[field]
        });
      }
    }

    const fromVars = new Map(
      fromVer.definition.variables.map((v) => [v.key, v])
    );
    const toVars = new Map(toVer.definition.variables.map((v) => [v.key, v]));
    const variableChanges: PlaybookVariableDiffEntry[] = [];

    for (const [key, beforeVar] of fromVars.entries()) {
      const afterVar = toVars.get(key);
      if (!afterVar) {
        variableChanges.push({
          key,
          change: "removed",
          before: beforeVar,
          changed_fields: ["*"]
        });
      } else if (JSON.stringify(beforeVar) !== JSON.stringify(afterVar)) {
        const changedFields = Object.keys({
          ...beforeVar,
          ...afterVar
        }).filter(
          (k) =>
            JSON.stringify((beforeVar as unknown as Record<string, unknown>)[k]) !==
            JSON.stringify((afterVar as unknown as Record<string, unknown>)[k])
        );
        variableChanges.push({
          key,
          change: "modified",
          before: beforeVar,
          after: afterVar,
          changed_fields: changedFields
        });
      }
    }
    for (const [key, afterVar] of toVars.entries()) {
      if (!fromVars.has(key)) {
        variableChanges.push({
          key,
          change: "added",
          after: afterVar,
          changed_fields: ["*"]
        });
      }
    }

    const fromTasks = new Map(fromVer.definition.tasks.map((t) => [t.key, t]));
    const toTasks = new Map(toVer.definition.tasks.map((t) => [t.key, t]));
    const taskChanges: PlaybookTaskDiffEntry[] = [];

    for (const [key, beforeTask] of fromTasks.entries()) {
      const afterTask = toTasks.get(key);
      if (!afterTask) {
        taskChanges.push({
          key,
          change: "removed",
          before: beforeTask,
          changed_fields: ["*"]
        });
      } else if (JSON.stringify(beforeTask) !== JSON.stringify(afterTask)) {
        const changedFields = Object.keys({
          ...beforeTask,
          ...afterTask
        }).filter(
          (k) =>
            JSON.stringify((beforeTask as unknown as Record<string, unknown>)[k]) !==
            JSON.stringify((afterTask as unknown as Record<string, unknown>)[k])
        );
        taskChanges.push({
          key,
          change: "modified",
          before: beforeTask,
          after: afterTask,
          changed_fields: changedFields
        });
      }
    }
    for (const [key, afterTask] of toTasks.entries()) {
      if (!fromTasks.has(key)) {
        taskChanges.push({
          key,
          change: "added",
          after: afterTask,
          changed_fields: ["*"]
        });
      }
    }

    const totalChanges =
      metadataChanges.length + variableChanges.length + taskChanges.length;

    return {
      playbook_id: params.playbook_id,
      from_version: fromVer.version_number,
      to_version: toVer.version_number,
      from_checksum_sha256: fromVer.checksum_sha256,
      to_checksum_sha256: toVer.checksum_sha256,
      metadata_changes: metadataChanges,
      variable_changes: variableChanges,
      task_changes: taskChanges,
      total_changes: totalChanges,
      summary: `Сравнение v${fromVer.version_number} → v${toVer.version_number}: изменений метаданных — ${metadataChanges.length}, переменных — ${variableChanges.length}, задач — ${taskChanges.length}.`
    };
  }

  public archivePlaybook(params: {
    principal: TenantPrincipal;
    playbook_id: string;
    expected_draft_version_lock?: number;
  }): Playbook {
    const row = this.store.getPlaybookRowById(params.playbook_id);
    if (!row) {
      throw new PlaybookNotFoundError(
        `Playbook '${params.playbook_id}' not found.`
      );
    }
    const playbook = this.rowToPlaybook(row);
    this.assertPrincipalCanModifyPlaybook(params.principal, playbook);

    const expectedLock =
      params.expected_draft_version_lock ?? playbook.draft_version_lock;
    const nowIso = new Date().toISOString();

    const updatedRow: StoredPlaybookRow = {
      ...row,
      status: "archived",
      archived_at: nowIso,
      draft_version_lock: expectedLock + 1,
      updated_at: nowIso
    };

    const ok = this.store.updatePlaybookRowOptimistic(updatedRow, expectedLock);
    if (!ok) {
      const latest = this.store.getPlaybookRowById(playbook.id);
      throw new PlaybookVersionConflictError(
        playbook.id,
        expectedLock,
        latest?.draft_version_lock ?? -1
      );
    }

    const archived = this.rowToPlaybook(updatedRow);
    this.recordPlaybookAuditEvent({
      tenant_id: archived.tenant_id,
      project_id: archived.project_id,
      playbook_id: archived.id,
      actor_id: params.principal.user_id,
      event_type: "playbook.archived",
      payload: {
        archived_at: nowIso
      }
    });

    return archived;
  }

  /**
   * Computes a full live preview of the future Mission Control mission:
   * - Validates variables
   * - Evaluates task conditions (`included_tasks` vs `excluded_tasks`)
   * - Bridges dependencies across conditionally excluded middle steps while rejecting unknown or dangling root dependencies
   * - Checks DAG acyclicity and role tool allowlists
   * - Computes total planned budget and compares against `budget_limit`
   */
  public previewInstantiation(params: {
    principal: TenantPrincipal;
    playbook_id: string;
    version_id?: string | number;
    project_id: string;
    variables?: Record<string, unknown>;
    mission_title_override?: string;
    budget_limit_override?: number;
  }): PlaybookPreviewResult {
    const row = this.store.getPlaybookRowById(params.playbook_id);
    if (!row) {
      throw new PlaybookNotFoundError(
        `Playbook '${params.playbook_id}' not found.`
      );
    }
    const playbook = this.rowToPlaybook(row);
    this.assertPrincipalCanReadPlaybook(
      params.principal,
      playbook,
      params.project_id
    );

    if (playbook.status === "archived") {
      throw new PlaybookValidationError(
        `Playbook '${playbook.id}' is archived and cannot be instantiated.`
      );
    }
    if (playbook.current_version < 1) {
      throw new PlaybookValidationError(
        `Playbook '${playbook.id}' has no published versions yet.`
      );
    }

    const targetVersionId = params.version_id ?? playbook.current_version;
    const version = this.getVersion({
      principal: params.principal,
      playbook_id: playbook.id,
      version_id: targetVersionId,
      project_id: params.project_id
    });
    if (!version.is_published) {
      throw new PlaybookValidationError(
        `Version '${version.id}' of playbook '${playbook.id}' is not published.`
      );
    }

    const definition = version.definition;
    this.validatePlaybookDefinition(definition);

    const { rawResolved, sanitizedResolved, secretKeys } =
      this.resolveAndValidateVariables(definition, params.variables ?? {});

    const declaredMap = new Map(definition.variables.map((v) => [v.key, v]));

    const resolvedTitle = params.mission_title_override?.trim()
      ? params.mission_title_override.trim()
      : interpolateSafeTemplate(
          definition.mission_title_template,
          rawResolved,
          declaredMap
        );
    const resolvedGoal = interpolateSafeTemplate(
      definition.goal_template,
      rawResolved,
      declaredMap
    );
    const resolvedContext = definition.context_template
      ? interpolateSafeTemplate(
          definition.context_template,
          rawResolved,
          declaredMap
        )
      : "";

    const rawTasksByKey = new Map<string, PlaybookTaskTemplate>();
    for (const t of definition.tasks) {
      rawTasksByKey.set(t.key, t);
    }

    const includedKeys = new Set<string>();
    const excludedTasks: PlaybookPreviewExcludedTask[] = [];

    for (const t of definition.tasks) {
      if (t.condition_expression && t.condition_expression.trim().length > 0) {
        const evalRes = evaluateSafeConditionExpression(
          t.condition_expression,
          rawResolved
        );
        if (!evalRes.included) {
          excludedTasks.push({
            key: t.key,
            title_template: t.title_template,
            assigned_agent_role: t.assigned_agent_role,
            condition_expression: t.condition_expression,
            reason: evalRes.reason,
            budget_saved: Number(t.budget_limit)
          });
          continue;
        }
      }
      includedKeys.add(t.key);
    }

    if (includedKeys.size === 0) {
      throw new PlaybookValidationError(
        "All playbook tasks were excluded by conditions; at least one task must remain to create a mission."
      );
    }

    const resolveEffectiveDependencies = (taskKey: string): string[] => {
      const task = rawTasksByKey.get(taskKey)!;
      const effective = new Set<string>();

      const expandDep = (depKey: string, visited: Set<string>): void => {
        if (visited.has(depKey)) return;
        visited.add(depKey);
        const depTemplate = rawTasksByKey.get(depKey);
        if (!depTemplate) {
          throw new PlaybookValidationError(
            `Task '${taskKey}' depends on unknown task '${depKey}'.`
          );
        }
        if (includedKeys.has(depKey)) {
          effective.add(depKey);
        } else {
          if (depTemplate.dependencies.length === 0) {
            throw new PlaybookValidationError(
              `Task '${taskKey}' depends on excluded root task '${depKey}' which has no upstream fallback.`
            );
          }
          for (const upstream of depTemplate.dependencies) {
            expandDep(upstream, visited);
          }
        }
      };

      for (const dep of task.dependencies) {
        expandDep(dep, new Set<string>());
      }
      return Array.from(effective);
    };

    const includedTasks: PlaybookPreviewTaskNode[] = [];
    const dagEdges: Array<{ from: string; to: string }> = [];

    for (const t of definition.tasks) {
      if (!includedKeys.has(t.key)) continue;

      const resolvedDependencies = resolveEffectiveDependencies(t.key);
      for (const dep of resolvedDependencies) {
        dagEdges.push({ from: dep, to: t.key });
      }

      const executionMode: "autonomous" | "require_review" | "require_clarification" =
        t.requires_owner_review ? "require_review" : t.execution_mode;

      includedTasks.push({
        key: t.key,
        title: interpolateSafeTemplate(
          t.title_template,
          rawResolved,
          declaredMap
        ),
        instruction: interpolateSafeTemplate(
          t.instruction_template,
          rawResolved,
          declaredMap
        ),
        assigned_agent_role: t.assigned_agent_role,
        execution_mode: executionMode,
        requested_tools: [...t.requested_tools],
        priority: t.priority,
        dependencies: resolvedDependencies,
        budget_limit: Number(t.budget_limit),
        max_attempts: Number(t.max_attempts),
        requires_owner_review: Boolean(t.requires_owner_review),
        condition_expression: t.condition_expression
      });
    }

    const plannedBudget = Number(
      includedTasks
        .reduce((acc, t) => acc + Number(t.budget_limit), 0)
        .toFixed(2)
    );

    const budgetFromVariable =
      typeof rawResolved.budget === "number" ? rawResolved.budget : undefined;
    const missionBudgetLimit = Number(
      (
        params.budget_limit_override ??
        budgetFromVariable ??
        definition.default_budget_limit
      ).toFixed(2)
    );

    const hitlCount = includedTasks.filter(
      (t) =>
        t.requires_owner_review ||
        t.execution_mode === "require_review" ||
        t.assigned_agent_role === "reviewer"
    ).length;

    return {
      playbook_id: playbook.id,
      playbook_slug: playbook.slug,
      playbook_title: playbook.title,
      version_id: version.id,
      version_number: version.version_number,
      checksum_sha256: version.checksum_sha256,
      resolved_mission_title: resolvedTitle,
      resolved_goal: resolvedGoal,
      resolved_context: resolvedContext,
      sanitized_variables: sanitizedResolved,
      secret_keys: secretKeys,
      included_tasks: includedTasks,
      excluded_tasks: excludedTasks,
      dag_edges: dagEdges,
      planned_budget: plannedBudget,
      mission_budget_limit: missionBudgetLimit,
      within_budget: plannedBudget <= missionBudgetLimit,
      requires_hitl_checkpoints: hitlCount
    };
  }

  /**
   * Atomically instantiates a published PlaybookVersion into a real Mission Control Mission
   * and MissionTasks. Rolls back 100% of database writes if any validation or creation step fails.
   */
  public instantiatePlaybook(params: {
    principal: TenantPrincipal;
    playbook_id: string;
    version_id?: string | number;
    project_id: string;
    workspace_id?: string;
    variables?: Record<string, unknown>;
    mission_title_override?: string;
    budget_limit_override?: number;
    simulate_mid_transaction_failure?: boolean;
  }): PlaybookInstantiationCompleteResult {
    const workspaceId =
      params.workspace_id ?? params.principal.workspace_ids[0] ?? "ws_default";
    const auth = this.security.authorizeAction(
      params.principal,
      params.principal.tenant_id,
      workspaceId,
      "workspace:write"
    );
    if (!auth.allowed) {
      throw new PlaybookAccessDeniedError(auth.reason);
    }

    const preview = this.previewInstantiation({
      principal: params.principal,
      playbook_id: params.playbook_id,
      version_id: params.version_id,
      project_id: params.project_id,
      variables: params.variables,
      mission_title_override: params.mission_title_override,
      budget_limit_override: params.budget_limit_override
    });

    if (!preview.within_budget) {
      throw new PlaybookBudgetExceededError(
        preview.planned_budget,
        preview.mission_budget_limit
      );
    }

    const playbookRow = this.store.getPlaybookRowById(params.playbook_id)!;
    const playbook = this.rowToPlaybook(playbookRow);

    return this.store.runInAtomicTransaction(() => {
      const missionContextWithProvenance = [
        preview.resolved_context,
        `[Создано из плейбука: ${playbook.title} (${playbook.slug}) v${preview.version_number} | SHA-256: ${preview.checksum_sha256.slice(0, 16)}]`
      ]
        .filter(Boolean)
        .join("\n");

      const mission = this.missionControl.createMission({
        principal: params.principal,
        workspace_id: workspaceId,
        project_id: params.project_id,
        title: preview.resolved_mission_title,
        goal: preview.resolved_goal,
        context: missionContextWithProvenance,
        priority: playbook.draft_definition.default_priority as MissionPriority,
        budget_limit: preview.mission_budget_limit
      });

      const keyToTaskId = new Map<string, string>();
      for (const taskNode of preview.included_tasks) {
        keyToTaskId.set(
          taskNode.key,
          `${mission.id}_tsk_${taskNode.key}`
        );
      }

      const createdTasks: MissionTask[] = [];
      for (let i = 0; i < preview.included_tasks.length; i += 1) {
        const taskNode = preview.included_tasks[i]!;
        const mappedDependencies = taskNode.dependencies.map((depKey) => {
          const targetId = keyToTaskId.get(depKey);
          if (!targetId) {
            throw new PlaybookValidationError(
              `Failed to map dependency '${depKey}' for task '${taskNode.key}'.`
            );
          }
          return targetId;
        });

        const task = this.missionControl.createTask({
          principal: params.principal,
          mission_id: mission.id,
          id: keyToTaskId.get(taskNode.key),
          title: taskNode.title,
          instruction: taskNode.instruction,
          assigned_agent_role: taskNode.assigned_agent_role as MissionAgentRole,
          execution_mode: taskNode.execution_mode as MissionTaskExecutionMode,
          requested_tools: [...taskNode.requested_tools],
          priority: taskNode.priority as MissionPriority,
          dependencies: mappedDependencies,
          max_attempts: taskNode.max_attempts,
          budget_limit: taskNode.budget_limit
        });
        createdTasks.push(task);

        if (params.simulate_mid_transaction_failure && i === 0) {
          throw new Error(
            "Simulated mid-transaction failure after partial mission and task creation."
          );
        }
      }

      const readyMission = this.missionControl.updateMission({
        principal: params.principal,
        mission_id: mission.id,
        status: "ready"
      });

      const nowIso = new Date().toISOString();
      const instRow: StoredPlaybookInstantiationRow = {
        id: this.nextId("pbi"),
        playbook_id: playbook.id,
        playbook_version_id: preview.version_id,
        resulting_mission_id: readyMission.id,
        owner_id: params.principal.user_id,
        tenant_id: params.principal.tenant_id,
        project_id: params.project_id,
        resolved_variables_json: JSON.stringify(preview.sanitized_variables),
        initiated_at: nowIso,
        created_at: nowIso
      };
      this.store.insertPlaybookInstantiationRow(instRow);
      const instantiation = this.rowToInstantiation(instRow);

      this.recordPlaybookAuditEvent({
        tenant_id: params.principal.tenant_id,
        project_id: params.project_id,
        playbook_id: playbook.id,
        playbook_version_id: preview.version_id,
        resulting_mission_id: readyMission.id,
        actor_id: params.principal.user_id,
        event_type: "playbook.instantiated",
        payload: {
          playbook_slug: playbook.slug,
          version_number: preview.version_number,
          resulting_mission_id: readyMission.id,
          planned_budget: preview.planned_budget,
          included_tasks_count: createdTasks.length,
          excluded_tasks_count: preview.excluded_tasks.length,
          sanitized_variables: preview.sanitized_variables
        }
      });

      const latestDetails = this.missionControl.getMissionDetails({
        principal: params.principal,
        mission_id: readyMission.id
      });

      return {
        instantiation,
        preview,
        mission: latestDetails.mission,
        tasks: latestDetails.tasks,
        mission_url: `/kosmora-workspace/missions?mission_id=${encodeURIComponent(readyMission.id)}`
      };
    });
  }

  public getInstantiationForMission(params: {
    principal: TenantPrincipal;
    mission_id: string;
  }): PlaybookInstantiation | null {
    const row = this.store.getPlaybookInstantiationByMissionId(
      params.mission_id
    );
    if (!row) return null;
    if (row.tenant_id !== params.principal.tenant_id) {
      throw new PlaybookAccessDeniedError(
        `Cross-tenant access denied for mission instantiation '${params.mission_id}'.`
      );
    }
    return this.rowToInstantiation(row);
  }
}
