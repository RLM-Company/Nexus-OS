import { TypeBoxValidatorCompiler, type TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import {
  IntelligenceGraphWorkspaceError,
  type IntelligenceGraphWorkspaceService
} from "@cosmora/core";
import { IntelligenceGraphPrivacyError, type ProjectStore } from "@cosmora/db";
import { Type } from "typebox";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { canAccessOwnerApi, type RequestIdentityResolver } from "./identity.js";

const Id = Type.String({ minLength: 1, maxLength: 128 });
const Ref = Type.Object(
  { id: Id, version: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false }
);
const Scope = Type.Object({ projectId: Id }, { additionalProperties: false });
const GraphScope = Type.Object({ projectId: Id, graphId: Id }, { additionalProperties: false });
const Revision = Type.Integer({ minimum: 1 });
const Edit = Type.Union([
  Type.Object(
    {
      kind: Type.Literal("cite_edge"),
      edge_id: Id,
      source: Ref,
      location: Type.String({ minLength: 1, maxLength: 256 }),
      excerpt: Type.String({ minLength: 1, maxLength: 1000 })
    },
    { additionalProperties: false }
  ),
  Type.Object(
    { kind: Type.Literal("clear_edge_evidence"), edge_id: Id },
    { additionalProperties: false }
  ),
  Type.Object(
    { kind: Type.Literal("rename"), title: Type.String({ minLength: 1, maxLength: 80 }) },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      kind: Type.Literal("revise_node"),
      node: Ref,
      label: Type.String({ minLength: 1, maxLength: 120 }),
      detail: Type.String({ minLength: 1, maxLength: 1000 })
    },
    { additionalProperties: false }
  ),
  Type.Object({ kind: Type.Literal("remove_node"), node: Ref }, { additionalProperties: false }),
  Type.Object(
    {
      kind: Type.Literal("add_node"),
      node_kind: Type.Union(
        ["Claim", "Entity", "Source", "Document", "Decision", "Goal", "Task"].map((kind) =>
          Type.Literal(kind)
        )
      ),
      label: Type.String({ minLength: 1, maxLength: 120 }),
      detail: Type.String({ minLength: 1, maxLength: 1000 })
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      kind: Type.Literal("add_edge"),
      relation: Type.Union(
        ["SUPPORTS", "CONTRADICTS", "DEPENDS_ON", "IMPLEMENTS", "REFERENCES"].map((relation) =>
          Type.Literal(relation)
        )
      ),
      from: Ref,
      to: Ref
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      kind: Type.Literal("revise_edge"),
      edge_id: Id,
      from: Ref,
      to: Ref
    },
    { additionalProperties: false }
  ),
  Type.Object({ kind: Type.Literal("remove_edge"), edge_id: Id }, { additionalProperties: false })
]);

export interface GraphWorkspaceRouteDependencies {
  /** Must remain OFF until managed migration and privacy lifecycle adapters are integrated. */
  enabled: boolean;
  service: IntelligenceGraphWorkspaceService;
  projects: Pick<ProjectStore, "getProject">;
  identity: RequestIdentityResolver;
}

const handleFailure = (reply: FastifyReply, error: unknown) => {
  if (error instanceof IntelligenceGraphPrivacyError)
    return reply
      .status(error.code === "GRAPH_OWNER_FENCED" ? 423 : 503)
      .send({ error: error.code });
  if (!(error instanceof IntelligenceGraphWorkspaceError)) throw error;
  const status = {
    BAD_INPUT: 400,
    NOT_FOUND: 404,
    REVISION_CONFLICT: 409,
    GRAPH_LIMIT: 413,
    IMPORT_KEY_CONFLICT: 409,
    IMPORT_DELETED: 410
  }[error.code];
  return reply.status(status).send({ error: error.code, message: error.message });
};

/**
 * Explicit feature-flagged registration. Authentication is independently
 * rechecked (no caller-supplied owner_id), and project existence is scoped.
 * Does not create database tables or perform background work.
 */
export const registerIntelligenceGraphWorkspaceRoutes = (
  app: FastifyInstance,
  dependencies: GraphWorkspaceRouteDependencies
): void => {
  if (!dependencies.enabled) return;
  // Fastify's default Ajv drops unknown body fields. Confine a strict
  // TypeBox validator to this plugin, never mutate the parent app's compiler.
  app.register((scoped, _options, done) => {
    const route = scoped.withTypeProvider<TypeBoxTypeProvider>();
    route.setValidatorCompiler(TypeBoxValidatorCompiler);

    const authenticate = async (
      request: FastifyRequest,
      reply: FastifyReply,
      projectId: string
    ) => {
      const actor = await dependencies.identity.resolve(request).catch(() => null);
      if (!actor || !canAccessOwnerApi(actor)) {
        reply.status(404).send({ error: "NOT_FOUND" });
        return null;
      }
      const project = dependencies.projects.getProject(projectId, actor.owner_id);
      if (!project || project.status !== "ACTIVE") {
        reply.status(404).send({ error: "NOT_FOUND" });
        return null;
      }
      return actor.owner_id;
    };

    route.get(
      "/api/v1/projects/:projectId/intelligence-graphs",
      {
        schema: {
          params: Scope,
          querystring: Type.Object(
            {
              limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, default: 20 }))
            },
            { additionalProperties: false }
          )
        }
      },
      async (request, reply) => {
        const owner = await authenticate(request, reply, request.params.projectId);
        if (!owner) return;
        try {
          return {
            items: dependencies.service.list(
              owner,
              request.params.projectId,
              request.query.limit ?? 20
            )
          };
        } catch (error) {
          return handleFailure(reply, error);
        }
      }
    );

    route.post(
      "/api/v1/projects/:projectId/intelligence-graphs",
      {
        schema: {
          params: Scope,
          body: Type.Object(
            { title: Type.String({ minLength: 1, maxLength: 80 }) },
            { additionalProperties: false }
          )
        }
      },
      async (request, reply) => {
        const owner = await authenticate(request, reply, request.params.projectId);
        if (!owner) return;
        try {
          const graph = dependencies.service.create(
            owner,
            request.params.projectId,
            request.body.title
          );
          return reply.status(201).send(graph);
        } catch (error) {
          return handleFailure(reply, error);
        }
      }
    );

    route.get(
      "/api/v1/projects/:projectId/intelligence-graphs/:graphId",
      {
        schema: { params: GraphScope }
      },
      async (request, reply) => {
        const owner = await authenticate(request, reply, request.params.projectId);
        if (!owner) return;
        try {
          return dependencies.service.get(owner, request.params.projectId, request.params.graphId);
        } catch (error) {
          return handleFailure(reply, error);
        }
      }
    );

    route.get(
      "/api/v1/projects/:projectId/intelligence-graphs/:graphId/revisions",
      {
        schema: {
          params: GraphScope,
          querystring: Type.Object(
            {
              limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, default: 20 }))
            },
            { additionalProperties: false }
          )
        }
      },
      async (request, reply) => {
        const owner = await authenticate(request, reply, request.params.projectId);
        if (!owner) return;
        try {
          return {
            items: dependencies.service.revisions(
              owner,
              request.params.projectId,
              request.params.graphId,
              request.query.limit ?? 20
            )
          };
        } catch (error) {
          return handleFailure(reply, error);
        }
      }
    );

    route.get(
      "/api/v1/projects/:projectId/intelligence-graphs/:graphId/revisions/:revision",
      {
        schema: {
          params: Type.Object(
            { projectId: Id, graphId: Id, revision: Revision },
            { additionalProperties: false }
          )
        }
      },
      async (request, reply) => {
        const owner = await authenticate(request, reply, request.params.projectId);
        if (!owner) return;
        try {
          return dependencies.service.revision(
            owner,
            request.params.projectId,
            request.params.graphId,
            request.params.revision
          );
        } catch (error) {
          return handleFailure(reply, error);
        }
      }
    );

    route.get(
      "/api/v1/projects/:projectId/intelligence-graphs/:graphId/package",
      {
        schema: {
          params: GraphScope,
          querystring: Type.Object(
            { revision: Type.Optional(Revision) },
            { additionalProperties: false }
          )
        }
      },
      async (request, reply) => {
        const owner = await authenticate(request, reply, request.params.projectId);
        if (!owner) return;
        try {
          return reply
            .header("Cache-Control", "no-store")
            .send(
              dependencies.service.exportPackage(
                owner,
                request.params.projectId,
                request.params.graphId,
                request.query.revision
              )
            );
        } catch (error) {
          return handleFailure(reply, error);
        }
      }
    );

    route.post(
      "/api/v1/projects/:projectId/intelligence-graphs/import/preview",
      {
        bodyLimit: 850_000,
        schema: {
          params: Scope,
          body: Type.Object({ package: Type.Unknown() }, { additionalProperties: false })
        }
      },
      async (request, reply) => {
        const owner = await authenticate(request, reply, request.params.projectId);
        if (!owner) return;
        try {
          return reply
            .header("Cache-Control", "no-store")
            .send(dependencies.service.previewImport(request.body.package));
        } catch (error) {
          return handleFailure(reply, error);
        }
      }
    );

    route.post(
      "/api/v1/projects/:projectId/intelligence-graphs/import",
      {
        bodyLimit: 850_000,
        schema: {
          params: Scope,
          body: Type.Object(
            {
              package: Type.Unknown(),
              expected_sha256: Type.String({ pattern: "^[a-f0-9]{64}$" }),
              creation_key: Type.Optional(Type.String({ pattern: "^[A-Za-z0-9_-]{16,128}$" }))
            },
            { additionalProperties: false }
          )
        }
      },
      async (request, reply) => {
        const owner = await authenticate(request, reply, request.params.projectId);
        if (!owner) return;
        try {
          return reply
            .status(201)
            .send(
              dependencies.service.importPackage(
                owner,
                request.params.projectId,
                request.body.package,
                request.body.expected_sha256,
                request.body.creation_key
              )
            );
        } catch (error) {
          return handleFailure(reply, error);
        }
      }
    );

    route.get(
      "/api/v1/projects/:projectId/intelligence-graphs/imports/:creationKey",
      {
        schema: {
          params: Type.Object(
            { projectId: Id, creationKey: Type.String({ pattern: "^[A-Za-z0-9_-]{16,128}$" }) },
            { additionalProperties: false }
          )
        }
      },
      async (request, reply) => {
        const owner = await authenticate(request, reply, request.params.projectId);
        if (!owner) return;
        try {
          return reply
            .header("Cache-Control", "no-store")
            .send(
              dependencies.service.recoverImport(
                owner,
                request.params.projectId,
                request.params.creationKey
              )
            );
        } catch (error) {
          return handleFailure(reply, error);
        }
      }
    );

    route.post(
      "/api/v1/projects/:projectId/intelligence-graphs/:graphId/edits",
      {
        schema: {
          params: GraphScope,
          body: Type.Object(
            {
              expected_revision: Revision,
              operation: Edit
            },
            { additionalProperties: false }
          )
        }
      },
      async (request, reply) => {
        const owner = await authenticate(request, reply, request.params.projectId);
        if (!owner) return;
        try {
          return dependencies.service.edit(
            owner,
            request.params.projectId,
            request.params.graphId,
            request.body.expected_revision,
            request.body.operation
          );
        } catch (error) {
          return handleFailure(reply, error);
        }
      }
    );

    route.post(
      "/api/v1/projects/:projectId/intelligence-graphs/:graphId/restore",
      {
        schema: {
          params: GraphScope,
          body: Type.Object(
            {
              expected_revision: Revision,
              from_revision: Revision
            },
            { additionalProperties: false }
          )
        }
      },
      async (request, reply) => {
        const owner = await authenticate(request, reply, request.params.projectId);
        if (!owner) return;
        try {
          return dependencies.service.restore(
            owner,
            request.params.projectId,
            request.params.graphId,
            request.body.expected_revision,
            request.body.from_revision
          );
        } catch (error) {
          return handleFailure(reply, error);
        }
      }
    );

    route.get(
      "/api/v1/projects/:projectId/intelligence-graphs/:graphId/explain",
      {
        schema: {
          params: GraphScope,
          querystring: Type.Object(
            {
              q: Type.String({ minLength: 1, maxLength: 500 })
            },
            { additionalProperties: false }
          )
        }
      },
      async (request, reply) => {
        const owner = await authenticate(request, reply, request.params.projectId);
        if (!owner) return;
        try {
          return dependencies.service.explain(
            owner,
            request.params.projectId,
            request.params.graphId,
            request.query.q
          );
        } catch (error) {
          return handleFailure(reply, error);
        }
      }
    );
    done();
  });
};
