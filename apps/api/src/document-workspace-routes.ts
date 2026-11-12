import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { IdentityContext } from "@cosmora/contracts";
import { Type } from "typebox";
import {
  OfficeCursorSchema,
  DRIVE_OFFICE_FILE_MAX_NAME,
  type OfficeCursor,
  OfficeOperationsSchema,
  OfficeVersionSchema,
  type OfficeOperation
} from "@cosmora/contracts";
import { TypeBoxValidatorCompiler } from "@fastify/type-provider-typebox";
const require = createRequire(import.meta.url);
const enginePath = existsSync(new URL("./document-workspace/office-edit.cjs", import.meta.url))
  ? new URL("./document-workspace/office-edit.cjs", import.meta.url)
  : new URL("../../../desktop/windows/workspace/office-edit.cjs", import.meta.url);
type View = { version: string; sha256: string; targets: unknown[]; representation: unknown };
type Edited = {
  buffer: Buffer;
  diff: unknown[];
  version: string;
  sha256: string;
  representation: unknown;
};
const engine = require(fileURLToPath(enginePath)) as {
  inspectOffice: (
    name: string,
    bytes: Buffer,
    options?: { cursor?: OfficeCursor; expectedVersion?: string | null }
  ) => View;
  editOffice: (name: string, bytes: Buffer, operations: OfficeOperation[]) => Edited;
};
// Stateless web adapter: explicitly selected File bytes only, exported copy, no new store.
// Native workspace transactions remain responsible for live filesystem version conflicts.
export function registerDocumentWorkspaceRoutes(
  app: FastifyInstance,
  identityFor: (request: FastifyRequest) => IdentityContext
) {
  const key = randomBytes(32);
  const common = {
    name: Type.String({
      minLength: 1,
      maxLength: DRIVE_OFFICE_FILE_MAX_NAME,
      pattern: "^[^/\\\\]+\\.([dD][oO][cC][xX]|[xX][lL][sS][xX]|[pP][pP][tT][xX])$"
    }),
    bytes: Type.String({ minLength: 4, maxLength: 2796204, pattern: "^[A-Za-z0-9+/]+={0,2}$" })
  };
  type Input = {
    name: string;
    bytes: string;
    cursor?: OfficeCursor;
    expected_version: string | null;
    operations: OfficeOperation[];
    expires?: number;
    preview_token?: string;
  };
  const signature = (owner: string, body: Input, version: string) =>
    createHmac("sha256", key)
      .update(JSON.stringify([owner, body.name, version, body.operations, body.expires]))
      .digest("hex");
  const handle = (
    request: FastifyRequest,
    reply: {
      code: (n: number) => { send: (v: unknown) => unknown };
      header: (k: string, v: string) => unknown;
    },
    body: Input,
    mode: string
  ) => {
    reply.header("Cache-Control", "private, no-store");
    try {
      const bytes = Buffer.from(body.bytes, "base64");
      if (bytes.length > 2 * 1024 * 1024 || bytes.toString("base64") !== body.bytes)
        return reply.code(400).send({ error: { code: "INVALID_FILE" } });
      const opened = engine.inspectOffice(
        body.name,
        bytes,
        mode === "inspect"
          ? {
              ...(body.cursor ? { cursor: body.cursor } : {}),
              expectedVersion: body.expected_version ?? null
            }
          : undefined
      );
      if (mode === "inspect") return opened;
      if (opened.version !== body.expected_version)
        return reply.code(409).send({ error: { code: "VERSION_CONFLICT" } });
      const owner = identityFor(request).owner_id;
      if (mode === "commit") {
        const token = body.preview_token ?? "",
          expected = signature(owner, body, opened.version);
        if (
          !body.expires ||
          body.expires < Date.now() ||
          body.expires > Date.now() + 600_000 ||
          !/^[a-f0-9]{64}$/.test(token) ||
          !timingSafeEqual(Buffer.from(token), Buffer.from(expected))
        )
          return reply.code(409).send({ error: { code: "PREVIEW_EXPIRED" } });
      }
      const edited = engine.editOffice(body.name, bytes, body.operations);
      const readback = engine.inspectOffice(body.name, edited.buffer);
      const receipt = {
        source_version: opened.version,
        version: edited.version,
        sha256: edited.sha256,
        diff: edited.diff,
        rejected_changes: [],
        representation: edited.representation
      };
      if (mode === "preview") {
        const expires = Date.now() + 600_000;
        return {
          ...receipt,
          expires,
          preview_token: signature(owner, { ...body, expires }, opened.version)
        };
      }
      return { ...receipt, bytes: edited.buffer.toString("base64"), readback };
    } catch (error) {
      if (error instanceof Error && error.message === "WORKSPACE_OFFICE_VERSION_CONFLICT")
        return reply.code(409).send({ error: { code: "VERSION_CONFLICT" } });
      return reply.code(422).send({ error: { code: "OFFICE_UNSUPPORTED_OR_INVALID" } });
    }
  };
  for (const mode of ["inspect", "preview", "commit"]) {
    const properties =
      mode === "inspect"
        ? {
            ...common,
            cursor: Type.Optional(OfficeCursorSchema),
            expected_version: Type.Optional(Type.Union([Type.Null(), OfficeVersionSchema]))
          }
        : {
            ...common,
            expected_version: OfficeVersionSchema,
            operations: OfficeOperationsSchema,
            ...(mode === "commit"
              ? {
                  expires: Type.Integer(),
                  preview_token: Type.String({ pattern: "^[a-f0-9]{64}$" })
                }
              : {})
          };
    app.post<{ Body: Input }>(
      `/api/v1/document-workspace/${mode}`,
      {
        bodyLimit: 2_850_000,
        validatorCompiler: TypeBoxValidatorCompiler,
        schema: { body: Type.Object(properties, { additionalProperties: false }) }
      },
      (request, reply) => handle(request, reply, request.body, mode)
    );
  }
}
