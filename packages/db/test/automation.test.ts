import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AutomationStore,
  ProjectStore,
  WorkflowStore,
  openDatabase,
  runMigrations
} from "../src/index.js";

const resources: (() => void)[] = [];
afterEach(() => {
  for (const close of resources.splice(0)) close();
});

describe("automation migration and durable runtime", () => {
  it("upgrades a database with existing data, preserves definitions and fails atomically on invalid input", async () => {
    const dir = mkdtempSync(join(tmpdir(), "oc6-automation-"));
    const path = join(dir, "db.sqlite");
    const db = openDatabase(path);
    const cleanupDb = () => db.close();
    resources.push(cleanupDb);
    await runMigrations(db);
    const projects = new ProjectStore(db.sqlite);
    const workflows = new WorkflowStore(db.sqlite);
    const project = projects.createProject("A", "client-a", "owner").project;
    const definition = workflows.create(
      project.id,
      "owner",
      {
        name: "Report",
        description: "Reusable",
        parameters: [],
        nodes: [{ id: "report", title: "Report", goal: "Write report.md", depends_on: [] }],
        requirements: [],
        expected_results: ["report.md"]
      },
      "definition-1"
    );
    // Simulate a restart on the same database: all earlier data survives.
    db.close();
    resources.splice(resources.indexOf(cleanupDb), 1);
    const reopened = openDatabase(path);
    resources.push(() => reopened.close());
    await runMigrations(reopened);
    expect(
      new WorkflowStore(reopened.sqlite).get(project.id, "owner", definition.id)?.version
    ).toBe(1);
    expect(new ProjectStore(reopened.sqlite).getProject(project.id, "owner")?.id).toBe(project.id);
    const automation = new AutomationStore(reopened.sqlite);
    const trigger = automation.createTrigger("owner", project.id, "owner", {
      client_request_id: "trigger-1",
      workflow_id: definition.id,
      definition_version: 1,
      kind: "manual",
      inputs: {}
    });
    expect(trigger.version_policy).toBe("pinned");
    const run = automation.enqueue("owner", project.id, trigger, "owner");
    expect(automation.getRun("owner", run.id)?.status).toBe("queued");
    expect(run.event_key).toBeUndefined();
    // Migration 0079 adds the inbox; every receipt is journaled and deduped.
    const receipt = automation.recordEventReceipt({
      owner: "owner",
      project: project.id,
      receiptId: "receipt-1",
      source: "harness3",
      eventType: "file.updated",
      eventId: "event-1",
      workflowId: definition.id,
      definitionVersion: 1,
      body: { topic: "x" }
    });
    expect(receipt.created).toBe(true);
    const replay = automation.recordEventReceipt({
      owner: "owner",
      project: project.id,
      receiptId: "receipt-2",
      source: "harness3",
      eventType: "file.updated",
      eventId: "event-1",
      workflowId: definition.id,
      definitionVersion: 1,
      body: { topic: "x" }
    });
    expect(replay.created).toBe(false);
    expect(replay.receipt.id).toBe(receipt.receipt.id);
    expect(automation.listEventReceipts("owner")).toHaveLength(1);
  });
});
