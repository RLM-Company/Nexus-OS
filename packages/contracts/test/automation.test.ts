import { describe, expect, it } from "vitest";
import {
  validateWorkflowDefinition,
  parseWorkflowPackage,
  type WorkflowDefinitionInput
} from "../src/workflows.js";

const definition = (): WorkflowDefinitionInput => ({
  name: "Publish",
  description: " Procedura with confirmation ",
  parameters: [],
  nodes: [{ id: "publish", title: "Publish", goal: "Create report.md", depends_on: [] }],
  requirements: ["work.files.create"],
  expected_results: ["report.md"],
  conditions: [
    {
      id: "allowed-files",
      description: "Only listed files",
      kind: "source_allowlist",
      file_ids: ["file-1"]
    }
  ],
  confirmations: [
    {
      id: "approval",
      node_id: "publish",
      description: "Human approval before publication",
      external_action: "publish report.md"
    }
  ]
});

describe("versioned procedure conditions and confirmation points", () => {
  it("accepts a version with conditions and confirmations and keeps them in the package", () => {
    const d = definition();
    validateWorkflowDefinition(d);
    const imported = parseWorkflowPackage({ format: "kosmora.workflow.v1", definition: d });
    expect(imported.conditions).toEqual(d.conditions);
    expect(imported.confirmations).toEqual(d.confirmations);
  });

  it("rejects confirmation points bound to unknown nodes and empty allowlists", () => {
    expect(() =>
      validateWorkflowDefinition({
        ...definition(),
        confirmations: [
          {
            id: "bad",
            node_id: "missing",
            description: "bad",
            external_action: "x"
          }
        ]
      })
    ).toThrow("INVALID_WORKFLOW_CONFIRMATION");
    expect(() =>
      validateWorkflowDefinition({
        ...definition(),
        conditions: [{ id: "bad", description: "bad", kind: "source_allowlist" }]
      })
    ).toThrow("INVALID_WORKFLOW_CONDITION");
  });
});
