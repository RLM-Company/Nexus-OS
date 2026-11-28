import { TypeBoxValidatorCompiler } from "@fastify/type-provider-typebox";
import {
  BusinessScenarioRunRequestSchema,
  type BusinessScenarioId,
  type BusinessScenarioRunRequest,
  type IdentityContext
} from "@cosmora/contracts";
import { runBusinessScenario } from "@cosmora/core";
import type { FastifyInstance, FastifyRequest } from "fastify";

/** Harness 2: additive, owner-gated route for the deterministic scenario runner.
 * No stores, network, model or host access — the pure core result is returned. */
export function registerBusinessScenarioRoutes(options: {
  app: FastifyInstance;
  identityFor: (request: FastifyRequest) => IdentityContext;
}): void {
  const { app, identityFor } = options;
  app.post<{ Body: BusinessScenarioRunRequest }>(
    "/api/v1/business-scenarios/run",
    {
      validatorCompiler: TypeBoxValidatorCompiler,
      schema: { body: BusinessScenarioRunRequestSchema }
    },
    (request, reply) => {
      identityFor(request); // owner gate at the app boundary; result is stateless
      reply.header("Cache-Control", "private, no-store");
      const { scenario_id, input } = request.body;
      return runBusinessScenario(scenario_id as BusinessScenarioId, input);
    }
  );
}
