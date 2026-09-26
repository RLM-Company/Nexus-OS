import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
  CreateDemoManagerRunRequestSchema,
  DemoManagerArtifactKindSchema,
  DemoManagerArtifactSchema,
  DemoManagerRunStatusSchema
} from "../src/index.js";

const timestamp = "2026-09-22T20:00:00.000Z";

describe("demo manager transport boundaries", () => {
  it("accepts every current demo run status", () => {
    for (const status of ["queued", "running", "succeeded", "failed", "cancelled"]) {
      expect(Value.Check(DemoManagerRunStatusSchema, status)).toBe(true);
    }

    for (const status of ["", "completed", "Running", " running ", null, 1]) {
      expect(Value.Check(DemoManagerRunStatusSchema, status)).toBe(false);
    }
  });

  it("accepts every current artifact kind", () => {
    for (const kind of ["plan", "analysis", "handoff", "checkpoint"]) {
      expect(Value.Check(DemoManagerArtifactKindSchema, kind)).toBe(true);
    }

    for (const kind of ["", "result", "Plan", " plan ", null, 1]) {
      expect(Value.Check(DemoManagerArtifactKindSchema, kind)).toBe(false);
    }
  });

  it("checks demo artifact strict transport shape", () => {
    const artifact = {
      artifact_id: "artifact-1",
      demo_run_id: "demo-run-1",
      project_id: "project-1",
      task_id: "task-1",
      kind: "analysis",
      content: "",
      created_at: timestamp
    };

    expect(Value.Check(DemoManagerArtifactSchema, artifact)).toBe(true);
    expect(
      Value.Check(DemoManagerArtifactSchema, {
        ...artifact,
        artifact_id: "artifact id"
      })
    ).toBe(false);
    expect(
      Value.Check(DemoManagerArtifactSchema, {
        ...artifact,
        kind: "result"
      })
    ).toBe(false);
    expect(
      Value.Check(DemoManagerArtifactSchema, {
        ...artifact,
        created_at: "2026-09-22"
      })
    ).toBe(false);
    expect(
      Value.Check(DemoManagerArtifactSchema, {
        ...artifact,
        unexpected: true
      })
    ).toBe(false);
  });

  it("checks create-run owner goal boundaries", () => {
    expect(
      Value.Check(CreateDemoManagerRunRequestSchema, {
        source_run_id: "run-1",
        owner_goal: "x"
      })
    ).toBe(true);

    expect(
      Value.Check(CreateDemoManagerRunRequestSchema, {
        source_run_id: "run-1",
        owner_goal: "x".repeat(100_000)
      })
    ).toBe(true);

    for (const owner_goal of ["", "   ", "\t\n", "x".repeat(100_001)]) {
      expect(
        Value.Check(CreateDemoManagerRunRequestSchema, {
          source_run_id: "run-1",
          owner_goal
        })
      ).toBe(false);
    }
  });

  it("rejects malformed create-run ids and additional properties", () => {
    expect(
      Value.Check(CreateDemoManagerRunRequestSchema, {
        source_run_id: "run id",
        owner_goal: "goal"
      })
    ).toBe(false);

    expect(
      Value.Check(CreateDemoManagerRunRequestSchema, {
        source_run_id: "run-1",
        owner_goal: "goal",
        unexpected: true
      })
    ).toBe(false);
  });
});
