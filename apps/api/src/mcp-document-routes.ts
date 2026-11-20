import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type } from "typebox";
import {
  attachmentContextSize,
  isValidChatAttachments,
  parseConnectorDescriptor,
  type IdentityContext
} from "@cosmora/contracts";
import { IdempotencyConflictError, type ProjectStore } from "@cosmora/db";
import { connectorToolId, type ConnectorRegistry } from "@cosmora/tool-runtime";
import type { McpDiscovery } from "./mcp-discovery.js";

type Params = { projectId: string };
type Body = { request_id: string; preview_id?: string };
type Preview = { actor: string; text: string; version: number; expires: number; saved: boolean };
type ReadResult = { preview_id: string };
type SaveResult = { version: number } | { error: "MCP_MATERIALS_CHANGED" | "MCP_MATERIALS_LIMIT" };
const ttl = 5 * 60_000;
const uuid = Type.String({ pattern: "^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$" });

export function registerMcpDocumentRoutes(
  app: FastifyInstance,
  options: {
    path: string;
    origin: string;
    registry: ConnectorRegistry | undefined;
    pilot: McpDiscovery | undefined;
    projects: ProjectStore | undefined;
    owned: (request: FastifyRequest<{ Params: Params }>) => IdentityContext | null;
    enabled: (project: string, owner: string) => boolean;
    stopped: (project: string, owner: string) => boolean;
  }
) {
  const { pilot, registry, projects, owned, enabled, stopped, origin } = options;
  const document = pilot?.document;
  const previews = new Map<string, Preview>();
  function previewFor(id: string, actor: string) {
    const value = previews.get(id);
    if (value && value.expires <= Date.now()) {
      previews.delete(id);
      return;
    }
    if (value?.actor === actor) return value;
  }
  const read = connectorToolId("mcp-document", "preview");
  const save = connectorToolId("mcp-document", "save");
  if (pilot?.readDocument && document && registry && projects) {
    const readDocument = pilot.readDocument.bind(pilot);
    const { ownerId, projectId } = pilot;
    registry.register([
      parseConnectorDescriptor({
        id: "mcp-document",
        app: "MCP document",
        version: 1,
        implementation: "apps/api/src/mcp-document-routes.ts",
        auth_kind: "server.token",
        state: "not_connected",
        operations: [
          {
            id: "preview",
            kind: "read",
            summary: "Preview an approved MCP document",
            capability_ids: ["integration.private.use", "context.project.read"],
            result_checks: ["fresh_observation"]
          },
          {
            id: "save",
            kind: "write",
            summary: "Save the approved MCP document to project materials",
            capability_ids: ["integration.private.use", "workspace.write"],
            result_checks: ["version"]
          }
        ]
      })
    ]);
    registry.bindTransport(read, {
      async execute(_input, context): Promise<ReadResult> {
        if (stopped(projectId, ownerId)) throw new Error("MCP_STOPPED");
        const text = await readDocument();
        if (
          stopped(projectId, ownerId) ||
          !isValidChatAttachments([{ name: document.name, content: text }])
        )
          throw new Error("MCP_DOCUMENT_UNAVAILABLE");
        const materials = projects.getMaterials(projectId, ownerId);
        if (!materials) throw new Error("MCP_PROJECT_UNAVAILABLE");
        const previewId = randomUUID();
        for (const [id, value] of previews) if (value.expires <= Date.now()) previews.delete(id);
        const oldest = previews.keys().next();
        if (previews.size >= 16 && !oldest.done) previews.delete(oldest.value);
        previews.set(previewId, {
          actor: context.actorId,
          text,
          version: materials.version,
          expires: Date.now() + ttl,
          saved: false
        });
        return { preview_id: previewId };
      }
    });
    registry.bindTransport(save, {
      execute(input, context): Promise<SaveResult> {
        if (stopped(projectId, ownerId) || typeof input !== "string")
          throw new Error("MCP_STOPPED");
        const preview = previewFor(input, context.actorId);
        const materials = projects.getMaterials(projectId, ownerId);
        if (!preview || preview.saved || !materials || materials.version !== preview.version)
          return Promise.resolve({ error: "MCP_MATERIALS_CHANGED" });
        const attachments = [
          ...materials.attachments,
          { name: document.name, content: preview.text }
        ];
        if (
          !isValidChatAttachments(attachments) ||
          new TextEncoder().encode(materials.instructions).length +
            attachments.reduce((sum, attachment) => sum + attachmentContextSize(attachment), 0) >
            24000
        )
          return Promise.resolve({ error: "MCP_MATERIALS_LIMIT" });
        try {
          const saved = projects.setMaterials(projectId, ownerId, {
            version: preview.version,
            instructions: materials.instructions,
            attachments
          });
          if (!saved) return Promise.resolve({ error: "MCP_MATERIALS_CHANGED" });
          preview.saved = true;
          preview.text = "";
          return Promise.resolve({ version: saved.version });
        } catch (error) {
          if (error instanceof IdempotencyConflictError)
            return Promise.resolve({ error: "MCP_MATERIALS_CHANGED" });
          throw error;
        }
      }
    });
  }

  for (const mode of ["preview", "save"] as const) {
    app.post<{ Params: Params; Body: Body }>(
      options.path + "/document/" + mode,
      {
        bodyLimit: 1024,
        schema: {
          params: Type.Object({ projectId: Type.String({ minLength: 1, maxLength: 128 }) }),
          body: Type.Object(
            { request_id: uuid, ...(mode === "save" ? { preview_id: uuid } : {}) },
            {
              additionalProperties: false
            }
          )
        }
      },
      async (request, reply) => {
        reply.header("Cache-Control", "private, no-store");
        if (request.headers.origin !== origin)
          return reply.code(403).send({ error: { code: "MCP_ORIGIN_DENIED" } });
        const identity = owned(request);
        if (!identity) return reply.code(404).send({ error: { code: "PROJECT_NOT_FOUND" } });
        const project = request.params.projectId;
        if (
          !pilot?.readDocument ||
          !document ||
          !registry ||
          !projects ||
          !enabled(project, identity.owner_id)
        )
          return reply.code(503).send({ error: { code: "MCP_UNAVAILABLE" } });
        if (stopped(project, identity.owner_id))
          return reply.code(409).send({ error: { code: "MCP_STOPPED" } });
        const previewId = request.body.preview_id;
        const source = createHash("sha256").update(document.uri).digest("hex");
        const result = await registry.invoke<string | null, ReadResult | SaveResult>({
          toolId: mode === "preview" ? read : save,
          projectId: project,
          actorId: identity.actor_id,
          purpose:
            mode === "preview" ? "Preview approved MCP document" : "Import reviewed MCP document",
          objectIds: [project, "mcp:" + source, ...(previewId ? [previewId] : [])],
          idempotencyKey: `mcp:${pilot.revision}:${mode}:${request.body.request_id}`,
          input: previewId ?? null
        });
        if (stopped(project, identity.owner_id))
          return reply.code(409).send({ error: { code: "MCP_STOPPED" } });
        const operation = { status: result.status, operation_id: result.verdict.operation_id };
        if (result.status === "WAITING_CONFIRMATION") return operation;
        if (result.status !== "EXECUTED")
          return reply.code(result.status === "DENIED" ? 403 : 409).send(operation);
        if ("error" in result.result)
          return reply
            .code(409)
            .send({ error: { code: result.result.error }, operation_id: operation.operation_id });
        if ("preview_id" in result.result) {
          const pending = previewFor(result.result.preview_id, identity.actor_id);
          if (result.replayed || !pending || pending.saved)
            return reply.code(409).send({ error: { code: "MCP_PREVIEW_EXPIRED" } });
          return {
            ...operation,
            preview_id: result.result.preview_id,
            name: document.name,
            source: document.uri,
            text: pending.text
          };
        }
        return { ...operation, version: result.result.version };
      }
    );
  }
}
