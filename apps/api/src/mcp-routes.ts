import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type } from "typebox";
import { parseConnectorDescriptor, type IdentityContext } from "@cosmora/contracts";
import type { EmergencyStopStore, ProjectStore } from "@cosmora/db";
import { connectorToolId, type ConnectorRegistry } from "@cosmora/tool-runtime";
import type { McpDiscovery } from "./mcp-discovery.js";

const descriptor = parseConnectorDescriptor({
  id: "mcp",
  version: 1,
  app: "MCP",
  implementation: "apps/api/src/mcp-discovery.ts",
  auth_kind: "server.token",
  state: "not_connected",
  operations: [
    {
      id: "discover",
      kind: "read",
      summary: "Read the configured MCP server tool names",
      capability_ids: ["integration.private.use"],
      result_checks: ["fresh_observation"]
    }
  ]
});

export interface McpRouteDependencies {
  pilot?: McpDiscovery | undefined;
  projects?: ProjectStore | undefined;
  stop?: EmergencyStopStore | undefined;
  origin: string;
  ownerActive: (ownerId: string) => boolean;
  identityFor: (request: FastifyRequest) => IdentityContext;
}

export function registerMcpRoutes(
  app: FastifyInstance,
  registry: ConnectorRegistry | undefined,
  dependencies: McpRouteDependencies
) {
  const { pilot, projects, stop, identityFor } = dependencies;
  const origin = new URL(dependencies.origin).origin;
  const toolId = connectorToolId(descriptor.id, "discover");
  const configured = Boolean(pilot && registry && projects && stop);
  const stopped = (project: string, owner: string) =>
    !dependencies.ownerActive(owner) || Boolean(stop?.getBlockingStop(project, owner));
  if (registry && pilot && configured) {
    registry.register([descriptor]);
    registry.bindTransport(toolId, {
      async execute() {
        if (stopped(pilot.projectId, pilot.ownerId)) throw new Error("MCP_STOPPED");
        const result = await pilot.discover();
        if (stopped(pilot.projectId, pilot.ownerId)) throw new Error("MCP_STOPPED");
        return result;
      }
    });
  }

  type Params = { projectId: string };
  const params = Type.Object({ projectId: Type.String({ minLength: 1, maxLength: 128 }) });
  const path = "/api/v1/projects/:projectId/integrations/mcp";
  const owned = (request: FastifyRequest<{ Params: Params }>) => {
    const identity = identityFor(request);
    return identity.actor_kind === "owner" &&
      projects?.getProject(request.params.projectId, identity.owner_id)
      ? identity
      : null;
  };
  const enabled = (project: string, owner: string) =>
    configured && project === pilot?.projectId && owner === pilot.ownerId;

  app.get<{ Params: Params }>(path, { schema: { params } }, (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const identity = owned(request);
    if (!identity) return reply.code(404).send({ error: { code: "PROJECT_NOT_FOUND" } });
    const project = request.params.projectId;
    return {
      configured: enabled(project, identity.owner_id),
      stopped: stopped(project, identity.owner_id)
    };
  });
  app.post<{ Params: Params; Body: { request_id: string } }>(
    path + "/discover",
    {
      bodyLimit: 1024,
      schema: {
        params,
        body: Type.Object(
          {
            request_id: Type.String({ pattern: "^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$" })
          },
          { additionalProperties: false }
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
      if (!pilot || !registry || !enabled(project, identity.owner_id))
        return reply.code(503).send({ error: { code: "MCP_UNAVAILABLE" } });
      if (stopped(project, identity.owner_id))
        return reply.code(409).send({ error: { code: "MCP_STOPPED" } });
      const result = await registry.invoke<null, Awaited<ReturnType<McpDiscovery["discover"]>>>({
        toolId,
        projectId: project,
        actorId: identity.actor_id,
        objectIds: [project, "mcp:" + pilot.revision],
        purpose: "Read configured MCP tool catalog",
        idempotencyKey: `mcp:${pilot.revision}:${request.body.request_id}`,
        input: null
      });
      if (stopped(project, identity.owner_id))
        return reply.code(409).send({ error: { code: "MCP_STOPPED" } });
      if (result.status === "EXECUTED")
        return {
          status: result.status,
          ...result.result,
          operation_id: result.verdict.operation_id
        };
      if (result.status === "WAITING_CONFIRMATION")
        return { status: result.status, operation_id: result.verdict.operation_id };
      return reply.code(result.status === "DENIED" ? 403 : 409).send({
        status: result.status,
        operation_id: result.verdict.operation_id
      });
    }
  );
}
