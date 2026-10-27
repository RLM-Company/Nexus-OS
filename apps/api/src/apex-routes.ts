import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type } from "typebox";
import { TypeBoxValidatorCompiler } from "@fastify/type-provider-typebox";
import type { IdentityContext } from "@cosmora/contracts";
import type { ProjectStore } from "@cosmora/db";
import { ApexInputSchemas, isApexAlgorithmId } from "@cosmora/contracts/apex";
import {
  APEX_CATALOG,
  ApexAdapterUnavailable,
  apexFeatureCatalog,
  executeApexAlgorithm
} from "@cosmora/core/apex";

/** Uses the current app's identity and project boundary. No second login or standalone server. */
export function registerApexRoutes(
  app: FastifyInstance,
  projects: ProjectStore,
  identityFor: (request: FastifyRequest) => IdentityContext
) {
  app.get("/api/v1/apex/features", (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    return {
      source: "PR390",
      features: apexFeatureCatalog().map((feature) => ({
        ...feature,
        ...(isApexAlgorithmId(feature.featureId)
          ? { input_schema: ApexInputSchemas[feature.featureId] }
          : {})
      })),
      claimed_product_functions: 0
    };
  });
  app.post<{ Params: { projectId: string; featureId: string }; Body: { input: unknown } }>(
    "/api/v1/projects/:projectId/apex/:featureId/execute",
    {
      bodyLimit: 128 * 1024,
      validatorCompiler: TypeBoxValidatorCompiler,
      schema: {
        params: Type.Object(
          {
            projectId: Type.String({ minLength: 1, maxLength: 128 }),
            featureId: Type.String({ pattern: "^F[0-9]{3}$" })
          },
          { additionalProperties: false }
        ),
        body: Type.Object({ input: Type.Unknown() }, { additionalProperties: false })
      }
    },
    (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const identity = identityFor(request);
      if (!projects.getProject(request.params.projectId, identity.owner_id))
        return reply.code(404).send({ error: { code: "PROJECT_NOT_FOUND" } });
      if (!APEX_CATALOG.some((feature) => feature.featureId === request.params.featureId))
        return reply.code(404).send({ error: { code: "APEX_FEATURE_NOT_FOUND" } });
      try {
        return executeApexAlgorithm(request.params.featureId, request.body.input);
      } catch (error) {
        if (error instanceof ApexAdapterUnavailable)
          return reply.code(501).send({ error: { code: error.code, feature_id: error.featureId } });
        if (
          error instanceof Error &&
          [
            "APEX_INVALID_INPUT",
            "APEX_NUMERIC_OVERFLOW",
            "INVALID_BYTECODE_INPUT",
            "INVALID_BYTECODE_OPCODE",
            "INVALID_BYTECODE_INSTRUCTION",
            "INVALID_BYTECODE_NUMBER",
            "INVALID_BYTECODE_SLOT"
          ].includes(error.message)
        )
          return reply.code(400).send({ error: { code: error.message } });
        throw error;
      }
    }
  );
}
