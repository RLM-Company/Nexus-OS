import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { ServerConfig } from "@nexus/config";
import { HealthResponseSchema, type HealthResponse } from "@nexus/contracts";
import type { DatabaseHealth } from "@nexus/db";
import Fastify, { type FastifyInstance } from "fastify";

export interface AppDependencies {
  config: ServerConfig;
  database: DatabaseHealth;
  closeDatabase?: () => void;
}

export const buildApp = (dependencies: AppDependencies): FastifyInstance => {
  const app = Fastify({
    logger:
      dependencies.config.nodeEnv === "test"
        ? false
        : {
            level: dependencies.config.logLevel,
            redact: ["req.headers.authorization", "req.headers.cookie"]
          }
  }).withTypeProvider<TypeBoxTypeProvider>();

  app.get(
    "/api/v1/health",
    {
      schema: {
        response: {
          200: HealthResponseSchema,
          503: HealthResponseSchema
        }
      }
    },
    async (_request, reply) => {
      let database: HealthResponse["database"] = "ok";

      try {
        dependencies.database.ping();
      } catch {
        database = "error";
      }

      const response: HealthResponse = {
        status: database === "ok" ? "ok" : "degraded",
        version: "0.1.0",
        database,
        timestamp: new Date().toISOString()
      };

      return reply.status(database === "ok" ? 200 : 503).send(response);
    }
  );

  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send({
      error: {
        code: "ROUTE_NOT_FOUND",
        message: "Route not found",
        request_id: request.id,
        retryable: false
      }
    })
  );

  if (dependencies.closeDatabase) {
    app.addHook("onClose", () => {
      dependencies.closeDatabase?.();
    });
  }

  return app;
};
