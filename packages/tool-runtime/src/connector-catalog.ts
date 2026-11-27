import { parseConnectorDescriptor, type ConnectorDescriptor } from "@cosmora/contracts";

/**
 * Descriptor-only adapters for the first three vetted integrations.
 *
 * These are documentation of operations that already exist in the codebase;
 * they deliberately do NOT contain transports, tokens, endpoints or URLs. The
 * existing implementations keep owning their own auth and token stores:
 *  - GitHub: apps/api/src/github-integration.ts (+ issues/routes)
 *  - Google Drive: apps/api/src/cloud-storage/*
 *  - Office: computer-control workspace (native DOCX/XLSX/PPTX bytes)
 *
 * W05 (KOSMORA_KOSWORK_FEATURE_PROPOSAL_RU.md): first integrations are agreed
 * with the owner. Approved 2026-11-15: GitHub / Drive / Office, registry only,
 * no new device/data grants and no UI change.
 */

const github: ConnectorDescriptor = parseConnectorDescriptor({
  id: "github",
  version: 1,
  app: "GitHub",
  implementation: "apps/api/src/github-integration.ts",
  auth_kind: "server.token",
  state: "not_connected",
  operations: [
    {
      id: "read_file",
      kind: "read",
      summary: "Read a repository file inside the owner-bound workspace scope.",
      capability_ids: ["context.project.read", "integration.private.use"],
      result_checks: ["bytes.sha256", "fresh_observation"]
    },
    {
      id: "prepare_draft",
      kind: "write",
      summary: "Prepare a change and create a draft PR after owner confirmation.",
      capability_ids: ["workspace.write", "integration.private.use", "external.communicate"],
      result_checks: ["version", "fresh_observation"]
    }
  ]
});

const drive: ConnectorDescriptor = parseConnectorDescriptor({
  id: "google-drive",
  version: 1,
  app: "Google Drive",
  implementation: "apps/api/src/cloud-storage/google-drive-connection.ts",
  auth_kind: "oauth.pkce",
  state: "not_connected",
  operations: [
    {
      id: "list_sources",
      kind: "read",
      summary: "List permitted Drive sources for project context.",
      capability_ids: ["context.project.read", "integration.private.use"],
      result_checks: ["fresh_observation"]
    },
    {
      id: "restore_backup",
      kind: "write",
      summary: "Restore a permitted backup after an explicit owner decision.",
      capability_ids: ["workspace.write", "integration.private.use"],
      result_checks: ["bytes.sha256", "version"]
    }
  ]
});

const office: ConnectorDescriptor = parseConnectorDescriptor({
  id: "office",
  version: 1,
  app: "Office",
  implementation: "apps/api/src/computer-control/workspace",
  auth_kind: "computer.control",
  state: "not_connected",
  operations: [
    {
      id: "read_document",
      kind: "read",
      summary: "Read a permitted Office document from the workspace folder.",
      capability_ids: ["context.project.read", "integration.private.use"],
      result_checks: ["bytes.sha256", "fresh_observation"]
    },
    {
      id: "write_document",
      kind: "write",
      summary: "Create a native Office document and confirm the written bytes.",
      capability_ids: ["workspace.write", "integration.private.use"],
      result_checks: ["bytes.sha256", "version"]
    }
  ]
});

/** User-compatible HTTP API: descriptor only; transport is injected by the
 * server for an owner-approved base URL. No endpoint or credential is stored here. */
const httpApi: ConnectorDescriptor = parseConnectorDescriptor({
  id: "http-api",
  version: 1,
  app: "Compatible HTTP API",
  implementation: "packages/tool-runtime/src/http-connector.ts",
  auth_kind: "server.token",
  state: "not_connected",
  operations: [
    {
      id: "call",
      kind: "read",
      summary: "Call an allowlisted endpoint through the guarded runtime.",
      capability_ids: ["context.project.read", "integration.private.use"],
      result_checks: ["fresh_observation"]
    }
  ]
});

/** Frozen, validated first-slice catalog; never pretend a grant is connected. */
export const FIRST_SLICE_CONNECTORS: readonly ConnectorDescriptor[] = Object.freeze([
  github,
  drive,
  office,
  httpApi
]);
