import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
  CLEAR_EMERGENCY_STOP_ACKNOWLEDGEMENT,
  ClearEmergencyStopRequestSchema,
  EmergencyStopClearanceEventSchema
} from "../src/runtime.js";

describe("runtime operations contracts", () => {
  it("requires an exact emergency-stop clearance acknowledgement", () => {
    const request = {
      scope: "project",
      project_id: "project-1",
      expected_activated_at: "2026-09-03T12:00:00.000Z",
      reason: "Recovery checklist completed",
      acknowledgement: CLEAR_EMERGENCY_STOP_ACKNOWLEDGEMENT
    } as const;

    expect(Value.Check(ClearEmergencyStopRequestSchema, request)).toBe(true);
    expect(
      Value.Check(ClearEmergencyStopRequestSchema, {
        ...request,
        acknowledgement: "resume"
      })
    ).toBe(false);
  });

  it("accepts a content-bounded emergency-stop clearance event", () => {
    expect(
      Value.Check(EmergencyStopClearanceEventSchema, {
        event_id: "clearance-1",
        scope: "process",
        project_id: null,
        activation_reason: "Provider incident",
        activated_at: "2026-09-03T12:00:00.000Z",
        activated_by: "owner-1",
        clearance_reason: "Provider health verified",
        cleared_at: "2026-09-03T12:05:00.000Z",
        cleared_by: "owner-1"
      })
    ).toBe(true);
  });
});
