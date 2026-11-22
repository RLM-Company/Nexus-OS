import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type } from "typebox";
import {
  attachmentContextSize,
  isValidChatAttachments,
  parseConnectorDescriptor,
  type IdentityContext
} from "@cosmora/contracts";
import { IdempotencyConflictError, type PolicyStore, type ProjectStore } from "@cosmora/db";
import { connectorToolId, type ConnectorRegistry } from "@cosmora/tool-runtime";
import type { McpDiscovery } from "./mcp-discovery.js";

type Params = { projectId: string };
type RequestReference = { request_id: string; document_id?: string };
type Body = RequestReference & { preview_id?: string };
type Preview = {
  documentId: string;
  actor: string;
  text: string;
  version: number;
  expires: number;
  saved: boolean;
  copyName?: string;
};
type ReadResult = { preview_id: string };
type ImportDocument = { name: string; source: string; sha256: string };
type SaveResult =
  | { version: number; imported_document: ImportDocument }
  | { version: number; already_present: true; existing_name?: string }
  | { error: "MCP_DOCUMENT_NAME_CONFLICT"; copy_name: string }
  | { error: "MCP_MATERIALS_CHANGED" | "MCP_MATERIALS_LIMIT" | "MCP_COPY_NOT_OFFERED" };
type SaveInput = { previewId: string; documentId: string; asCopy: boolean };
const ttl = 5 * 60_000;
const uuid = Type.String({ pattern: "^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$" });
const documentIdSchema = Type.Optional(Type.String({ pattern: "^[a-f0-9]{32}$" }));
const documentSourceKey = (uri: string) => "mcp:" + createHash("sha256").update(uri).digest("hex");

function parseImportReceipt(
  value: unknown
): { version: number; imported_document: ImportDocument } | null {
  if (!value || typeof value !== "object") return null;
  const { version, imported_document } = value as Record<string, unknown>;
  if (
    typeof version !== "number" ||
    !Number.isSafeInteger(version) ||
    version < 1 ||
    !imported_document ||
    typeof imported_document !== "object"
  )
    return null;
  const { name, source, sha256 } = imported_document as Record<string, unknown>;
  if (
    typeof name !== "string" ||
    !name ||
    name.length > 100 ||
    typeof source !== "string" ||
    source.length > 512 ||
    typeof sha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(sha256)
  )
    return null;
  return { version, imported_document: { name, source, sha256 } };
}

export function registerMcpDocumentRoutes(
  app: FastifyInstance,
  options: {
    path: string;
    origin: string;
    registry: ConnectorRegistry | undefined;
    pilot: McpDiscovery | undefined;
    projects: ProjectStore | undefined;
    policy: PolicyStore | undefined;
    ownerActive: (owner: string) => boolean;
    owned: (request: FastifyRequest<{ Params: Params }>) => IdentityContext | null;
    enabled: (project: string, owner: string) => boolean;
    stopped: (project: string, owner: string) => boolean;
  }
) {
  const { pilot, registry, projects, policy, owned, enabled, stopped, origin } = options;
  const documents = pilot?.documents ?? [];
  const findDocument = (id: unknown) =>
    typeof id === "string"
      ? documents.find((document) => document.id === id)
      : documents.length === 1
        ? documents[0]
        : undefined;
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
  if (pilot?.readDocument && documents.length && registry && projects && policy) {
    const readDocument = pilot.readDocument;
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
      async execute(input, context): Promise<ReadResult> {
        const document = findDocument(input);
        if (!document) throw new Error("MCP_DOCUMENT_UNAVAILABLE");
        if (stopped(projectId, ownerId)) throw new Error("MCP_STOPPED");
        const text = await readDocument(document.id);
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
          documentId: document.id,
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
      mayCompleteInTransaction: true,
      execute(input, context): Promise<SaveResult> {
        if (stopped(projectId, ownerId) || !input || typeof input !== "object")
          throw new Error("MCP_STOPPED");
        const { previewId, documentId, asCopy } = input as SaveInput;
        const preview = previewFor(previewId, context.actorId);
        const document = findDocument(documentId);
        const materials = projects.getMaterials(projectId, ownerId);
        if (
          !document ||
          !preview ||
          preview.documentId !== document.id ||
          preview.saved ||
          !materials ||
          materials.version !== preview.version
        )
          return Promise.resolve({ error: "MCP_MATERIALS_CHANGED" });
        const name = asCopy ? preview.copyName : document.name;
        if (!name) return Promise.resolve({ error: "MCP_COPY_NOT_OFFERED" });
        const nameKey = name.toLowerCase();
        const sameName = materials.attachments.filter(
          (attachment) => attachment.name.toLowerCase() === nameKey
        );
        if (!asCopy) {
          const extensionAt = name.lastIndexOf(".");
          const copyPrefix = name.slice(0, extensionAt) + "-mcp-";
          const extension = name.slice(extensionAt);
          const copyKeyPrefix = copyPrefix.toLowerCase();
          const extensionKey = extension.toLowerCase();
          const originalMatches =
            sameName.length > 0 && sameName.every(({ content }) => content === preview.text);
          const existingCopy = originalMatches
            ? undefined
            : materials.attachments.find((file) => {
                if (file.content !== preview.text) return false;
                const key = file.name.toLowerCase();
                return (
                  key.startsWith(copyKeyPrefix) &&
                  key.endsWith(extensionKey) &&
                  /^[1-9][0-9]*$/u.test(key.slice(copyPrefix.length, -extension.length))
                );
              });
          if (originalMatches || existingCopy) {
            preview.saved = true;
            preview.text = "";
            return Promise.resolve({
              version: materials.version,
              already_present: true,
              ...(existingCopy ? { existing_name: existingCopy.name } : {})
            });
          }
          if (sameName.length > 0) {
            const occupied = new Set(materials.attachments.map((file) => file.name.toLowerCase()));
            let index = 1;
            let candidate: string;
            do {
              candidate = `${copyPrefix}${index++}${extension}`;
            } while (occupied.has(candidate.toLowerCase()));
            preview.copyName = candidate;
            return Promise.resolve({ error: "MCP_DOCUMENT_NAME_CONFLICT", copy_name: candidate });
          }
        }
        if (sameName.length > 0) return Promise.resolve({ error: "MCP_MATERIALS_CHANGED" });
        const attachments = [...materials.attachments, { name, content: preview.text }];
        if (
          !isValidChatAttachments(attachments) ||
          new TextEncoder().encode(materials.instructions).length +
            attachments.reduce((sum, attachment) => sum + attachmentContextSize(attachment), 0) >
            24000
        )
          return Promise.resolve({ error: "MCP_MATERIALS_LIMIT" });
        try {
          const imported_document = {
            name,
            source: document.uri,
            sha256: createHash("sha256").update(preview.text, "utf8").digest("hex")
          };
          const saved = projects.setMaterials(
            projectId,
            ownerId,
            { version: preview.version, instructions: materials.instructions, attachments },
            {
              policy,
              operationId: context.operationId,
              resultForVersion: (version) => ({ version, imported_document })
            }
          );
          if (!saved) return Promise.resolve({ error: "MCP_MATERIALS_CHANGED" });
          preview.saved = true;
          preview.text = "";
          return Promise.resolve({ version: saved.version, imported_document });
        } catch (error) {
          if (error instanceof IdempotencyConflictError)
            return Promise.resolve({ error: "MCP_MATERIALS_CHANGED" });
          throw error;
        }
      }
    });
  }

  app.get<{ Params: Params }>(
    options.path + "/document/imports",
    {
      schema: { params: Type.Object({ projectId: Type.String({ minLength: 1, maxLength: 128 }) }) }
    },
    (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      const identity = owned(request);
      if (!identity) return reply.code(404).send({ error: { code: "PROJECT_NOT_FOUND" } });
      if (!options.ownerActive(identity.owner_id))
        return reply.code(409).send({ error: { code: "OWNER_DATA_FENCED" } });
      const project = request.params.projectId;
      const materials = projects?.getMaterials(project, identity.owner_id);
      if (!materials || !options.policy)
        return reply.code(503).send({ error: { code: "MCP_IMPORT_HISTORY_UNAVAILABLE" } });
      const hashes = materials.attachments.map(({ name, content }) => ({
        name,
        digest: createHash("sha256").update(content, "utf8").digest("hex")
      }));
      const operations = options.policy.listMcpImportOperations(project);
      return {
        items: operations.flatMap(({ operation_id, updated_at, result }) => {
          const entry = parseImportReceipt(result);
          if (!entry) return [];
          const sameName = hashes.filter(({ name }) => name === entry.imported_document.name);
          const copy = sameName.some(({ digest }) => digest === entry.imported_document.sha256)
            ? "matched"
            : sameName.length
              ? "changed"
              : "missing";
          return [
            {
              operation_id,
              imported_at: updated_at,
              version: entry.version,
              copy,
              ...entry.imported_document
            }
          ];
        })
      };
    }
  );

  app.get<{ Params: Params; Querystring: RequestReference }>(
    options.path + "/document/status",
    {
      schema: {
        params: Type.Object({ projectId: Type.String({ minLength: 1, maxLength: 128 }) }),
        querystring: Type.Object({ request_id: uuid, document_id: documentIdSchema })
      }
    },
    (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      const identity = owned(request);
      if (!identity) return reply.code(404).send({ error: { code: "PROJECT_NOT_FOUND" } });
      if (!options.ownerActive(identity.owner_id))
        return reply.code(409).send({ error: { code: "OWNER_DATA_FENCED" } });
      const project = request.params.projectId;
      const document = findDocument(request.query.document_id);
      if (!pilot || !options.policy || !enabled(project, identity.owner_id) || !document)
        return { status: "UNKNOWN" };
      const stored = options.policy.getMcpSaveOperation(
        project,
        identity.actor_id,
        request.query.request_id
      );
      if (
        !stored ||
        stored === "AMBIGUOUS" ||
        !stored.intent.object_ids.includes(documentSourceKey(document.uri))
      )
        return { status: "UNKNOWN" };

      const operation_id = stored.operation_id;
      if (stored.status === "DENIED" || stored.status === "PAUSED")
        return { status: "NOT_SAVED", operation_id };
      if (stored.status !== "SUCCEEDED") return { status: "UNCONFIRMED", operation_id };

      const receipt = parseImportReceipt(stored.result);
      if (receipt)
        return {
          status: "EXECUTED",
          operation_id,
          version: receipt.version,
          copy_name: receipt.imported_document.name
        };
      const result = stored.result as Partial<{
        already_present: boolean;
        version: number;
        existing_name: string;
        error: string;
      }> | null;
      if (result?.already_present === true && Number.isSafeInteger(result.version))
        return {
          status: "EXECUTED",
          operation_id,
          version: result.version,
          already_present: true,
          existing_name: result.existing_name
        };
      return { status: result?.error ? "NOT_SAVED" : "UNCONFIRMED", operation_id };
    }
  );

  for (const mode of ["preview", "save", "save-copy"] as const) {
    const isPreview = mode === "preview";
    const asCopy = mode === "save-copy";
    app.post<{ Params: Params; Body: Body }>(
      options.path + "/document/" + mode,
      {
        bodyLimit: 1024,
        schema: {
          params: Type.Object({ projectId: Type.String({ minLength: 1, maxLength: 128 }) }),
          body: Type.Object(
            {
              request_id: uuid,
              document_id: documentIdSchema,
              ...(!isPreview ? { preview_id: uuid } : {})
            },
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
          !documents.length ||
          !registry ||
          !projects ||
          !enabled(project, identity.owner_id)
        )
          return reply.code(503).send({ error: { code: "MCP_UNAVAILABLE" } });
        if (stopped(project, identity.owner_id))
          return reply.code(409).send({ error: { code: "MCP_STOPPED" } });
        const document = findDocument(request.body.document_id);
        if (!document) return reply.code(404).send({ error: { code: "MCP_DOCUMENT_UNAVAILABLE" } });
        const previewId = request.body.preview_id;
        const idempotencyKey = `mcp:${pilot.revision}:${isPreview ? "preview" : "save"}:${request.body.request_id}`;
        if (!isPreview) {
          const earlier = policy?.getMcpSaveOperation(
            project,
            identity.actor_id,
            request.body.request_id
          );
          if (earlier && (earlier === "AMBIGUOUS" || earlier.idempotency_key !== idempotencyKey))
            return reply.code(409).send({ error: { code: "MCP_SAVE_CONFIGURATION_CHANGED" } });
        }
        const result = await registry.invoke<string | SaveInput, ReadResult | SaveResult>({
          toolId: isPreview ? read : save,
          projectId: project,
          actorId: identity.actor_id,
          purpose: isPreview
            ? "Preview approved MCP document"
            : asCopy
              ? "Import reviewed MCP document as a separate copy"
              : "Import reviewed MCP document",
          objectIds: [project, documentSourceKey(document.uri), ...(previewId ? [previewId] : [])],
          idempotencyKey,
          input: previewId ? { previewId, documentId: document.id, asCopy } : document.id
        });
        if (stopped(project, identity.owner_id))
          return reply.code(409).send({ error: { code: "MCP_STOPPED" } });
        const operation = { status: result.status, operation_id: result.verdict.operation_id };
        if (result.status === "WAITING_CONFIRMATION") return operation;
        if (result.status !== "EXECUTED")
          return reply.code(result.status === "DENIED" ? 403 : 409).send(operation);
        if ("error" in result.result)
          return reply.code(409).send({
            error: { code: result.result.error },
            operation_id: operation.operation_id,
            ...("copy_name" in result.result ? { copy_name: result.result.copy_name } : {})
          });
        if ("preview_id" in result.result) {
          const pending = previewFor(result.result.preview_id, identity.actor_id);
          if (result.replayed || !pending || pending.documentId !== document.id || pending.saved)
            return reply.code(409).send({ error: { code: "MCP_PREVIEW_EXPIRED" } });
          return {
            ...operation,
            preview_id: result.result.preview_id,
            name: document.name,
            source: document.uri,
            text: pending.text
          };
        }
        return {
          ...operation,
          version: result.result.version,
          ...("already_present" in result.result
            ? { already_present: true, existing_name: result.result.existing_name }
            : {}),
          ...(asCopy && "imported_document" in result.result
            ? { copy_name: result.result.imported_document.name }
            : {})
        };
      }
    );
  }
}
