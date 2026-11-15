import type { FastifyInstance } from "fastify";
import { ConnectorStatusSchema } from "@cosmora/contracts";
import type { PolicyStore } from "@cosmora/db";
import {
  ConnectorRegistry,
  FIRST_SLICE_CONNECTORS,
  GuardedToolRuntime
} from "@cosmora/tool-runtime";

/**
 * Honest connector status for the owner boundary.
 *
 * The first slice ships descriptor-only adapters: no transport is wired, no
 * grant is connected, no credentials are stored or returned. A real runtime is
 * built when a PolicyStore exists so the registry is a genuine
 * GuardedToolRuntime-backed object, but nothing is invoked from this route.
 */
export function registerConnectorRoutes(
  app: FastifyInstance,
  policyStore: PolicyStore | undefined,
  projectId: string
) {
  const runtime = policyStore ? new GuardedToolRuntime(policyStore) : undefined;
  const registry = runtime ? new ConnectorRegistry(runtime) : undefined;
  if (registry) {
    registry.register(FIRST_SLICE_CONNECTORS);
    registry.bindToRuntime();
  }

  app.get(
    "/api/v1/integrations/status",
    {
      schema: { response: { 200: ConnectorStatusSchema } }
    },
    (_request, reply) => {
      reply.header("Cache-Control", "no-store");
      if (registry) return registry.status(projectId);
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
