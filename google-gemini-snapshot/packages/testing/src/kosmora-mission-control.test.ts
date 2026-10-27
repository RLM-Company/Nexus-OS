/**
 * Kosmora Mission Control — End-to-End Verification Suite (13 Mandatory Scenarios)
 * Executed via `node --test` alongside `kosmora-160.test.ts`.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import test from "node:test";

import {
  KOSMORA_MISSION_AGENT_CATALOG,
  type MissionEvent
} from "../../core/src/index.js";
import {
  createKosmoraControlPlane,
  createKosmoraHttpServer
} from "../../../apps/api/src/kosmora-routes.js";
import {
  buildKosmoraWorkspaceViewModel,
  buildMissionControlViewModel,
  KOSMORA_MONOCHROME_THEME
} from "../../../apps/web/src/app/kosmora-workspace/view-model.js";
import KosmoraWorkspacePage, {
  KosmoraMissionControlPanel
} from "../../../apps/web/src/app/kosmora-workspace/page.js";
import KosmoraMissionsPage from "../../../apps/web/src/app/kosmora-workspace/missions/page.js";

test("Kosmora Mission Control — 13 Mandatory End-to-End Scenarios (SQLite, DAG, 7 Roles, Orchestration, SSE, HITL, Budgets, Isolation, Export, Monochrome Russian UI)", async (t) => {
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "kosmora-mission-control-test-")
  );
  const dbPath = path.join(tmpDir, "mission-control.sqlite");

  const ctx = createKosmoraControlPlane(dbPath);
  const server = createKosmoraHttpServer(ctx);

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const ownerSession = ctx.security.issueSignedSessionToken({
    tenant_id: "tenant_edtech_01",
    workspace_ids: ["ws_edtech_01"],
    user_id: "user_owner_alpha",
    role: "owner",
    mfa_verified: true
  });
  const ownerToken = ownerSession.token;

  const foreignUserSession = ctx.security.issueSignedSessionToken({
    tenant_id: "tenant_edtech_01",
    workspace_ids: ["ws_edtech_01"],
    user_id: "user_operator_beta",
    role: "operator",
    mfa_verified: true
  });
  const foreignUserToken = foreignUserSession.token;

  const foreignTenantSession = ctx.security.issueSignedSessionToken({
    tenant_id: "tenant_other_99",
    workspace_ids: ["ws_other_99"],
    user_id: "user_intruder",
    role: "owner",
    mfa_verified: true
  });
  const foreignTenantToken = foreignTenantSession.token;

  const apiCall = async (
    method: string,
    route: string,
    token: string,
    body?: Record<string, unknown>
  ): Promise<{ status: number; data: any; rawText: string }> => {
    const res = await fetch(`${baseUrl}${route}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { "content-type": "application/json" } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const rawText = await res.text();
    let data: any = null;
    try {
      data = JSON.parse(rawText);
    } catch {
      data = rawText;
    }
    return { status: res.status, data, rawText };
  };

  let missionId = "";

  try {
    await t.test("Scenario 1: Создание миссии, индексы SQLite и optimistic concurrency", async () => {
      const createRes = await apiCall("POST", "/api/v1/missions", ownerToken, {
        project_id: "proj_edtech_research",
        workspace_id: "ws_edtech_01",
        title: "Подготовить исследование рынка EdTech",
        goal: "Найти источники, проанализировать рынок и конкурентов, собрать структуру презентации и проверить факты.",
        context: "Фокус на сегментах B2B L&D и ИИ-тьюторов.",
        priority: "high",
        budget_limit: 20.0
      });
      assert.equal(createRes.status, 201);
      missionId = createRes.data.mission.id;
      assert.equal(createRes.data.mission.status, "draft");
      assert.equal(createRes.data.mission.version, 1);
      assert.equal(createRes.data.mission.budget_limit, 20.0);
      assert.equal(createRes.data.mission.budget_spent, 0);

      const conflictPatch = await apiCall(
        "PATCH",
        `/api/v1/missions/${missionId}`,
        ownerToken,
        {
          expected_version: 999,
          title: "Stale Update"
        }
      );
      assert.equal(conflictPatch.status, 409);
      assert.equal(conflictPatch.data.error, "MISSION_VERSION_CONFLICT");

      const missionIndexes = ctx.store.inspectTableIndexes("missions").map((i) => i.name);
      const taskIndexes = ctx.store.inspectTableIndexes("mission_tasks").map((i) => i.name);
      const eventIndexes = ctx.store.inspectTableIndexes("mission_events").map((i) => i.name);
      const artifactIndexes = ctx.store.inspectTableIndexes("mission_artifacts").map((i) => i.name);
      assert.ok(missionIndexes.includes("idx_missions_tenant_project_owner"));
      assert.ok(taskIndexes.includes("idx_mission_tasks_mission_active"));
      assert.ok(eventIndexes.includes("idx_mission_events_mission_seq"));
      assert.ok(artifactIndexes.includes("idx_mission_artifacts_mission_task"));
    });

    await t.test("Scenario 2: Добавление, редактирование и удаление задач с зависимостями", async () => {
      const t1Res = await apiCall(
        "POST",
        `/api/v1/missions/${missionId}/tasks`,
        ownerToken,
        {
          id: "t1_researcher",
          title: "Найти и процитировать источники",
          instruction: "Найти первоисточники по рынку EdTech и оформить цитаты.",
          assigned_agent_role: "researcher",
          priority: "high",
          dependencies: [],
          budget_limit: 5.0,
          max_attempts: 3
        }
      );
      assert.equal(t1Res.status, 201);
      assert.equal(t1Res.data.task.status, "queued");

      const t2Res = await apiCall(
        "POST",
        `/api/v1/missions/${missionId}/tasks`,
        ownerToken,
        {
          id: "t2_analyst",
          title: "Выделить рынок, конкурентов и риски",
          instruction:
            "Построить сравнительную таблицу конкурентов и матрицу рисков.",
          assigned_agent_role: "analyst",
          priority: "critical",
          dependencies: ["t1_researcher"],
          budget_limit: 5.0,
          max_attempts: 3
        }
      );
      assert.equal(t2Res.status, 201);
      assert.equal(t2Res.data.task.status, "blocked");

      const t3Res = await apiCall(
        "POST",
        `/api/v1/missions/${missionId}/tasks`,
        ownerToken,
        {
          id: "t3_writer",
          title: "Собрать структуру презентации",
          instruction: "Подготовить структуру слайдов по результатам аналитики.",
          assigned_agent_role: "writer",
          priority: "medium",
          dependencies: ["t2_analyst"],
          budget_limit: 5.0,
          max_attempts: 3
        }
      );
      assert.equal(t3Res.status, 201);
      assert.equal(t3Res.data.task.status, "blocked");

      const t4Res = await apiCall(
        "POST",
        `/api/v1/missions/${missionId}/tasks`,
        ownerToken,
        {
          id: "t4_reviewer",
          title: "Проверить факты и противоречия",
          instruction:
            "Проверить согласованность фактов и передать владельцу на утверждение.",
          assigned_agent_role: "reviewer",
          execution_mode: "require_review",
          priority: "high",
          dependencies: ["t3_writer"],
          budget_limit: 4.0,
          max_attempts: 3
        }
      );
      assert.equal(t4Res.status, 201);
      assert.equal(t4Res.data.task.status, "blocked");

      const tempTaskRes = await apiCall(
        "POST",
        `/api/v1/missions/${missionId}/tasks`,
        ownerToken,
        {
          id: "t_temp",
          title: "Временная задача дизайна",
          instruction: "Черновая схема",
          assigned_agent_role: "designer",
          dependencies: ["t1_researcher"]
        }
      );
      assert.equal(tempTaskRes.status, 201);

      const patchTempRes = await apiCall(
        "PATCH",
        `/api/v1/missions/${missionId}/tasks/t_temp`,
        ownerToken,
        {
          title: "Обновлённая задача дизайна",
          expected_version: 1
        }
      );
      assert.equal(patchTempRes.status, 200);
      assert.equal(patchTempRes.data.task.version, 2);

      const delTempRes = await apiCall(
        "DELETE",
        `/api/v1/missions/${missionId}/tasks/t_temp`,
        ownerToken
      );
      assert.equal(delTempRes.status, 200);
      assert.equal(delTempRes.data.deleted, true);
    });

    await t.test("Scenario 3: Отказ при цикле в зависимостях", async () => {
      const cyclePatchRes = await apiCall(
        "PATCH",
        `/api/v1/missions/${missionId}/tasks/t1_researcher`,
        ownerToken,
        {
          dependencies: ["t4_reviewer"]
        }
      );
      assert.equal(cyclePatchRes.status, 400);
      assert.equal(cyclePatchRes.data.error, "MissionDependencyCycleError");

      const selfDepRes = await apiCall(
        "POST",
        `/api/v1/missions/${missionId}/tasks`,
        ownerToken,
        {
          id: "t_self_cycle",
          title: "Цикл на себя",
          instruction: "Проверка цикла",
          assigned_agent_role: "operator",
          dependencies: ["t_self_cycle"]
        }
      );
      assert.equal(selfDepRes.status, 400);
      assert.equal(selfDepRes.data.error, "MissionDependencyCycleError");
    });

    await t.test("Scenario 4: Отказ при попытке выдать роли запрещённый инструмент", async () => {
      assert.equal(Object.keys(KOSMORA_MISSION_AGENT_CATALOG).length, 7);
      const forbiddenToolRes = await apiCall(
        "POST",
        `/api/v1/missions/${missionId}/tasks`,
        ownerToken,
        {
          id: "t_forbidden_tool",
          title: "Попытка запуска запрещённого инструмента",
          instruction: "Попытка дать writer доступ к sandbox_code_runner",
          assigned_agent_role: "writer",
          requested_tools: [
            "markdown_composer",
            "sandbox_code_runner",
            "root_shell"
          ]
        }
      );
      assert.equal(forbiddenToolRes.status, 400);
      assert.equal(forbiddenToolRes.data.error, "MissionRoleToolViolationError");
    });

    const liveObservedEvents: MissionEvent[] = [];

    await t.test("Scenario 5: Корректный порядок запуска задач и невозможность запуска с невыполненными зависимостями", async () => {
      const prematureStartTaskRes = await apiCall(
        "PATCH",
        `/api/v1/missions/${missionId}/tasks/t3_writer`,
        ownerToken,
        {
          status: "running"
        }
      );
      assert.equal(prematureStartTaskRes.status, 400);
      assert.equal(prematureStartTaskRes.data.error, "MissionValidationError");

      const unsubscribeLive = ctx.missionControl.subscribeMissionEvents(
        missionId,
        (ev) => {
          liveObservedEvents.push(ev);
        }
      );

      const startRes = await apiCall(
        "POST",
        `/api/v1/missions/${missionId}/start`,
        ownerToken
      );
      unsubscribeLive();
      assert.equal(startRes.status, 200);
      assert.equal(startRes.data.runs.length, 4);

      const runTaskOrder = startRes.data.runs.map((r: any) => r.task_id);
      assert.deepEqual(runTaskOrder, [
        "t1_researcher",
        "t2_analyst",
        "t3_writer",
        "t4_reviewer"
      ]);
    });

    await t.test("Scenario 6: Переход в waiting_for_review и SSE-поток событий", async () => {
      const detailsRes = await apiCall(
        "GET",
        `/api/v1/missions/${missionId}`,
        ownerToken
      );
      assert.equal(detailsRes.status, 200);
      assert.equal(detailsRes.data.mission.status, "waiting_for_review");
      const t4State = detailsRes.data.tasks.find(
        (task: any) => task.id === "t4_reviewer"
      );
      assert.equal(t4State.status, "waiting_for_review");
      assert.ok(
        liveObservedEvents.some(
          (e) =>
            e.event_type === "task.waiting_for_review" &&
            e.task_id === "t4_reviewer"
        )
      );

      const sseRes = await fetch(
        `${baseUrl}/api/v1/missions/${missionId}/events/stream`,
        {
          headers: { authorization: `Bearer ${ownerToken}` }
        }
      );
      assert.equal(sseRes.status, 200);
      assert.ok(
        (sseRes.headers.get("content-type") ?? "").includes("text/event-stream")
      );
      const sseBody = await sseRes.text();
      assert.ok(sseBody.includes("event: mission.started"));
      assert.ok(sseBody.includes("event: task.waiting_for_review"));
      assert.ok(sseBody.includes("event: artifact.created"));
    });

    await t.test("Scenario 7: Невозможность reject или send_back без комментария", async () => {
      const emptyRejectRes = await apiCall(
        "POST",
        `/api/v1/missions/${missionId}/tasks/t4_reviewer/review`,
        ownerToken,
        {
          decision: "reject",
          comment: "   "
        }
      );
      assert.equal(emptyRejectRes.status, 400);
      assert.equal(emptyRejectRes.data.error, "MissionValidationError");

      const emptySendBackRes = await apiCall(
        "POST",
        `/api/v1/missions/${missionId}/tasks/t4_reviewer/review`,
        ownerToken,
        {
          decision: "send_back",
          comment: ""
        }
      );
      assert.equal(emptySendBackRes.status, 400);
      assert.equal(emptySendBackRes.data.error, "MissionValidationError");
    });

    await t.test("Scenario 9: Повторный запуск после send_back в пределах max_attempts", async () => {
      const sendBackRes = await apiCall(
        "POST",
        `/api/v1/missions/${missionId}/tasks/t4_reviewer/review`,
        ownerToken,
        {
          decision: "send_back",
          comment: "Добавить сверку показателей CAC/LTV по сегменту B2B."
        }
      );
      assert.equal(sendBackRes.status, 200);
      assert.equal(sendBackRes.data.task.attempt_count, 2);
      assert.equal(sendBackRes.data.task.status, "waiting_for_review");
      assert.equal(
        sendBackRes.data.task.review_comment,
        "Добавить сверку показателей CAC/LTV по сегменту B2B."
      );

      const t5Res = await apiCall(
        "POST",
        `/api/v1/missions/${missionId}/tasks`,
        ownerToken,
        {
          id: "t5_operator",
          title: "Собрать финальный пакет выпуска",
          instruction: "Проверить комплектность артефактов после ревью.",
          assigned_agent_role: "operator",
          priority: "high",
          dependencies: ["t4_reviewer"],
          budget_limit: 3.0,
          max_attempts: 2
        }
      );
      assert.equal(t5Res.status, 201);
      assert.equal(t5Res.data.task.status, "blocked");
    });

    await t.test("Scenario 8: Продолжение выполнения после approve (разблокировка зависимых задач и финализация миссии)", async () => {
      const approveRes = await apiCall(
        "POST",
        `/api/v1/missions/${missionId}/tasks/t4_reviewer/review`,
        ownerToken,
        {
          decision: "approve",
          comment: "Факты и таблица CAC/LTV полностью подтверждены."
        }
      );
      assert.equal(approveRes.status, 200);
      assert.equal(approveRes.data.task.status, "completed");
      assert.equal(approveRes.data.mission.status, "completed");
      assert.ok(approveRes.data.mission.final_summary);
      assert.ok(approveRes.data.mission.final_artifact_id);

      const detailsAfterApprove = await apiCall(
        "GET",
        `/api/v1/missions/${missionId}`,
        ownerToken
      );
      assert.equal(detailsAfterApprove.status, 200);
      const t5After = detailsAfterApprove.data.tasks.find(
        (task: any) => task.id === "t5_operator"
      );
      assert.equal(t5After.status, "completed");

      const auditChain = ctx.security.getAuditChain();
      assert.ok(
        auditChain.some(
          (entry) => entry.action === "mission.task.review.send_back"
        )
      );
      assert.ok(
        auditChain.some(
          (entry) => entry.action === "mission.task.review.approve"
        )
      );
    });

    await t.test("Scenario 10: Остановка при превышении бюджета, предупреждение на 80% и честный usage_pending", async () => {
      const budgetMissionRes = await apiCall(
        "POST",
        "/api/v1/missions",
        ownerToken,
        {
          project_id: "proj_budget_guard",
          workspace_id: "ws_edtech_01",
          title: "Тест бюджетного лимита и max_attempts",
          goal: "Проверить budget.warning (80%) и budget.exceeded (100%)",
          budget_limit: 2.0
        }
      );
      const budgetMissionId = budgetMissionRes.data.mission.id;

      await apiCall(
        "POST",
        `/api/v1/missions/${budgetMissionId}/tasks`,
        ownerToken,
        {
          id: "tb_1",
          title: "Этап 1 (85% бюджета миссии)",
          instruction: "Расход 1.70 из 2.00",
          assigned_agent_role: "developer",
          budget_limit: 2.0,
          max_attempts: 1
        }
      );
      await apiCall(
        "POST",
        `/api/v1/missions/${budgetMissionId}/tasks`,
        ownerToken,
        {
          id: "tb_2",
          title: "Этап 2 (достижение 100% лимита)",
          instruction: "Расход ещё 1.70 -> превышение 2.00",
          assigned_agent_role: "analyst",
          dependencies: ["tb_1"],
          budget_limit: 2.0,
          max_attempts: 1
        }
      );
      await apiCall(
        "POST",
        `/api/v1/missions/${budgetMissionId}/tasks`,
        ownerToken,
        {
          id: "tb_3_blocked_by_budget",
          title: "Этап 3 (не должен запуститься после исчерпания бюджета)",
          instruction: "Должен быть остановлен бюджетным контролем",
          assigned_agent_role: "writer",
          dependencies: ["tb_2"],
          budget_limit: 2.0,
          max_attempts: 1
        }
      );

      ctx.missionControl
        .getDefaultRuntimeAdapter()
        .setUsageReportingMode("tracked", 1.7);
      const budgetStartRes = await apiCall(
        "POST",
        `/api/v1/missions/${budgetMissionId}/start`,
        ownerToken
      );
      assert.equal(budgetStartRes.status, 200);
      assert.equal(budgetStartRes.data.mission.status, "failed");

      const budgetEventsRes = await apiCall(
        "GET",
        `/api/v1/missions/${budgetMissionId}/events`,
        ownerToken
      );
      const budgetEventTypes = budgetEventsRes.data.events.map(
        (e: any) => e.event_type
      );
      assert.ok(budgetEventTypes.includes("budget.warning"));
      assert.ok(budgetEventTypes.includes("budget.exceeded"));

      const retryExceededRes = await apiCall(
        "POST",
        `/api/v1/missions/${budgetMissionId}/tasks/tb_3_blocked_by_budget/retry`,
        ownerToken
      );
      assert.equal(retryExceededRes.status, 400);

      ctx.missionControl
        .getDefaultRuntimeAdapter()
        .setUsageReportingMode("usage_pending", null);
      const pendingMissionRes = await apiCall(
        "POST",
        "/api/v1/missions",
        ownerToken,
        {
          project_id: "proj_usage_pending",
          workspace_id: "ws_edtech_01",
          title: "Тест честного статуса usage_pending",
          goal: "Проверка отсутствия фиктивных расходов",
          budget_limit: 10.0
        }
      );
      const pendingMissionId = pendingMissionRes.data.mission.id;
      await apiCall(
        "POST",
        `/api/v1/missions/${pendingMissionId}/tasks`,
        ownerToken,
        {
          id: "tp_1",
          title: "Задача с отложенным биллингом",
          instruction: "Проверка usage_pending",
          assigned_agent_role: "researcher"
        }
      );
      const pendingStart = await apiCall(
        "POST",
        `/api/v1/missions/${pendingMissionId}/start`,
        ownerToken
      );
      assert.equal(pendingStart.data.mission.budget_spent, 0);
      assert.equal(
        pendingStart.data.mission.budget_usage_status,
        "usage_pending"
      );
      ctx.missionControl
        .getDefaultRuntimeAdapter()
        .setUsageReportingMode("tracked", null);
    });

    await t.test("Scenario 11: Запрет доступа к чужой миссии (Owner / Tenant / Project Isolation)", async () => {
      const foreignUserGet = await apiCall(
        "GET",
        `/api/v1/missions/${missionId}`,
        foreignUserToken
      );
      assert.equal(foreignUserGet.status, 403);

      const foreignTenantGet = await apiCall(
        "GET",
        `/api/v1/missions/${missionId}`,
        foreignTenantToken
      );
      assert.equal(foreignTenantGet.status, 403);

      const foreignExport = await apiCall(
        "GET",
        `/api/v1/missions/${missionId}/export?format=json`,
        foreignUserToken
      );
      assert.equal(foreignExport.status, 403);
    });

    await t.test("Scenario 12: Экспорт миссии в JSON и Markdown + проверка pause, cancel и crash recovery", async () => {
      const exportJsonRes = await apiCall(
        "GET",
        `/api/v1/missions/${missionId}/export?format=json`,
        ownerToken
      );
      assert.equal(exportJsonRes.status, 200);
      assert.equal(exportJsonRes.data.format, "json");
      assert.equal(
        exportJsonRes.data.bundle.schema_version,
        "kosmora.mission.export.v1"
      );
      assert.equal(exportJsonRes.data.bundle.mission.id, missionId);
      assert.equal(
        exportJsonRes.data.bundle.mission.project_id,
        "proj_edtech_research"
      );
      assert.equal(exportJsonRes.data.bundle.mission.tenant_id, undefined);
      assert.ok(
        exportJsonRes.data.bundle.artifacts.every(
          (a: any) => a.mission_id === missionId
        )
      );

      const exportMdRes = await apiCall(
        "GET",
        `/api/v1/missions/${missionId}/export?format=markdown`,
        ownerToken
      );
      assert.equal(exportMdRes.status, 200);
      assert.equal(exportMdRes.data.format, "markdown");
      assert.ok(
        exportMdRes.data.markdown.includes(
          "# Экспорт миссии Kosmora: Подготовить исследование рынка EdTech"
        )
      );
      assert.ok(!exportMdRes.data.markdown.includes("proj_budget_guard"));
      assert.ok(!exportMdRes.data.markdown.includes("ksm_sess."));

      const cancelTestMission = await apiCall(
        "POST",
        "/api/v1/missions",
        ownerToken,
        {
          project_id: "proj_edtech_research",
          workspace_id: "ws_edtech_01",
          title: "Миссия для проверки паузы, отмены и восстановления",
          goal: "Проверка pause, cancel и recoverUnfinishedMissions"
        }
      );
      const cancelMissionId = cancelTestMission.data.mission.id;
      await apiCall(
        "POST",
        `/api/v1/missions/${cancelMissionId}/tasks`,
        ownerToken,
        {
          id: "tc_1",
          title: "Задача с уточнением",
          instruction: "Запросить уточнение",
          assigned_agent_role: "researcher",
          execution_mode: "require_clarification"
        }
      );
      await apiCall(
        "POST",
        `/api/v1/missions/${cancelMissionId}/start`,
        ownerToken
      );
      const pauseRes = await apiCall(
        "POST",
        `/api/v1/missions/${cancelMissionId}/pause`,
        ownerToken
      );
      assert.equal(pauseRes.status, 200);
      assert.equal(pauseRes.data.mission.status, "paused");

      const cancelRes = await apiCall(
        "POST",
        `/api/v1/missions/${cancelMissionId}/cancel`,
        ownerToken,
        { reason: "Отмена по решению владельца" }
      );
      assert.equal(cancelRes.status, 200);
      assert.equal(cancelRes.data.mission.status, "cancelled");

      // Verify crash recovery: simulate a mission & task interrupted in running state on restart
      const recMission = ctx.missionControl.createMission({
        principal: {
          tenant_id: "tenant_edtech_01",
          workspace_ids: ["ws_edtech_01"],
          user_id: "user_owner_alpha",
          role: "owner",
          mfa_verified: true
        },
        workspace_id: "ws_edtech_01",
        project_id: "proj_edtech_research",
        title: "Миссия восстановления после сбоя",
        goal: "Проверка recoverUnfinishedMissions"
      });
      const recTask = ctx.missionControl.createTask({
        principal: {
          tenant_id: "tenant_edtech_01",
          workspace_ids: ["ws_edtech_01"],
          user_id: "user_owner_alpha",
          role: "owner",
          mfa_verified: true
        },
        mission_id: recMission.id,
        id: "t_rec_1",
        title: "Прерванная задача",
        instruction: "Восстановить после перезапуска",
        assigned_agent_role: "operator",
        max_attempts: 3
      });
      const mRow = ctx.store.getMissionRowById(recMission.id)!;
      ctx.store.updateMissionRowOptimistic({ ...mRow, status: "running", version: mRow.version + 1 }, mRow.version);
      const tRow = ctx.store.getMissionTaskRowById(recTask.id)!;
      ctx.store.updateMissionTaskRowOptimistic({ ...tRow, status: "running", attempt_count: 1, version: tRow.version + 1 }, tRow.version);

      const recoveryReport = ctx.missionControl.recoverUnfinishedMissions();
      assert.ok(recoveryReport.recovered_mission_ids.includes(recMission.id));
      assert.ok(recoveryReport.requeued_task_ids.includes(recTask.id));
      const recoveredDetails = ctx.missionControl.getMissionDetails({
        principal: {
          tenant_id: "tenant_edtech_01",
          workspace_ids: ["ws_edtech_01"],
          user_id: "user_owner_alpha",
          role: "owner",
          mfa_verified: true
        },
        mission_id: recMission.id
      });
      assert.equal(recoveredDetails.mission.status, "completed");
    });

    await t.test("Scenario 13: Рабочий UI-сценарий (русский интерфейс, монохром без фиолетового, граф, артефакты, ревью и все состояния)", async () => {
      const workspaceVm = buildKosmoraWorkspaceViewModel();
      assert.equal(
        workspaceVm.theme.background_primary,
        KOSMORA_MONOCHROME_THEME.background_primary
      );
      assert.ok(workspaceVm.mission_control.mission);
      assert.equal(
        workspaceVm.mission_control.mission.title,
        "Подготовить исследование рынка EdTech"
      );
      assert.equal(workspaceVm.mission_control.tasks.length, 4);
      assert.equal(workspaceVm.mission_control.dependency_edges.length, 3);
      assert.equal(workspaceVm.mission_control.available_roles.length, 7);

      const emptyVm = buildMissionControlViewModel({ mode: "empty" });
      assert.equal(emptyVm.mission, null);
      assert.equal(emptyVm.ui_mode, "empty");

      const disconnectedVm = buildMissionControlViewModel({
        mode: "runtime_disconnected",
        runtime_connected: false
      });
      assert.equal(disconnectedVm.runtime_connected, false);
      assert.equal(disconnectedVm.mission?.status, "failed");
      assert.equal(
        disconnectedVm.mission?.budget_usage_status,
        "usage_unavailable"
      );
      assert.equal(disconnectedVm.artifacts.length, 0);

      const activeVm = buildMissionControlViewModel({ mode: "active" });
      assert.equal(activeVm.mission?.status, "completed");
      assert.ok(activeVm.mission?.final_summary);
      assert.deepEqual(activeVm.export_formats, ["JSON", "MARKDOWN"]);

      const cancelledVm = buildMissionControlViewModel({ mode: "cancelled" });
      assert.equal(cancelledVm.mission?.status, "cancelled");

      // Execute actual compiled JSX components across all UI states
      const renderedWorkspaceTree = KosmoraWorkspacePage();
      const renderedMissionsPageTree = KosmoraMissionsPage();
      const renderedEmptyTree = KosmoraMissionControlPanel({ viewModel: emptyVm });
      const renderedDisconnectedTree = KosmoraMissionControlPanel({ viewModel: disconnectedVm });
      const renderedActiveTree = KosmoraMissionControlPanel({ viewModel: activeVm });
      const renderedCancelledTree = KosmoraMissionControlPanel({ viewModel: cancelledVm });

      const serializedUi = JSON.stringify({
        workspaceVm,
        emptyVm,
        disconnectedVm,
        activeVm,
        cancelledVm,
        renderedWorkspaceTree,
        renderedMissionsPageTree,
        renderedEmptyTree,
        renderedDisconnectedTree,
        renderedActiveTree,
        renderedCancelledTree
      });
      assert.ok(serializedUi.includes("Подготовить исследование рынка EdTech"));
      assert.ok(serializedUi.includes("Контрольная точка владельца (Approve / Send Back / Reject)"));
      assert.ok(serializedUi.includes("Активных миссий в проекте пока нет"));
      assert.ok(serializedUi.includes("Агентский runtime не подключён"));
      assert.ok(serializedUi.includes("Миссия отменена"));
      assert.ok(!/purple|#8b5cf6|#7c3aed|#a855f7|violet/i.test(serializedUi));
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    ctx.store.close(true);
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
});
