import { describe, expect, it } from "vitest";
import { createFixtureServiceAdapters } from "../src/fixture-service-adapters.js";
import { FIRST_SLICE_CONNECTORS, FIXTURE_SERVICE_CONNECTORS } from "../src/connector-catalog.js";

const context = (operationId: string) => ({
  operationId,
  projectId: "project-a",
  actorId: "actor-a",
  idempotencyKey: "key-" + operationId,
  objectIds: [],
  verdict: { decision: "allow" } as never
});

describe("fixture Calendar/Mail service lifecycle", () => {
  it("keeps synthetic services out of the production catalog", () => {
    expect(FIRST_SLICE_CONNECTORS.some((item) => item.id.endsWith("-fixture"))).toBe(false);
    expect(FIXTURE_SERVICE_CONNECTORS.map((item) => item.id)).toEqual([
      "calendar-fixture",
      "mail-fixture"
    ]);
  });
  it("requires connect, reads, prepares with confirmation, journals and revokes", async () => {
    const adapters = createFixtureServiceAdapters();
    const reads = adapters.transports["integration.calendar-fixture.read_events"];
    const prepare = adapters.transports["integration.mail-fixture.prepare_send"];
    await expect(reads.execute({}, context("op-0"))).rejects.toThrow("SERVICE_NOT_CONNECTED");
    adapters.connect("calendar-fixture");
    adapters.connect("mail-fixture");
    const events = (await reads.execute({}, context("op-1"))) as { events: unknown[] };
    expect(events.events[0]).toMatchObject({ id: "event-1" });
    const prepared = (await prepare.execute({ subject: "Смета" }, context("op-2"))) as {
      prepared: boolean;
      requires_confirmation: boolean;
      version: number;
    };
    expect(prepared).toMatchObject({ prepared: true, requires_confirmation: true, version: 1 });
    expect(adapters.journal("calendar-fixture")).toHaveLength(1);
    expect(adapters.journal("mail-fixture")).toHaveLength(1);
    adapters.revoke("calendar-fixture", "actor-a");
    await expect(reads.execute({}, context("op-3"))).rejects.toThrow("SERVICE_ACCESS_REVOKED");
    expect(adapters.journal("calendar-fixture")).toHaveLength(1);
  });
});
