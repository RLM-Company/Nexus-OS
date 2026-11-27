import type { FastifyInstance } from "fastify";
import { Type } from "typebox";
import { ConnectorStatusSchema } from "@cosmora/contracts";
import type { PolicyStore } from "@cosmora/db";
import {
  ConnectorRegistry,
  connectorToolId,
  FIRST_SLICE_CONNECTORS,
  GuardedToolRuntime,
  type ConnectorTransport
} from "@cosmora/tool-runtime";
import { registerMcpRoutes, type McpRouteDependencies } from "./mcp-routes.js";
import { driveConnectorTransports } from "./drive-connector-transport.js";
import type { GoogleDriveRuntime } from "./cloud-storage/google-drive-runtime.js";
import type { GithubIntegration } from "./github-integration.js";
import { githubConnectorTransports } from "./github-connector-transport.js";

/** The general catalog lists descriptors. MCP uses its own project-scoped route. */
export function registerConnectorRoutes(
  app: FastifyInstance,
  policyStore: PolicyStore | undefined,
  projectId: string,
  mcp: McpRouteDependencies,
  drive?: GoogleDriveRuntime,
  http?: ConnectorTransport,
  github?: GithubIntegration
) {
  const runtime = policyStore ? new GuardedToolRuntime(policyStore) : undefined;
  const registry = runtime ? new ConnectorRegistry(runtime) : undefined;
  registry?.register(FIRST_SLICE_CONNECTORS);
  if (registry && drive) {
    const transports = driveConnectorTransports(drive);
    registry.bindTransport(
      connectorToolId("google-drive", "list_sources"),
      transports.list_sources
    );
    registry.bindTransport(
      connectorToolId("google-drive", "restore_backup"),
      transports.restore_backup
    );
  }
  if (http) registry?.bindTransport(connectorToolId("http-api", "call"), http);
  if (github)
    registry?.bindTransport(
      connectorToolId("github", "read_file"),
      githubConnectorTransports(github)
    );
  registerMcpRoutes(app, registry, { ...mcp, policy: policyStore });
  registry?.bindToRuntime();

  app.get<{ Querystring: { capabilities?: string } }>(
    "/api/v1/integrations/tools",
    {
      schema: {
        querystring: Type.Object({ capabilities: Type.Optional(Type.String({ maxLength: 1000 })) })
      }
    },
    (_request, reply) => {
      reply.header("Cache-Control", "no-store");
      const granted = (_request.query.capabilities ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      return {
        tools: registry?.availableTools(granted) ?? []
      };
    }
  );

  app.get(
    "/api/v1/integrations/status",
    {
      schema: { response: { 200: ConnectorStatusSchema } }
    },
    (_request, reply) => {
      reply.header("Cache-Control", "no-store");
      if (registry) {
        const status = registry.status(projectId);
        return {
          ...status,
          connectors: status.connectors.filter(({ id }) => id !== "mcp" && id !== "mcp-document")
        };
      }
      const connectors = FIRST_SLICE_CONNECTORS.map((descriptor) => ({
        id: descriptor.id,
        app: descriptor.app,
        state: descriptor.state,
        transport_wired: false,
        operations: descriptor.operations.length
      }));
      return { project_id: projectId, connectors };
    }
  );
}
