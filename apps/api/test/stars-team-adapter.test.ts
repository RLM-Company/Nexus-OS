import { expect, it } from "vitest";
import { bindStarsTeam, starsTeamStatus } from "../src/stars-team-adapter.js";

it("binds a Stars mission to an existing team composition identity", () => {
  const mission = {
    id: "mission-1",
    team_scope: "team-stars",
    agents: [{ id: "manager" }, { id: "a1" }, { id: "a2" }]
  };
  const binding = bindStarsTeam(mission, "team-stars");
  expect(binding.composition_id).toMatch(/^[0-9a-f]{64}$/);
  expect(binding.project_id).toBe("team-stars");
  expect(binding.parts.map((part) => part.agent_id)).toEqual(["manager", "a1", "a2"]);
  expect(binding.parts.every((part) => part.node_id.startsWith("part-"))).toBe(true);
  expect(binding.activated).toBe(false);

  const enriched = starsTeamStatus(
    [{ instance_id: "instance-a1", node_id: binding.parts[1]!.node_id, status: "completed" }],
    binding
  );
  expect(enriched.activated).toBe(true);
  expect(enriched.parts[1]!.instance_id).toBe("instance-a1");
  expect(enriched.parts[0]!.instance_id).toBeNull();
});
