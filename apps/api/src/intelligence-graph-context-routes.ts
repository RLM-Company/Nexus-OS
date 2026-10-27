import { TypeBoxValidatorCompiler, type TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { Type } from "typebox";
import {
  isValidChatAttachments,
  attachmentContextSize,
  type IntelligenceGraphContextPreview,
  type IntelligenceGraphContextState
} from "@cosmora/contracts";
import {
  graphContextFilename,
  graphContextAttachmentHash,
  IntelligenceGraphContextLimitError,
  IntelligenceGraphContextEmptyError,
  type IntelligenceGraphWorkspaceService
} from "@cosmora/core";
import {
  IdempotencyConflictError,
  ProjectMaterialsFencedError,
  type ProjectStore
} from "@cosmora/db";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { savedGraphContextStatus } from "./intelligence-graph-context-status.js";

export function registerIntelligenceGraphContextRoutes(
  app: FastifyInstance,
  dependencies: {
    service: IntelligenceGraphWorkspaceService;
    materials: Pick<ProjectStore, "getMaterials" | "setMaterials">;
    authenticate: (
      request: FastifyRequest,
      reply: FastifyReply,
      projectId: string
    ) => Promise<string | null>;
    failure: (reply: FastifyReply, error: unknown) => unknown;
  }
) {
  const route = app.withTypeProvider<TypeBoxTypeProvider>();
  route.setValidatorCompiler(TypeBoxValidatorCompiler);
  const Id = Type.String({ minLength: 1, maxLength: 128 });
  const params = Type.Object({ projectId: Id, graphId: Id }, { additionalProperties: false });
  const query = Type.Object(
    { q: Type.String({ minLength: 1, maxLength: 500 }), revision: Type.Integer({ minimum: 1 }) },
    { additionalProperties: false }
  );
  const hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
  const version = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
  const path = "/api/v1/projects/:projectId/intelligence-graphs/:graphId/context";
  const readMaterials = (project: string, owner: string) => {
    const current = dependencies.materials.getMaterials(project, owner);
    if (!current) throw new Error("Graph context materials disappeared");
    return current;
  };
  const state = (
    current: ReturnType<typeof readMaterials>,
    preview: IntelligenceGraphContextPreview
  ): IntelligenceGraphContextState => {
    const existing = current.attachments.find((f) => f.name === preview.attachment.name);
    const files = [
      ...current.attachments.filter((f) => f.name !== preview.attachment.name),
      preview.attachment
    ];
    const currentHash = existing ? graphContextAttachmentHash(existing) : null;
    return {
      materials_version: current.version,
      current_sha256: currentHash,
      already_applied: currentHash === preview.sha256,
      can_apply:
        currentHash !== preview.sha256 &&
        isValidChatAttachments(files) &&
        new TextEncoder().encode(current.instructions).length +
          files.reduce((n, f) => n + attachmentContextSize(f), 0) <=
          24000,
      retained_files: current.attachments
        .filter((f) => f.name !== preview.attachment.name)
        .map((f) => f.name)
    };
  };
  const failure = (reply: FastifyReply, error: unknown) => {
    if (error instanceof IntelligenceGraphContextEmptyError)
      return reply.code(422).send({ error: "GRAPH_CONTEXT_EMPTY" });
    if (error instanceof IntelligenceGraphContextLimitError)
      return reply.code(413).send({ error: "GRAPH_CONTEXT_LIMIT" });
    if (error instanceof IdempotencyConflictError)
      return reply.code(409).send({ error: "MATERIALS_CONFLICT" });
    if (error instanceof ProjectMaterialsFencedError)
      return reply.code(423).send({ error: "GRAPH_OWNER_FENCED" });
    return dependencies.failure(reply, error);
  };
  route.get(`${path}/status`, { schema: { params } }, async (request, reply) => {
    const owner = await dependencies.authenticate(request, reply, request.params.projectId);
    if (!owner) return;
    try {
      return reply
        .header("Cache-Control", "no-store")
        .send(
          savedGraphContextStatus(
            dependencies.service,
            owner,
            request.params.projectId,
            request.params.graphId,
            readMaterials(request.params.projectId, owner)
          )
        );
    } catch (error) {
      return failure(reply, error);
    }
  });
  route.get(path, { schema: { params, querystring: query } }, async (request, reply) => {
    const owner = await dependencies.authenticate(request, reply, request.params.projectId);
    if (!owner) return;
    try {
      const preview = dependencies.service.context(
        owner,
        request.params.projectId,
        request.params.graphId,
        request.query.q,
        request.query.revision
      );
      return reply.header("Cache-Control", "no-store").send({
        ...preview,
        state: state(readMaterials(request.params.projectId, owner), preview)
      });
    } catch (error) {
      return failure(reply, error);
    }
  });
  route.put(
    path,
    {
      schema: {
        params,
        body: Type.Object(
          {
            q: Type.String({ minLength: 1, maxLength: 500 }),
            revision: Type.Integer({ minimum: 1 }),
            expected_sha256: hash,
            expected_materials_version: version,
            reviewed: Type.Literal(true)
          },
          { additionalProperties: false }
        )
      }
    },
    async (request, reply) => {
      const owner = await dependencies.authenticate(request, reply, request.params.projectId);
      if (!owner) return;
      try {
        const preview = dependencies.service.context(
          owner,
          request.params.projectId,
          request.params.graphId,
          request.body.q,
          request.body.revision
        );
        if (preview.sha256 !== request.body.expected_sha256)
          return reply.code(400).send({ error: "CONTEXT_HASH_MISMATCH" });
        const current = readMaterials(request.params.projectId, owner),
          status = state(current, preview);
        // A lost response is recovered by GET, never by implicitly replaying this write.
        if (current.version !== request.body.expected_materials_version)
          return reply.code(409).send({ error: "MATERIALS_CONFLICT" });
        if (status.already_applied)
          return reply
            .header("Cache-Control", "no-store")
            .send({ sha256: preview.sha256, state: status });
        if (!status.can_apply) return reply.code(413).send({ error: "PROJECT_MATERIAL_LIMIT" });
        const saved = dependencies.materials.setMaterials(request.params.projectId, owner, {
          version: current.version,
          instructions: current.instructions,
          attachments: [
            ...current.attachments.filter((f) => f.name !== preview.attachment.name),
            preview.attachment
          ]
        });
        if (!saved) return reply.code(404).send({ error: "NOT_FOUND" });
        return reply
          .header("Cache-Control", "no-store")
          .send({ sha256: preview.sha256, state: state(saved, preview) });
      } catch (error) {
        return failure(reply, error);
      }
    }
  );
  route.delete(
    path,
    {
      schema: {
        params,
        body: Type.Object(
          { expected_sha256: hash, expected_materials_version: version },
          { additionalProperties: false }
        )
      }
    },
    async (request, reply) => {
      const owner = await dependencies.authenticate(request, reply, request.params.projectId);
      if (!owner) return;
      try {
        dependencies.service.get(owner, request.params.projectId, request.params.graphId);
        const current = readMaterials(request.params.projectId, owner),
          name = graphContextFilename(request.params.graphId),
          existing = current.attachments.find((f) => f.name === name);
        if (
          current.version !== request.body.expected_materials_version ||
          !existing ||
          graphContextAttachmentHash(existing) !== request.body.expected_sha256
        )
          return reply.code(409).send({ error: "MATERIALS_CONFLICT" });
        const saved = dependencies.materials.setMaterials(request.params.projectId, owner, {
          version: current.version,
          instructions: current.instructions,
          attachments: current.attachments.filter((f) => f.name !== name)
        });
        if (!saved) return reply.code(404).send({ error: "NOT_FOUND" });
        return reply
          .header("Cache-Control", "no-store")
          .send({ materials_version: saved.version, removed: true });
      } catch (error) {
        return failure(reply, error);
      }
    }
  );
}
