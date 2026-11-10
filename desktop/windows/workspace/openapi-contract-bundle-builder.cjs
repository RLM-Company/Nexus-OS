"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function mapFieldTypeToJsonSchema(fieldType) {
  switch (fieldType) {
    case "integer":
      return { type: "integer" };
    case "number":
      return { type: "number" };
    case "boolean":
      return { type: "boolean" };
    default:
      return { type: "string" };
  }
}

function mapFieldTypeToTsType(fieldType) {
  switch (fieldType) {
    case "integer":
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    default:
      return "string";
  }
}

/**
 * Zero-dependency OpenAPI 3.1.0 Specification & TypeScript Contract Bundle Builder
 * for the Koswork Desktop Workspace.
 */
function buildOpenApiContractBundle(spec = {}) {
  const title = spec.title || "Kosmora Service API";
  const version = spec.version || "1.0.0";
  const endpoints = Array.isArray(spec.endpoints) ? spec.endpoints : [];

  const pathsObj = {};
  const tsInterfaces = [
    "// AUTO-GENERATED KOSWORK OPENAPI 3.1 CONTRACT TYPES",
    ""
  ];

  for (const ep of endpoints) {
    const routePath = ep.path || "/api/v1/resource";
    const method = String(ep.method || "get").toLowerCase();
    const operationId = ep.operationId || `${method}_${routePath.replace(/[^a-zA-Z0-9]/g, "_")}`;

    if (!pathsObj[routePath]) {
      pathsObj[routePath] = {};
    }

    const reqFields = ep.requestFields || {};
    const resFields = ep.responseFields || { ok: "boolean" };

    const reqProperties = {};
    const reqRequired = [];
    for (const [k, t] of Object.entries(reqFields)) {
      reqProperties[k] = mapFieldTypeToJsonSchema(t);
      reqRequired.push(k);
    }

    const resProperties = {};
    const resRequired = [];
    for (const [k, t] of Object.entries(resFields)) {
      resProperties[k] = mapFieldTypeToJsonSchema(t);
      resRequired.push(k);
    }

    const operationSpec = {
      operationId,
      summary: ep.summary || operationId,
      responses: {
        "200": {
          description: "Successful response",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: resProperties,
                required: resRequired,
                additionalProperties: false
              }
            }
          }
        }
      }
    };

    if (Object.keys(reqProperties).length > 0 && method !== "get") {
      operationSpec.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: reqProperties,
              required: reqRequired,
              additionalProperties: false
            }
          }
        }
      };
    }

    pathsObj[routePath][method] = operationSpec;

    const pascalName = operationId
      .split(/[^a-zA-Z0-9]+/)
      .filter(Boolean)
      .map((s) => s[0].toUpperCase() + s.slice(1))
      .join("");

    if (Object.keys(reqFields).length > 0) {
      tsInterfaces.push(`export interface ${pascalName}Request {`);
      for (const [k, t] of Object.entries(reqFields)) {
        tsInterfaces.push(`  ${k}: ${mapFieldTypeToTsType(t)};`);
      }
      tsInterfaces.push("}\n");
    }

    tsInterfaces.push(`export interface ${pascalName}Response {`);
    for (const [k, t] of Object.entries(resFields)) {
      tsInterfaces.push(`  ${k}: ${mapFieldTypeToTsType(t)};`);
    }
    tsInterfaces.push("}\n");
  }

  const openApiDoc = {
    openapi: "3.1.0",
    info: {
      title,
      version
    },
    paths: pathsObj
  };

  const openApiJson = JSON.stringify(openApiDoc, null, 2);
  const contractsDts = tsInterfaces.join("\n");

  return {
    openApiDoc,
    openApiJson,
    contractsDts
  };
}

function saveOpenApiBundleToWorkspace(workspaceDir, baseName, spec) {
  if (!workspaceDir || typeof workspaceDir !== "string") {
    throw new Error("WORKSPACE_REQUIRED");
  }
  const cleanBase = path
    .basename(baseName || "api-contract")
    .replace(/\.(json|ts)$/i, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_");
  const resolvedWorkspace = path.resolve(workspaceDir);
  const jsonPath = path.resolve(resolvedWorkspace, `${cleanBase}.openapi.json`);
  const dtsPath = path.resolve(resolvedWorkspace, `${cleanBase}.contracts.d.ts`);

  if (!jsonPath.startsWith(resolvedWorkspace + path.sep)) {
    throw new Error("PATH_TRAVERSAL_BLOCKED");
  }

  fs.mkdirSync(resolvedWorkspace, { recursive: true });
  const bundle = buildOpenApiContractBundle(spec);
  fs.writeFileSync(jsonPath, bundle.openApiJson, "utf8");
  fs.writeFileSync(dtsPath, bundle.contractsDts, "utf8");

  return {
    jsonPath,
    dtsPath,
    sha256: crypto.createHash("sha256").update(bundle.openApiJson, "utf8").digest("hex")
  };
}

module.exports = {
  buildOpenApiContractBundle,
  saveOpenApiBundleToWorkspace
};
