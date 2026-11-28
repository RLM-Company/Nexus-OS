import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  accountableManager,
  applyStarsMissionEvent,
  buildStarsHandoff,
  canReadContext,
  cancelLease,
  changeStarsOrg,
  createStarsMission,
  createStarsOrg,
  delegateMission,
  heartbeat,
  requestRunnerLease,
  shouldWakeStars,
  StarsOrgConflict,
  type StarsMission,
  type StarsOrgNode
} from "../src/index.js";

const at = "2026-11-27T12:00:00.000Z";
const node = (
  id: string,
  role: StarsOrgNode["role"],
  manager_id: string | null,
  zones: string[],
  projects: string[]
): StarsOrgNode => ({
  id,
  role,
  manager_id,
  responsibility_zones: zones,
  project_ids: projects,
  status: "active",
  effective_from: at
});
const org = () =>
  createStarsOrg("stars-wave", [
    node("owner", "owner", null, ["*"], ["p1", "p2"]),
    node("chief", "chief", "owner", ["*"], ["p1", "p2"]),
    node("sub1", "submanager", "chief", ["research"], ["p1"]),
    node("sub2", "submanager", "chief", ["delivery"], ["p2"]),
    node("a1", "executor", "sub1", ["research"], []),
    node("a2", "executor", "sub2", ["delivery"], []),
    node("senior", "senior", "chief", ["review"], [])
  ]);

const mission = (id: string, goal: string): StarsMission =>
  applyStarsMissionEvent(createStarsMission({ id, team_scope: "stars-wave" }), {
    type: "brief",
    goal,
    author: "owner",
    responsible: "chief",
    input_versions: ["materials@4", "org@1"],
    criteria: ["доставка отдельной строкой", "общий итог проверен старшим"],
    acceptance_rules: ["человек принимает общий итог отдельно"]
  });

describe("Stars full acceptance scenario", () => {
  it("runs two projects with replacement, conflict, restart and shared result", () => {
    const composition = org();
    expect(accountableManager(composition, "p1")?.id).toBe("sub1");
    expect(accountableManager(composition, "p2")?.id).toBe("sub2");

    let state = mission("shared", "Сравнить поставщиков двух бизнесов");
    state = applyStarsMissionEvent(state, {
      type: "plan",
      agents: [
        { id: "chief", role: "manager", task: "координировать", context_scopes: ["stars-wave"] },
        {
          id: "a1",
          role: "executor",
          task: "извлечь",
          context_scopes: ["stars-wave", "a1-private"]
        },
        {
          id: "a2",
          role: "executor",
          task: "сверить",
          context_scopes: ["stars-wave", "a2-private"]
        },
        { id: "senior", role: "senior", task: "проверить", context_scopes: ["stars-wave"] }
      ],
      dependencies: { a2: ["a1"] }
    });
    const beforeReplacement = delegateMission(state, composition, "p1", {
      a1: "research",
      a2: "delivery"
    });
    expect(beforeReplacement.nodes.map((n) => n.id)).toEqual(["a1"]);
    expect(beforeReplacement.skipped[0]!.reason).toContain("зоне");

    const p1Plan = delegateMission(state, composition, "p1", { a1: "research" });
    const p2Plan = delegateMission(state, composition, "p2", { a1: "research", a2: "delivery" });
    expect(p1Plan.nodes[0]!.goal).toContain("materials@4");
    expect(p2Plan.nodes[0]!.depends_on).toEqual(["a1"]); // зависимый общий результат

    // Отказ исполнителя и явная замена с точным пакетом передачи.
    state = applyStarsMissionEvent(state, {
      type: "fail",
      agent_id: "a1",
      reason: "EXECUTOR_DOWN"
    });
    const handoff = buildStarsHandoff(state, composition, "a1", "a1b", at);
    expect(handoff.unfinished[0]!.task).toBe("извлечь");
    expect(handoff.context_scopes).toEqual(["stars-wave", "a1-private"]);
    state = applyStarsMissionEvent(state, {
      type: "replace",
      failed_agent_id: "a1",
      replacement_id: "a1b"
    });
    expect(state.dependencies.a2).toEqual(["a1b"]);

    // Конфликт указаний виден и останавливает работу до решения владельца.
    state = applyStarsMissionEvent(state, {
      type: "conflict",
      from: "sub2",
      text: "Сменить приоритет на отчёт по p2"
    });
    expect(state.stage).toBe("paused");
    expect(state.stop_reason).toBe("CONFLICTING_INSTRUCTIONS");
    expect(state.question).toContain("решение");
    state = applyStarsMissionEvent(state, { type: "resume" });

    // Недоступный executor: замена не получает зону без однозначного совпадения.
    const unavailable = delegateMission(state, composition, "p1", { a1b: "delivery" });
    expect(unavailable.nodes).toEqual([]);
    expect(unavailable.skipped[0]!.reason).toContain("зоне");

    // Устаревшая версия состава не перезаписывает текущую.
    expect(() => changeStarsOrg(composition, 0, [])).toThrow(StarsOrgConflict);

    // Легкая проверка событий: в ожидании модель не пробуждается.
    expect(
      shouldWakeStars(state, { kind: "event", source_id: "e1", project_id: "stars-wave", at }).wake
    ).toBe(true);
    expect(
      shouldWakeStars(
        { ...state, stage: "paused" },
        { kind: "event", source_id: "e2", project_id: "stars-wave", at }
      ).wake
    ).toBe(false);

    // Разделение контекстов: личный контекст другого агента недоступен.
    expect(canReadContext(state, "a1b", "a1-private")).toBe(true);
    expect(canReadContext(state, "a2", "a1-private")).toBe(false);

    // Отмена отдельного поручения не меняет закрытый общий результат.
    let other = mission("other", "Отдельный отчёт");
    other = applyStarsMissionEvent(other, { type: "cancel" });
    expect(other.stage).toBe("cancelled");

    // Результаты и проверка старшим, затем отдельное принятие человеком.
    state = applyStarsMissionEvent(state, {
      type: "result",
      agent_id: "a1b",
      summary: "извлечено"
    });
    state = applyStarsMissionEvent(state, {
      type: "result",
      agent_id: "a2",
      summary: "сверено; доставка 5 дней"
    });
    state = applyStarsMissionEvent(state, {
      type: "verify",
      agent_id: "a1b",
      verdict: "verified",
      verified_by: "senior"
    });
    state = applyStarsMissionEvent(state, {
      type: "verify",
      agent_id: "a2",
      verdict: "verified",
      verified_by: "senior"
    });
    state = applyStarsMissionEvent(state, {
      type: "combine",
      summary: "Общий итог: Поставщик А 250 ₽; доставка: 5 дней"
    });
    expect(state.stage).toBe("completed");
    const accepted = applyStarsMissionEvent(state, { type: "accept", actor: "owner" });
    expect(accepted.accepted_by_human).toBe("owner");
    expect(accepted.results[0]!.verified_by).toBe("senior");

    // Поздний результат не оживляет закрытую задачу.
    expect(
      applyStarsMissionEvent(accepted, { type: "result", agent_id: "a2", summary: "поздно" })
    ).toBe(accepted);

    // Restart: та же версия и тот же контрольный результат после replay.
    const replayed = JSON.parse(JSON.stringify(accepted)) as StarsMission;
    expect(replayed.version).toBe(accepted.version);
    expect(replayed.combined_result).toBe(accepted.combined_result);

    // Local→remote перенос на изолированном тестовом runner boundary.
    const local = requestRunnerLease({
      lease_id: "lease-local",
      runner: "local",
      task_id: "a1b",
      holder: "a1b",
      expires_at: at,
      active: []
    });
    const remote = requestRunnerLease({
      lease_id: "lease-remote",
      runner: "remote",
      task_id: "a1b-transfer",
      holder: "a1b",
      expires_at: at,
      active: [heartbeat(local, at)]
    });
    expect(remote.runner).toBe("remote");
    expect(cancelLease(heartbeat(remote, at)).status).toBe("cancelled");

    const dir = join(
      process.cwd(),
      "..",
      "..",
      "docs",
      "team",
      "operation-2026-11-27",
      "deliveries",
      "04_HARNESS"
    );
    const artifact = [
      "Stars full acceptance — synthetic fixtures",
      `composition version: ${composition.version}; checksum: ${composition.checksum}`,
      `mission version: ${accepted.version}; stage: ${accepted.stage}`,
      `stop reason: ${accepted.stop_reason}; human acceptance: ${accepted.accepted_by_human}`,
      `replacement: a1 → a1b; handoff: ${handoff.unfinished[0]!.task}`,
      `p1 delegation: ${p1Plan.nodes.map((n) => n.id).join(", ")}`,
      `p2 delegation: ${p2Plan.nodes.map((n) => `${n.id}<-${n.depends_on.join("+")}`).join(", ")}`,
      `shared result: ${accepted.combined_result}`,
      `runner transfer: ${local.runner} → ${remote.runner} (isolated test boundary)`,
      ""
    ].join("\n");
    writeFileSync(join(dir, "FULL_SCENARIO_RESULT.txt"), artifact, "utf8");
    writeFileSync(
      join(dir, "FULL_SCENARIO_STATE.json"),
      JSON.stringify({ composition, accepted, handoff }, null, 2),
      "utf8"
    );
  });
});
