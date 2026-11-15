import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
  ConnectorDescriptorSchema,
  ConnectorStatusSchema,
  connectorOperationCapabilities,
  parseConnectorDescriptor,
  type ConnectorDescriptor
} from "../src/index.js";

const github: ConnectorDescriptor = {
  id: "github",
  version: 1,
  app: "GitHub",
  implementation: "apps/api/src/github-integration.ts",
  auth_kind: "server.token",
  state: "not_connected",
  operations: [
    {
      id: "read_file",
      kind: "read",
      summary: "Read a repository file.",
      capability_ids: ["context.project.read", "integration.private.use"],
      result_checks: ["bytes.sha256"]
    }
  ]
};

describe("Connector contract", () => {
  it("validates a descriptor without credentials", () => {
    expect(Value.Check(ConnectorDescriptorSchema, github)).toBe(true);
    expect(parseConnectorDescriptor(github)).toEqual(github);
  });

  it("refuses credentials, duplicate operations and unknown capabilities", () => {
    expect(() => parseConnectorDescriptor({ ...github, client_secret: "secret" })).toThrow(
      "INVALID_CONNECTOR_DESCRIPTOR"
    );
    expect(() =>
      parseConnectorDescriptor({
        ...github,
        operations: [github.operations[0]!, { ...github.operations[0]! }]
      })
    ).toThrow("DUPLICATE_CONNECTOR_OPERATION");
    expect(() =>
      parseConnectorDescriptor({
        ...github,
        operations: [{ ...github.operations[0]!, capability_ids: ["not.a.capability"] }]
      })
    ).toThrow("INVALID_CONNECTOR_DESCRIPTOR");
  });

  it("exposes per-operation capabilities and rejects unknown operations", () => {
    expect(connectorOperationCapabilities(github, "read_file")).toEqual([
      "context.project.read",
      "integration.private.use"
    ]);
    expect(() => connectorOperationCapabilities(github, "missing")).toThrow(
      "CONNECTOR_OPERATION_NOT_FOUND"
    );
  });

  it("keeps the honest status shape credential-free", () => {
    const status = {
      project_id: "owner",
      connectors: [
        {
          id: "github",
          app: "GitHub",
          state: "not_connected",
          transport_wired: false,
          operations: 2
        }
      ]
    };
    expect(Value.Check(ConnectorStatusSchema, status)).toBe(true);
    expect(JSON.stringify(status)).not.toMatch(/token|secret|api[_-]?key/i);
  });
});
