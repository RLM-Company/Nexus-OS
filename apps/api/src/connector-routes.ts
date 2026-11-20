import type { FastifyInstance } from "fastify";
import { ConnectorStatusSchema } from "@cosmora/contracts";
import type { PolicyStore } from "@cosmora/db";
import {
  ConnectorRegistry,
  FIRST_SLICE_CONNECTORS,
  GuardedToolRuntime
} from "@cosmora/tool-runtime";
import { registerMcpRoutes, type McpRouteDependencies } from "./mcp-routes.js";

/** The general catalog lists descriptors. MCP uses its own project-scoped route. */
export function registerConnectorRoutes(
  app: FastifyInstance,
  policyStore: PolicyStore | undefined,
  projectId: string,
  mcp: McpRouteDependencies
) {
  const runtime = policyStore ? new GuardedToolRuntime(policyStore) : undefined;
  const registry = runtime ? new ConnectorRegistry(runtime) : undefined;
  registry?.register(FIRST_SLICE_CONNECTORS);
  registerMcpRoutes(app, registry, mcp);
  registry?.bindToRuntime();

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
