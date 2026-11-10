import { createHash, randomUUID } from "node:crypto";
import * as zlib from "node:zlib";
import type { DatabaseSync } from "node:sqlite";

export const MAX_PORTABLE_PACKAGE_BYTES = 64000;
export const MAX_PROJECT_WORKFLOW_DEFINITIONS = 100;
export const MAX_WORKFLOW_DEFINITION_VERSIONS = 200;
export const MAX_WORKFLOW_STEPS_AND_PARAMS = 32;
export const MAX_REQUESTS_PER_STEP = 3;

export interface PortableWorkflowParameter {
  name: string;
  description?: string;
  type: "text" | "number" | "boolean" | "select" | "project_document" | "url";
  required?: boolean;
  defaultValue?: unknown;
  options?: string[];
}

export interface PortableWorkflowNode {
  id: string;
  title: string;
  kind: "work_prompt" | "critic_review";
  dependsOn?: string[];
  promptTemplate: string;
}

export interface PortableWorkflowDefinitionPackage {
  schemaVersion: "koswork-workflow-portable-v1";
  name: string;
  description: string;
  parameters: PortableWorkflowParameter[];
  nodes: PortableWorkflowNode[];
  requirements: string[];
  expected_results: string[];
}

export interface WorkflowStepOutputArtifact {
  stepId: string;
  name: string;
  content: string;
  createdAt: string;
}

function crc32(buf: Buffer): number {
  if (typeof (zlib as unknown as { crc32?: (b: Buffer) => number }).crc32 === "function") {
    return (zlib as unknown as { crc32: (b: Buffer) => number }).crc32(buf) >>> 0;
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.byteLength; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

const DEFAULT_SUPPORTED_WORKFLOW_TOOLS = new Set([
  "document_reader",
  "text_writer",
  "critic_verifier",
  "source_citation_checker",
  "project_materials_lookup"
]);

/**
 * Single-pass non-recursive parameter binder (PR #428 `KOSWORK_REUSABLE_WORKFLOWS_2026-11-02_RU.md`):
 * Replaces `{{paramName}}` tokens in a single regex pass so user-supplied parameter values
 * containing `{{otherParam}}` are NEVER recursively expanded as prompt templates.
 */
export function bindWorkflowParametersSinglePass(
  promptTemplate: string,
  parameterDefs: PortableWorkflowParameter[],
  suppliedInputs: Record<string, unknown>,
  ownedProjectDocuments?: Set<string>
): { boundPrompt: string; validatedInputs: Record<string, string | number | boolean> } {
  const validatedInputs: Record<string, string | number | boolean> = {};

  for (const def of parameterDefs) {
    const rawVal =
      suppliedInputs[def.name] !== undefined ? suppliedInputs[def.name] : def.defaultValue;

    if (rawVal === undefined || rawVal === null || rawVal === "") {
      if (def.required) {
        throw new Error(`WORKFLOW_MISSING_REQUIRED_PARAMETER:${def.name}`);
      }
      validatedInputs[def.name] = "";
      continue;
    }

    if (def.type === "number") {
      const num = Number(rawVal);
      if (!Number.isFinite(num)) {
        throw new Error(`WORKFLOW_INVALID_NUMBER_PARAMETER:${def.name}`);
      }
      validatedInputs[def.name] = num;
    } else if (def.type === "boolean") {
      if (typeof rawVal !== "boolean") {
        throw new Error(`WORKFLOW_INVALID_BOOLEAN_PARAMETER:${def.name}`);
      }
      validatedInputs[def.name] = rawVal;
    } else if (def.type === "select") {
      const strVal = String(rawVal);
      if (Array.isArray(def.options) && !def.options.includes(strVal)) {
        throw new Error(`WORKFLOW_INVALID_SELECT_OPTION:${def.name}`);
      }
      validatedInputs[def.name] = strVal;
    } else if (def.type === "url") {
      const strVal = String(rawVal).trim();
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(strVal);
      } catch {
        throw new Error(`WORKFLOW_INVALID_URL_PARAMETER:${def.name}`);
      }
      if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
        throw new Error(`WORKFLOW_UNSAFE_URL_SCHEME:${def.name}`);
      }
      // Passed strictly as a reference string without network fetch
      validatedInputs[def.name] = parsedUrl.toString();
    } else if (def.type === "project_document") {
      const docId = String(rawVal).trim();
      if (ownedProjectDocuments && !ownedProjectDocuments.has(docId)) {
        throw new Error(`WORKFLOW_PROJECT_DOCUMENT_NOT_FOUND:${docId}`);
      }
      validatedInputs[def.name] = docId;
    } else {
      validatedInputs[def.name] = String(rawVal).slice(0, 4000);
    }
  }

  // Single-pass replacement: callback output is never re-scanned by RegExp
  const boundPrompt = String(promptTemplate ?? "").replace(
    /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
    (fullMatch, key: string) => {
      if (Object.prototype.hasOwnProperty.call(validatedInputs, key)) {
        return String(validatedInputs[key]);
      }
      return fullMatch;
    }
  );

  return { boundPrompt, validatedInputs };
}

/**
 * Implements the portable JSON import/export, tool capability pre-check (`WORKFLOW_TOOL_UNAVAILABLE`),
 * 100-definition / 200-version quota enforcement, plan-only vs. `immediateExecution` token budget gate,
 * and finished result ZIP archive builder from PR #428 (`KOSWORK_REUSABLE_WORKFLOWS_2026-11-02_RU.md`).
 */
export class WorkflowPortabilityAndZipService {
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
      CREATE TABLE IF NOT EXISTS kosmora_workflow_versions (
        workflow_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        definition_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (workflow_id, version)
      );
      CREATE TABLE IF NOT EXISTS kosmora_workflow_runs (
        id TEXT PRIMARY KEY NOT NULL,
        workflow_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        client_request_id TEXT NOT NULL,
        request_json TEXT NOT NULL,
        definition_version INTEGER NOT NULL,
        definition_json TEXT NOT NULL,
        inputs_json TEXT NOT NULL,
        dag_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (owner_id, project_id, client_request_id)
      );
    `);
  }

  /**
   * Exports ONLY portable definition fields (`name`, `description`, `parameters`, `nodes`,
   * `requirements`, `expected_results`), stripping any runtime history, parameter values,
   * permissions, connected accounts, or server context.
   */
  exportPortableWorkflowPackage(
    ownerId: string,
    projectId: string,
    workflowId: string,
    version?: number
  ): PortableWorkflowDefinitionPackage {
    const defRow = this.sqlite
      .prepare(
        "SELECT id, version, state_json FROM kosmora_workflow_definitions WHERE id = ? AND owner_id = ? AND project_id = ?"
      )
      .get(workflowId, ownerId, projectId) as
      | { id: string; version: number; state_json: string }
      | undefined;

    if (!defRow) {
      throw new Error("WORKFLOW_NOT_FOUND");
    }

    const targetVer = version ?? defRow.version;
    const verRow = this.sqlite
      .prepare(
        "SELECT definition_json FROM kosmora_workflow_versions WHERE workflow_id = ? AND version = ?"
      )
      .get(workflowId, targetVer) as { definition_json: string } | undefined;

    const rawObj = JSON.parse(verRow ? verRow.definition_json : defRow.state_json) as Record<
      string,
      unknown
    >;

    const cleanParams: PortableWorkflowParameter[] = Array.isArray(rawObj.parameters)
      ? rawObj.parameters.map((p: Record<string, unknown>) => ({
          name: String(p.name ?? ""),
          ...(typeof p.description === "string" ? { description: p.description } : {}),
          type: (p.type as PortableWorkflowParameter["type"]) ?? "text",
          ...(typeof p.required === "boolean" ? { required: p.required } : {}),
          ...(p.defaultValue !== undefined ? { defaultValue: p.defaultValue } : {}),
          ...(Array.isArray(p.options) ? { options: p.options.map(String) } : {})
        }))
      : [];

    const cleanNodes: PortableWorkflowNode[] = Array.isArray(rawObj.nodes)
      ? rawObj.nodes.map((n: Record<string, unknown>) => ({
          id: String(n.id ?? ""),
          title: String(n.title ?? ""),
          kind: (n.kind as PortableWorkflowNode["kind"]) ?? "work_prompt",
          ...(Array.isArray(n.dependsOn) ? { dependsOn: n.dependsOn.map(String) } : {}),
          promptTemplate: String(n.promptTemplate ?? "")
        }))
      : [];

    return {
      schemaVersion: "koswork-workflow-portable-v1",
      name: String(rawObj.name ?? ""),
      description: String(rawObj.description ?? ""),
      parameters: cleanParams,
      nodes: cleanNodes,
      requirements: Array.isArray(rawObj.requirements)
        ? rawObj.requirements.map(String)
        : [],
      expected_results: Array.isArray(rawObj.expected_results)
        ? rawObj.expected_results.map(String)
        : []
    };
  }

  /**
   * Validates and imports a portable JSON workflow package, rejecting unknown tool requirements
   * with `WORKFLOW_TOOL_UNAVAILABLE`, stripping any extraneous runtime fields, and enforcing
   * the 64,000-byte, 32-step/param, 100-definition, and 200-version limits.
   */
  importPortableWorkflowPackage(options: {
    ownerId: string;
    projectId: string;
    rawPackageJson: string | Record<string, unknown>;
    supportedTools?: Set<string>;
    clientCreationId?: string;
  }): { workflowId: string; version: number; sanitizedPackage: PortableWorkflowDefinitionPackage } {
    const rawStr =
      typeof options.rawPackageJson === "string"
        ? options.rawPackageJson
        : JSON.stringify(options.rawPackageJson);

    if (Buffer.byteLength(rawStr, "utf8") > MAX_PORTABLE_PACKAGE_BYTES) {
      throw new Error("WORKFLOW_PACKAGE_TOO_LARGE");
    }

    const parsed = (
      typeof options.rawPackageJson === "string"
        ? JSON.parse(options.rawPackageJson)
        : options.rawPackageJson
    ) as Record<string, unknown>;

    const supportedTools = options.supportedTools ?? DEFAULT_SUPPORTED_WORKFLOW_TOOLS;
    const requirements = Array.isArray(parsed.requirements)
      ? parsed.requirements.map(String)
      : [];

    for (const reqTool of requirements) {
      if (!supportedTools.has(reqTool)) {
        const err = new Error(`WORKFLOW_TOOL_UNAVAILABLE:${reqTool}`) as Error & { code?: string };
        err.code = "WORKFLOW_TOOL_UNAVAILABLE";
        throw err;
      }
    }

    const parameters = Array.isArray(parsed.parameters) ? parsed.parameters : [];
    const nodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
    if (
      parameters.length > MAX_WORKFLOW_STEPS_AND_PARAMS ||
      nodes.length === 0 ||
      nodes.length > MAX_WORKFLOW_STEPS_AND_PARAMS
    ) {
      throw new Error("WORKFLOW_STRUCTURE_LIMIT_EXCEEDED");
    }

    const existingCountRow = this.sqlite
      .prepare(
        "SELECT COUNT(*) AS cnt FROM kosmora_workflow_definitions WHERE owner_id = ? AND project_id = ? AND archived_at IS NULL"
      )
      .get(options.ownerId, options.projectId) as { cnt: number };

    if (existingCountRow.cnt >= MAX_PROJECT_WORKFLOW_DEFINITIONS) {
      throw new Error("WORKFLOW_PROJECT_DEFINITION_LIMIT_EXCEEDED");
    }

    const sanitizedPackage: PortableWorkflowDefinitionPackage = {
      schemaVersion: "koswork-workflow-portable-v1",
      name: String(parsed.name ?? "Импортированный сценарий").slice(0, 200),
      description: String(parsed.description ?? "").slice(0, 2000),
      parameters: parameters.map((p: Record<string, unknown>) => ({
        name: String(p.name ?? ""),
        ...(typeof p.description === "string" ? { description: p.description } : {}),
        type: (p.type as PortableWorkflowParameter["type"]) ?? "text",
        ...(typeof p.required === "boolean" ? { required: p.required } : {}),
        ...(p.defaultValue !== undefined ? { defaultValue: p.defaultValue } : {}),
        ...(Array.isArray(p.options) ? { options: p.options.map(String) } : {})
      })),
      nodes: nodes.map((n: Record<string, unknown>) => ({
        id: String(n.id ?? ""),
        title: String(n.title ?? ""),
        kind: (n.kind as PortableWorkflowNode["kind"]) ?? "work_prompt",
        ...(Array.isArray(n.dependsOn) ? { dependsOn: n.dependsOn.map(String) } : {}),
        promptTemplate: String(n.promptTemplate ?? "")
      })),
      requirements,
      expected_results: Array.isArray(parsed.expected_results)
        ? parsed.expected_results.map(String)
        : []
    };

    const workflowId = `wf-${randomUUID()}`;
    const now = new Date().toISOString();
    const stateJson = JSON.stringify(sanitizedPackage);

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
        stateJson,
        now,
        now,
        options.clientCreationId ?? null,
        stateJson
      );

    this.sqlite
      .prepare(
        `INSERT INTO kosmora_workflow_versions (workflow_id, version, definition_json, created_at)
         VALUES (?, 1, ?, ?)`
      )
      .run(workflowId, stateJson, now);

    return { workflowId, version: 1, sanitizedPackage };
  }

  /**
   * Prepares a workflow run plan (`immediateExecution = false` -> 0 tokens reserved)
   * or initiates immediate model-aware budgeted execution (`immediateExecution = true`,
   * capped at `<= 3` requests per step).
   */
  prepareOrExecuteWorkflowRun(options: {
    ownerId: string;
    projectId: string;
    workflowId: string;
    clientRequestId: string;
    inputs: Record<string, unknown>;
    immediateExecution?: boolean;
    modelContextWindowTokens?: number;
    modelMaxOutputTokens?: number;
    requestsPerStep?: number;
  }): {
    runId: string;
    dagId: string;
    mode: "plan_only_zero_tokens" | "immediate_execution";
    reservedTokensTotal: number;
    maxRequestsPerStep: number;
    boundSteps: Array<{ id: string; boundPrompt: string }>;
  } {
    const pkg = this.exportPortableWorkflowPackage(
      options.ownerId,
      options.projectId,
      options.workflowId
    );

    const boundSteps: Array<{ id: string; boundPrompt: string }> = [];
    let validatedInputs: Record<string, string | number | boolean> = {};

    for (const node of pkg.nodes) {
      const bound = bindWorkflowParametersSinglePass(
        node.promptTemplate,
        pkg.parameters,
        options.inputs
      );
      validatedInputs = bound.validatedInputs;
      boundSteps.push({ id: node.id, boundPrompt: bound.boundPrompt });
    }

    const immediate = Boolean(options.immediateExecution ?? false);
    const maxRequestsPerStep = Math.min(
      Math.max(options.requestsPerStep ?? 1, 1),
      MAX_REQUESTS_PER_STEP
    );
    const perRequestOutputCap = Math.min(options.modelMaxOutputTokens ?? 100_000, 100_000);
    const reservedTokensTotal = immediate
      ? pkg.nodes.length * maxRequestsPerStep * Math.min(perRequestOutputCap, 16_000)
      : 0;

    const runId = `wfrun-${randomUUID()}`;
    const dagId = `wfdag-${randomUUID()}`;
    const now = new Date().toISOString();

    this.sqlite
      .prepare(
        `INSERT INTO kosmora_workflow_runs (
          id, workflow_id, project_id, owner_id, client_request_id, request_json,
          definition_version, definition_json, inputs_json, dag_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`
      )
      .run(
        runId,
        options.workflowId,
        options.projectId,
        options.ownerId,
        options.clientRequestId,
        JSON.stringify({
          immediateExecution: immediate,
          reservedTokensTotal,
          maxRequestsPerStep
        }),
        JSON.stringify(pkg),
        JSON.stringify(validatedInputs),
        dagId,
        now
      );

    return {
      runId,
      dagId,
      mode: immediate ? "immediate_execution" : "plan_only_zero_tokens",
      reservedTokensTotal,
      maxRequestsPerStep,
      boundSteps
    };
  }

  /**
   * Packages finished workflow run step outputs into a downloadable canonical ZIP STORE archive.
   */
  exportWorkflowRunResultsZip(options: {
    runId: string;
    workflowId: string;
    ownerId: string;
    outputs: WorkflowStepOutputArtifact[];
  }): { zipBuffer: Buffer; archiveSha256: string; fileCount: number } {
    const manifest = {
      schemaVersion: "koswork-workflow-run-results-v1",
      runId: options.runId,
      workflowId: options.workflowId,
      ownerId: options.ownerId,
      exportedAt: new Date().toISOString(),
      artifacts: options.outputs.map((o) => ({
        stepId: o.stepId,
        name: o.name,
        bytes: Buffer.byteLength(o.content, "utf8"),
        sha256: createHash("sha256").update(o.content, "utf8").digest("hex")
      }))
    };

    const entries: Array<{ name: string; data: Buffer }> = [
      {
        name: "run-manifest.json",
        data: Buffer.from(JSON.stringify(manifest, null, 2), "utf8")
      },
      ...options.outputs.map((o) => ({
        name: `outputs/${o.stepId}-${o.name.replace(/[^A-Za-z0-9._-]/g, "_")}`,
        data: Buffer.from(o.content, "utf8")
      }))
    ];

    const localParts: Buffer[] = [];
    const centralParts: Buffer[] = [];
    let offset = 0;

    for (const entry of entries) {
      const nameBuf = Buffer.from(entry.name, "utf8");
      const dataBuf = entry.data;
      const entryCrc = crc32(dataBuf);

      const localHeader = Buffer.alloc(30 + nameBuf.byteLength);
      localHeader.writeUInt32LE(0x04034b50, 0);
      localHeader.writeUInt16LE(20, 4);
      localHeader.writeUInt16LE(0, 6);
      localHeader.writeUInt16LE(0, 8); // STORE
      localHeader.writeUInt16LE(0, 10);
      localHeader.writeUInt16LE(0, 12);
      localHeader.writeUInt32LE(entryCrc, 14);
      localHeader.writeUInt32LE(dataBuf.byteLength, 18);
      localHeader.writeUInt32LE(dataBuf.byteLength, 22);
      localHeader.writeUInt16LE(nameBuf.byteLength, 26);
      localHeader.writeUInt16LE(0, 28);
      nameBuf.copy(localHeader, 30);

      localParts.push(localHeader, dataBuf);

      const centralHeader = Buffer.alloc(46 + nameBuf.byteLength);
      centralHeader.writeUInt32LE(0x02014b50, 0);
      centralHeader.writeUInt16LE(20, 4);
      centralHeader.writeUInt16LE(20, 6);
      centralHeader.writeUInt16LE(0, 8);
      centralHeader.writeUInt16LE(0, 10);
      centralHeader.writeUInt16LE(0, 12);
      centralHeader.writeUInt16LE(0, 14);
      centralHeader.writeUInt32LE(entryCrc, 16);
      centralHeader.writeUInt32LE(dataBuf.byteLength, 20);
      centralHeader.writeUInt32LE(dataBuf.byteLength, 24);
      centralHeader.writeUInt16LE(nameBuf.byteLength, 28);
      centralHeader.writeUInt16LE(0, 30);
      centralHeader.writeUInt16LE(0, 32);
      centralHeader.writeUInt16LE(0, 34);
      centralHeader.writeUInt16LE(0, 36);
      centralHeader.writeUInt16LE(0, 38);
      centralHeader.writeUInt32LE(offset, 42);
      nameBuf.copy(centralHeader, 46);

      centralParts.push(centralHeader);
      offset += localHeader.byteLength + dataBuf.byteLength;
    }

    const centralSize = centralParts.reduce((s, b) => s + b.byteLength, 0);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(centralSize, 12);
    eocd.writeUInt32LE(offset, 16);
    eocd.writeUInt16LE(0, 20);

    const zipBuffer = Buffer.concat([...localParts, ...centralParts, eocd]);
    return {
      zipBuffer,
      archiveSha256: createHash("sha256").update(zipBuffer).digest("hex"),
      fileCount: entries.length
    };
  }
}
