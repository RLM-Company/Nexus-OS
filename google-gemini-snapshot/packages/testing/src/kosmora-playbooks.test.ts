/**
 * Kosmora Playbooks — Comprehensive End-to-End Verification Suite (20 Mandatory Scenarios)
 * Executed via `node --test` alongside `kosmora-160.test.ts` and `kosmora-mission-control.test.ts`.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import test from "node:test";

import {
  BUILT_IN_KOSMORA_PLAYBOOKS,
  KosmoraEnterpriseSecurityEngine,
  KosmoraMissionControlService,
  KosmoraPlaybooksService,
  KosmoraRuntimeStore,
  PlaybookChecksumMismatchError,
  SECRET_REDACTED_PLACEHOLDER,
  type PlaybookDefinition
} from "../../core/src/index.js";
import {
  createKosmoraControlPlane,
  createKosmoraHttpServer
} from "../../../apps/api/src/kosmora-routes.js";
import KosmoraWorkspacePage, {
  buildPlaybooksViewModel,
  computeUiPlaybookPreview,
  KosmoraPlaybooksPanel
} from "../../../apps/web/src/app/kosmora-workspace/page.js";
import KosmoraPlaybooksPage from "../../../apps/web/src/app/kosmora-workspace/playbooks/page.js";

test("Kosmora Playbooks — 20 Mandatory End-to-End Scenarios (Versioning, SHA-256, Variables, Secrets, Conditions, Atomic Mission Control Instantiation, Isolation, HTTP API, Monochrome Russian UI, Migrations)", async (t) => {
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "kosmora-playbooks-test-")
  );
  const dbPath = path.join(tmpDir, "playbooks-e2e.sqlite");

  const ctx = createKosmoraControlPlane(dbPath);
  const server = createKosmoraHttpServer(ctx);

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const aliceSession = ctx.security.issueSignedSessionToken({
    tenant_id: "tenant_alpha",
    user_id: "user_alice",
    role: "operator",
    workspace_ids: ["ws_alpha"],
    mfa_verified: true
  });

  const bobSameTenantSession = ctx.security.issueSignedSessionToken({
    tenant_id: "tenant_alpha",
    user_id: "user_bob",
    role: "operator",
    workspace_ids: ["ws_alpha"],
    mfa_verified: true
  });

  const externalTenantSession = ctx.security.issueSignedSessionToken({
    tenant_id: "tenant_beta",
    user_id: "user_mallory",
    role: "owner",
    workspace_ids: ["ws_beta"],
    mfa_verified: true
  });

  async function apiRequest<T = Record<string, unknown>>(
    method: string,
    urlPath: string,
    options?: {
      token?: string;
      body?: Record<string, unknown>;
    }
  ): Promise<{ status: number; data: T }> {
    const token = options?.token ?? aliceSession.token;
    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    };
    const res = await fetch(`${baseUrl}${urlPath}`, {
      method,
      headers,
      body: options?.body ? JSON.stringify(options.body) : undefined
    });
    const data = (await res.json()) as T;
    return { status: res.status, data };
  }

  const baseCustomDefinition: PlaybookDefinition = {
    mission_title_template: "Custom Audit: {{project_name}} ({{market}})",
    goal_template: "Execute {{goal}} for {{project_name}} in {{country}} by {{deadline}}",
    context_template:
      "Portal: {{source_url}} | Deep Scan: {{deep_scan}} | Budget: {{budget}}",
    default_priority: "high",
    default_budget_limit: 20.0,
    variables: [
      {
        key: "project_name",
        label: "Название проекта",
        description: "Имя целевого проекта",
        type: "text",
        required: true,
        default_value: "Kosmora FinCore",
        validation_rules: { min_length: 3, max_length: 80 },
        secret: false
      },
      {
        key: "goal",
        label: "Цель сценария",
        description: "Подробное описание цели",
        type: "textarea",
        required: true,
        default_value: "Проверить архитектуру и отчётность",
        validation_rules: { min_length: 5, max_length: 500 },
        secret: false
      },
      {
        key: "market",
        label: "Сегмент рынка",
        description: "Выбор отрасли",
        type: "select",
        required: true,
        default_value: "FinTech",
        secret: false,
        options: [
          { value: "FinTech", label: "FinTech" },
          { value: "EdTech", label: "EdTech" },
          { value: "GovTech", label: "GovTech" }
        ]
      },
      {
        key: "country",
        label: "Страна",
        description: "Регион запуска",
        type: "text",
        required: false,
        default_value: "Казахстан",
        secret: false
      },
      {
        key: "deadline",
        label: "Дедлайн",
        description: "Срок завершения",
        type: "text",
        required: true,
        default_value: "2026-12-01",
        secret: false
      },
      {
        key: "budget",
        label: "Бюджет сценария ($)",
        description: "Численный бюджет",
        type: "number",
        required: true,
        default_value: 18,
        validation_rules: { min: 5, max: 50 },
        secret: false
      },
      {
        key: "deep_scan",
        label: "Глубокое сканирование",
        description: "Флаг включения условной задачи",
        type: "boolean",
        required: true,
        default_value: true,
        secret: false
      },
      {
        key: "source_url",
        label: "URL источника",
        description: "Ссылка на документацию",
        type: "url",
        required: true,
        default_value: "https://docs.kosmora.internal/fincore",
        validation_rules: { allowed_protocols: ["https:", "http:"] },
        secret: false
      },
      {
        key: "provider_api_secret",
        label: "Секретный ключ API",
        description: "Секретный токен (не должен утекать в ответы/экспорт/логи)",
        type: "text",
        required: false,
        default_value: "",
        secret: true
      }
    ],
    tasks: [
      {
        key: "step_research",
        title_template: "Исследование источников {{project_name}}",
        instruction_template:
          "Изучить материалы по адресу {{source_url}} для рынка {{market}} (ключ: {{provider_api_secret}}).",
        assigned_agent_role: "researcher",
        execution_mode: "autonomous",
        requested_tools: ["web_search", "citation_extractor"],
        priority: "high",
        dependencies: [],
        budget_limit: 4.0,
        max_attempts: 3,
        condition_expression: null,
        requires_owner_review: false
      },
      {
        key: "step_conditional_deep_analysis",
        title_template: "Глубокий количественный анализ ({{country}})",
        instruction_template:
          "Построить модель рисков для {{project_name}} в регионе {{country}}.",
        assigned_agent_role: "analyst",
        execution_mode: "autonomous",
        requested_tools: ["metric_calculator", "data_table_builder"],
        priority: "medium",
        dependencies: ["step_research"],
        budget_limit: 5.0,
        max_attempts: 2,
        condition_expression: "{{deep_scan}} == true",
        requires_owner_review: false
      },
      {
        key: "step_report_writer",
        title_template: "Сборка финального меморандума к {{deadline}}",
        instruction_template:
          "Собрать отчёт по цели «{{goal}}» для проекта {{project_name}}.",
        assigned_agent_role: "writer",
        execution_mode: "autonomous",
        requested_tools: ["markdown_composer", "document_reader"],
        priority: "high",
        dependencies: ["step_conditional_deep_analysis"],
        budget_limit: 4.0,
        max_attempts: 3,
        condition_expression: null,
        requires_owner_review: false
      },
      {
        key: "step_owner_review",
        title_template: "Финальная проверка и контрольная точка владельца",
        instruction_template:
          "Проверить факты меморандума {{project_name}} и передать на утверждение владельцу.",
        assigned_agent_role: "reviewer",
        execution_mode: "require_review",
        requested_tools: ["citation_verifier", "fact_consistency_checker"],
        priority: "critical",
        dependencies: ["step_report_writer"],
        budget_limit: 3.0,
        max_attempts: 2,
        condition_expression: null,
        requires_owner_review: true
      }
    ]
  };

  let customPlaybookId = "";

  try {
    // =========================================================================
    // 1. Создание личного плейбука + optimistic concurrency черновика
    // =========================================================================
    await t.test("1. Создание личного плейбука и черновое редактирование с optimistic concurrency", async () => {
      const createRes = await apiRequest<{
        playbook: {
          id: string;
          slug: string;
          status: string;
          visibility: string;
          current_version: number;
          draft_version_lock: number;
        };
        published_version: null;
      }>("POST", "/api/v1/playbooks", {
        body: {
          project_id: "proj_alpha_1",
          slug: "custom-fincore-audit",
          title: "Аудит FinCore (Личный)",
          description: "Персональный шаблон аудита для команды FinCore",
          category: "Финансовый аудит",
          tags: ["fincore", "аудит", "личный"],
          visibility: "private",
          definition: baseCustomDefinition,
          publish_immediately: false
        }
      });

      assert.equal(createRes.status, 201);
      assert.equal(createRes.data.playbook.status, "draft");
      assert.equal(createRes.data.playbook.visibility, "private");
      assert.equal(createRes.data.playbook.current_version, 0);
      assert.equal(createRes.data.playbook.draft_version_lock, 1);
      assert.equal(createRes.data.published_version, null);
      customPlaybookId = createRes.data.playbook.id;

      // Update draft with matching expected_draft_version_lock
      const patchRes = await apiRequest<{
        playbook: { draft_version_lock: number; description: string };
      }>("PATCH", `/api/v1/playbooks/${customPlaybookId}`, {
        body: {
          expected_draft_version_lock: 1,
          description: "Обновлённое описание черновика перед публикацией v1"
        }
      });
      assert.equal(patchRes.status, 200);
      assert.equal(patchRes.data.playbook.draft_version_lock, 2);

      // Stale draft_version_lock must fail with HTTP 409
      const conflictRes = await apiRequest("PATCH", `/api/v1/playbooks/${customPlaybookId}`, {
        body: {
          expected_draft_version_lock: 1,
          description: "Конфликтная запись"
        }
      });
      assert.equal(conflictRes.status, 409);
    });

    // =========================================================================
    // 2. Публикация новой версии
    // =========================================================================
    await t.test("2. Публикация версии v1 и перевод плейбука в статус active", async () => {
      const pubV1 = await apiRequest<{
        playbook: { status: string; current_version: number };
        version: {
          id: string;
          version_number: number;
          checksum_sha256: string;
          is_published: boolean;
          definition_json: string;
        };
      }>("POST", `/api/v1/playbooks/${customPlaybookId}/versions`, {
        body: {
          changelog: "Релиз первой стабильной версии v1"
        }
      });

      assert.equal(pubV1.status, 201);
      assert.equal(pubV1.data.playbook.status, "active");
      assert.equal(pubV1.data.playbook.current_version, 1);
      assert.equal(pubV1.data.version.version_number, 1);
      assert.equal(pubV1.data.version.is_published, true);
      assert.equal(pubV1.data.version.checksum_sha256.length, 64);

      const expectedHash = createHash("sha256")
        .update(pubV1.data.version.definition_json)
        .digest("hex");
      assert.equal(pubV1.data.version.checksum_sha256, expectedHash);
    });

    // =========================================================================
    // 3. Невозможность редактирования опубликованной версии
    // =========================================================================
    await t.test("3. Невозможность редактирования опубликованной версии (Immutability)", async () => {
      // Attempt to PATCH targeting published version 1 must be rejected with HTTP 409
      const immutablePatch = await apiRequest<{ error: string }>(
        "PATCH",
        `/api/v1/playbooks/${customPlaybookId}`,
        {
          body: {
            target_version: 1,
            title: "Попытка перезаписать опубликованную v1"
          }
        }
      );
      assert.equal(immutablePatch.status, 409);
      assert.equal(immutablePatch.data.error, "PLAYBOOK_IMMUTABLE_VERSION");

      // Modifying the draft and publishing v2 must leave v1 completely unchanged
      const v2Definition: PlaybookDefinition = {
        ...baseCustomDefinition,
        default_budget_limit: 28.0,
        variables: [
          ...baseCustomDefinition.variables,
          {
            key: "extra_note",
            label: "Дополнительный комментарий",
            description: "Новое поле в v2",
            type: "text",
            required: false,
            default_value: "v2-note",
            secret: false
          }
        ],
        tasks: baseCustomDefinition.tasks.map((t) =>
          t.key === "step_research" ? { ...t, budget_limit: 5.5 } : t
        )
      };

      const draftUpdate = await apiRequest(
        "PATCH",
        `/api/v1/playbooks/${customPlaybookId}`,
        {
          body: {
            definition: v2Definition
          }
        }
      );
      assert.equal(draftUpdate.status, 200);

      // Verify v1 still has 9 variables and budget_limit = 4.0 on step_research
      const v1Check = await apiRequest<{
        version: { definition: PlaybookDefinition };
      }>("GET", `/api/v1/playbooks/${customPlaybookId}/versions/1`);
      assert.equal(v1Check.status, 200);
      assert.equal(v1Check.data.version.definition.variables.length, 9);
      assert.equal(v1Check.data.version.definition.tasks[0]!.budget_limit, 4.0);

      // Publish v2
      const pubV2 = await apiRequest<{
        version: { version_number: number; definition: PlaybookDefinition };
      }>("POST", `/api/v1/playbooks/${customPlaybookId}/versions`, {
        body: {
          changelog: "Версия v2: увеличен бюджет исследования и добавлена переменная extra_note"
        }
      });
      assert.equal(pubV2.status, 201);
      assert.equal(pubV2.data.version.version_number, 2);
      assert.equal(pubV2.data.version.definition.variables.length, 10);
    });

    // =========================================================================
    // 4. Создание новой версии на основе старой (откат через новую версию)
    // =========================================================================
    await t.test("4. Откат только через создание новой версии (v3) на основе старой (v1)", async () => {
      const rollbackToV1AsV3 = await apiRequest<{
        playbook: { current_version: number };
        version: {
          version_number: number;
          checksum_sha256: string;
          definition: PlaybookDefinition;
        };
      }>("POST", `/api/v1/playbooks/${customPlaybookId}/versions`, {
        body: {
          from_version: 1,
          changelog: "Откат к конфигурации v1 через выпуск новой версии v3"
        }
      });

      assert.equal(rollbackToV1AsV3.status, 201);
      assert.equal(rollbackToV1AsV3.data.playbook.current_version, 3);
      assert.equal(rollbackToV1AsV3.data.version.version_number, 3);
      assert.equal(rollbackToV1AsV3.data.version.definition.variables.length, 9);

      const v1Get = await apiRequest<{
        version: { checksum_sha256: string };
      }>("GET", `/api/v1/playbooks/${customPlaybookId}/versions/1`);
      assert.equal(
        rollbackToV1AsV3.data.version.checksum_sha256,
        v1Get.data.version.checksum_sha256
      );

      // All 3 versions (v1, v2, v3) remain in version history
      const allVers = await apiRequest<{
        versions: Array<{ version_number: number }>;
      }>("GET", `/api/v1/playbooks/${customPlaybookId}/versions`);
      assert.equal(allVers.status, 200);
      assert.deepEqual(
        allVers.data.versions.map((v) => v.version_number),
        [3, 2, 1]
      );
    });

    // =========================================================================
    // 5. Проверка SHA-256 checksum при чтении опубликованной версии
    // =========================================================================
    await t.test("5. Проверка SHA-256 checksum и обнаружение подмены definition_json", async () => {
      const v2Row = ctx.store.getPlaybookVersionRow(customPlaybookId, 2)!;
      assert.ok(v2Row);

      // Tamper with definition_json directly in SQLite without updating checksum_sha256
      (ctx.store as unknown as { db: { prepare: (sql: string) => { run: (...args: unknown[]) => void } } }).db
        .prepare(`UPDATE playbook_versions SET definition_json = ? WHERE id = ?`)
        .run(
          v2Row.definition_json.replace('"default_budget_limit":28', '"default_budget_limit":999'),
          v2Row.id
        );

      const tamperedRead = await apiRequest<{ error: string }>(
        "GET",
        `/api/v1/playbooks/${customPlaybookId}/versions/2`
      );
      assert.equal(tamperedRead.status, 422);
      assert.equal(tamperedRead.data.error, "PLAYBOOK_CHECKSUM_MISMATCH");

      assert.throws(
        () =>
          ctx.playbooks.getVersion({
            principal: aliceSession,
            playbook_id: customPlaybookId,
            version_id: 2
          }),
        PlaybookChecksumMismatchError
      );

      // Restore original intact definition_json for subsequent tests
      (ctx.store as unknown as { db: { prepare: (sql: string) => { run: (...args: unknown[]) => void } } }).db
        .prepare(`UPDATE playbook_versions SET definition_json = ? WHERE id = ?`)
        .run(v2Row.definition_json, v2Row.id);
    });

    // =========================================================================
    // 6. Diff между версиями
    // =========================================================================
    await t.test("6. Структурированный diff между версиями (v1 vs v2)", async () => {
      const diffRes = await apiRequest<{
        diff: {
          from_version: number;
          to_version: number;
          metadata_changes: Array<{ field: string; before: unknown; after: unknown }>;
          variable_changes: Array<{ key: string; change: string }>;
          task_changes: Array<{ key: string; change: string; changed_fields: string[] }>;
          total_changes: number;
        };
      }>("GET", `/api/v1/playbooks/${customPlaybookId}/diff?from=1&to=2`);

      assert.equal(diffRes.status, 200);
      assert.equal(diffRes.data.diff.from_version, 1);
      assert.equal(diffRes.data.diff.to_version, 2);
      assert.ok(diffRes.data.diff.total_changes >= 3);
      assert.ok(
        diffRes.data.diff.metadata_changes.some(
          (m) => m.field === "default_budget_limit" && m.before === 20 && m.after === 28
        )
      );
      assert.ok(
        diffRes.data.diff.variable_changes.some(
          (v) => v.key === "extra_note" && v.change === "added"
        )
      );
      assert.ok(
        diffRes.data.diff.task_changes.some(
          (tc) =>
            tc.key === "step_research" &&
            tc.change === "modified" &&
            tc.changed_fields.includes("budget_limit")
        )
      );
    });

    // =========================================================================
    // 7. Валидация всех типов переменных (text, textarea, number, select, boolean, url)
    // =========================================================================
    await t.test("7. Успешная валидация всех 6 типов переменных (text, textarea, number, select, boolean, url)", async () => {
      const previewRes = await apiRequest<{
        preview: {
          resolved_mission_title: string;
          resolved_goal: string;
          sanitized_variables: Record<string, unknown>;
        };
      }>("POST", `/api/v1/playbooks/${customPlaybookId}/preview`, {
        body: {
          project_id: "proj_alpha_1",
          variables: {
            project_name: "Alpha Ledger",
            goal: "Провести полную сверку транзакционного ядра и лимитов",
            market: "FinTech",
            country: "Узбекистан",
            deadline: "2026-12-15",
            budget: 20,
            deep_scan: true,
            source_url: "https://ledger.alpha.internal/spec"
          }
        }
      });

      assert.equal(previewRes.status, 200);
      assert.equal(
        previewRes.data.preview.resolved_mission_title,
        "Custom Audit: Alpha Ledger (FinTech)"
      );
      assert.equal(previewRes.data.preview.sanitized_variables.budget, 20);
      assert.equal(previewRes.data.preview.sanitized_variables.deep_scan, true);
    });

    // =========================================================================
    // 8. Блокировка неизвестных или пустых обязательных переменных
    // =========================================================================
    await t.test("8. Блокировка неизвестных переменных и пустых обязательных переменных", async () => {
      const unknownVarRes = await apiRequest<{ error: string; message: string }>(
        "POST",
        `/api/v1/playbooks/${customPlaybookId}/instantiate`,
        {
          body: {
            project_id: "proj_alpha_1",
            variables: {
              undeclared_hacker_var: "should_fail"
            }
          }
        }
      );
      assert.equal(unknownVarRes.status, 400);
      assert.equal(unknownVarRes.data.error, "PlaybookVariableValidationError");
      assert.match(unknownVarRes.data.message, /undeclared_hacker_var/);

      const emptyRequiredRes = await apiRequest<{ error: string; message: string }>(
        "POST",
        `/api/v1/playbooks/${customPlaybookId}/instantiate`,
        {
          body: {
            project_id: "proj_alpha_1",
            variables: {
              project_name: "   "
            }
          }
        }
      );
      assert.equal(emptyRequiredRes.status, 400);
      assert.equal(emptyRequiredRes.data.error, "PlaybookVariableValidationError");
      assert.match(emptyRequiredRes.data.message, /project_name/);
    });

    // =========================================================================
    // 9. Блокировка невалидного URL и невалидного select-значения
    // =========================================================================
    await t.test("9. Блокировка невалидного URL и недопустимого значения select", async () => {
      const badUrlRes = await apiRequest<{ error: string; message: string }>(
        "POST",
        `/api/v1/playbooks/${customPlaybookId}/instantiate`,
        {
          body: {
            project_id: "proj_alpha_1",
            variables: {
              source_url: "not-a-valid-url"
            }
          }
        }
      );
      assert.equal(badUrlRes.status, 400);
      assert.equal(badUrlRes.data.error, "PlaybookVariableValidationError");

      const disallowedProtocolRes = await apiRequest<{ error: string }>(
        "POST",
        `/api/v1/playbooks/${customPlaybookId}/instantiate`,
        {
          body: {
            project_id: "proj_alpha_1",
            variables: {
              source_url: "javascript:alert(1)"
            }
          }
        }
      );
      assert.equal(disallowedProtocolRes.status, 400);

      const badSelectRes = await apiRequest<{ error: string; message: string }>(
        "POST",
        `/api/v1/playbooks/${customPlaybookId}/instantiate`,
        {
          body: {
            project_id: "proj_alpha_1",
            variables: {
              market: "NonExistentSector"
            }
          }
        }
      );
      assert.equal(badSelectRes.status, 400);
      assert.equal(badSelectRes.data.error, "PlaybookVariableValidationError");
      assert.match(badSelectRes.data.message, /NonExistentSector/);
    });

    // =========================================================================
    // 10. Переменная secret=true не утекает в публичный экспорт, API, логи и SSE
    // =========================================================================
    await t.test("10. Защита переменных с secret=true: отсутствие утечек в API, экспорте, логах и SSE", async () => {
      const topSecretValue = "sk_live_TOP_SECRET_NEVER_LEAK_987654321";

      const instRes = await apiRequest<{
        instantiation: {
          resolved_variables: Record<string, unknown>;
          resolved_variables_json: string;
        };
        mission: { id: string; context: string };
        tasks: Array<{ instruction: string }>;
      }>("POST", `/api/v1/playbooks/${customPlaybookId}/instantiate`, {
        body: {
          project_id: "proj_alpha_1",
          variables: {
            project_name: "Secret Guard Test",
            provider_api_secret: topSecretValue
          }
        }
      });

      assert.equal(instRes.status, 201);
      const serializedInstResponse = JSON.stringify(instRes.data);
      assert.equal(
        serializedInstResponse.includes(topSecretValue),
        false,
        "Secret value must never appear in instantiate HTTP response"
      );
      assert.equal(
        instRes.data.instantiation.resolved_variables.provider_api_secret,
        SECRET_REDACTED_PLACEHOLDER
      );
      assert.ok(
        instRes.data.tasks.some((t) => t.instruction.includes(SECRET_REDACTED_PLACEHOLDER))
      );

      const missionId = instRes.data.mission.id;

      // Check Mission Export (JSON and Markdown)
      const exportJson = await apiRequest("GET", `/api/v1/missions/${missionId}/export?format=json`);
      assert.equal(exportJson.status, 200);
      assert.equal(JSON.stringify(exportJson.data).includes(topSecretValue), false);

      const exportMd = await apiRequest("GET", `/api/v1/missions/${missionId}/export?format=markdown`);
      assert.equal(exportMd.status, 200);
      assert.equal(JSON.stringify(exportMd.data).includes(topSecretValue), false);

      // Check SSE Events stream
      const sseRes = await fetch(`${baseUrl}/api/v1/missions/${missionId}/events/stream`, {
        headers: { authorization: `Bearer ${aliceSession.token}` }
      });
      const sseText = await sseRes.text();
      assert.equal(sseText.includes(topSecretValue), false);

      // Check Playbook details & audit events
      const pbDetails = await apiRequest("GET", `/api/v1/playbooks/${customPlaybookId}`);
      assert.equal(JSON.stringify(pbDetails.data).includes(topSecretValue), false);
    });

    // =========================================================================
    // 11. Условное включение и исключение задач
    // =========================================================================
    await t.test("11. Условное включение и исключение задач ({{include_design}}, {{country}}, {{budget}})", async () => {
      // Built-in presentation-prep with include_design = false
      const previewNoDesign = await apiRequest<{
        preview: {
          included_tasks: Array<{ key: string; dependencies: string[] }>;
          excluded_tasks: Array<{ key: string; condition_expression: string; budget_saved: number }>;
          planned_budget: number;
        };
      }>("POST", "/api/v1/playbooks/pbk_builtin_presentation_prep/preview", {
        body: {
          project_id: "proj_alpha_1",
          variables: {
            include_design: false
          }
        }
      });

      assert.equal(previewNoDesign.status, 200);
      assert.equal(previewNoDesign.data.preview.included_tasks.length, 4);
      assert.equal(previewNoDesign.data.preview.excluded_tasks.length, 1);
      assert.equal(
        previewNoDesign.data.preview.excluded_tasks[0]!.key,
        "deck_visual_layout"
      );
      assert.equal(
        previewNoDesign.data.preview.excluded_tasks[0]!.budget_saved,
        4.5
      );
      // Verify reviewer task bridged its dependency from deck_visual_layout -> deck_storyline
      const reviewerTask = previewNoDesign.data.preview.included_tasks.find(
        (t) => t.key === "deck_final_review"
      )!;
      assert.deepEqual(reviewerTask.dependencies, ["deck_storyline"]);

      // Built-in market-research with country = "" excludes regional_regulations
      const previewNoCountry = await apiRequest<{
        preview: {
          included_tasks: Array<{ key: string }>;
          excluded_tasks: Array<{ key: string }>;
        };
      }>("POST", "/api/v1/playbooks/pbk_builtin_market_research/preview", {
        body: {
          project_id: "proj_alpha_1",
          variables: {
            country: ""
          }
        }
      });
      assert.equal(previewNoCountry.status, 200);
      assert.equal(previewNoCountry.data.preview.excluded_tasks.length, 1);
      assert.equal(
        previewNoCountry.data.preview.excluded_tasks[0]!.key,
        "regional_regulations"
      );

      // Built-in repository-audit with budget = 12 (< 15) excludes deep_sandbox_verification
      const previewLowBudget = await apiRequest<{
        preview: {
          included_tasks: Array<{ key: string }>;
          excluded_tasks: Array<{ key: string }>;
        };
      }>("POST", "/api/v1/playbooks/pbk_builtin_repository_audit/preview", {
        body: {
          project_id: "proj_alpha_1",
          variables: {
            budget: 12
          }
        }
      });
      assert.equal(previewLowBudget.status, 200);
      assert.equal(previewLowBudget.data.preview.excluded_tasks.length, 1);
      assert.equal(
        previewLowBudget.data.preview.excluded_tasks[0]!.key,
        "deep_sandbox_verification"
      );
    });

    // =========================================================================
    // 12. Создание реальной миссии Mission Control из шаблона и её выполнение
    // =========================================================================
    await t.test("12. Создание реальной миссии Mission Control из плейбука, запуск и прохождение HITL-ревью", async () => {
      const instRes = await apiRequest<{
        instantiation: {
          id: string;
          playbook_id: string;
          playbook_version_id: string;
          resulting_mission_id: string;
        };
        mission: { id: string; status: string; title: string };
        tasks: Array<{ id: string; status: string; assigned_agent_role: string }>;
        mission_url: string;
      }>("POST", "/api/v1/playbooks/pbk_builtin_client_project_launch/instantiate", {
        body: {
          project_id: "proj_alpha_1",
          variables: {
            project_name: "Orion Bank Rollout",
            goal: "Подготовить устав и операционный контур первой очереди",
            market: "FinTech",
            country: "Казахстан",
            deadline: "2026-11-30"
          }
        }
      });

      assert.equal(instRes.status, 201);
      const missionId = instRes.data.mission.id;
      assert.equal(instRes.data.mission.status, "ready");
      assert.equal(
        instRes.data.instantiation.resulting_mission_id,
        missionId
      );
      assert.equal(instRes.data.tasks.length, 3);
      assert.equal(
        instRes.data.tasks.filter((t) => t.status === "queued").length,
        1
      );
      assert.equal(
        instRes.data.tasks.filter((t) => t.status === "blocked").length,
        2
      );

      // Start the instantiated mission in Mission Control
      const startRes = await apiRequest<{
        mission: { id: string; status: string };
        tasks: Array<{ id: string; status: string; assigned_agent_role: string }>;
      }>("POST", `/api/v1/missions/${missionId}/start`);
      assert.equal(startRes.status, 200);
      assert.equal(startRes.data.mission.status, "waiting_for_review");

      const gateTask = startRes.data.tasks.find(
        (t) => t.status === "waiting_for_review"
      )!;
      assert.ok(gateTask);

      // Approve the final HITL checkpoint in Mission Control
      const reviewRes = await apiRequest<{
        mission: { status: string; final_artifact_id: string | null };
      }>("POST", `/api/v1/missions/${missionId}/tasks/${gateTask.id}/review`, {
        body: {
          decision: "approve",
          comment: "Пакет запуска клиентского проекта принят без замечаний."
        }
      });
      assert.equal(reviewRes.status, 200);
      assert.equal(reviewRes.data.mission.status, "completed");
      assert.ok(reviewRes.data.mission.final_artifact_id);
    });

    // =========================================================================
    // 13. Сохранение зависимостей, отсутствие циклов и блокировка битых зависимостей
    // =========================================================================
    await t.test("13. Проверка графа зависимостей: запрет циклов и несуществующих зависимостей", async () => {
      const cyclicDefinition: PlaybookDefinition = {
        ...baseCustomDefinition,
        tasks: [
          {
            ...baseCustomDefinition.tasks[0]!,
            key: "task_a",
            dependencies: ["task_b"]
          },
          {
            ...baseCustomDefinition.tasks[1]!,
            key: "task_b",
            dependencies: ["task_a"]
          }
        ]
      };

      const cycleRes = await apiRequest<{ error: string }>(
        "POST",
        "/api/v1/playbooks",
        {
          body: {
            project_id: "proj_alpha_1",
            slug: "cyclic-playbook",
            title: "Плейбук с циклом",
            description: "Должен быть отклонён",
            definition: cyclicDefinition
          }
        }
      );
      assert.equal(cycleRes.status, 400);
      assert.equal(cycleRes.data.error, "PlaybookDependencyCycleError");

      const brokenDepDefinition: PlaybookDefinition = {
        ...baseCustomDefinition,
        tasks: [
          {
            ...baseCustomDefinition.tasks[0]!,
            key: "task_only",
            dependencies: ["missing_upstream_task"]
          }
        ]
      };

      const brokenDepRes = await apiRequest<{ error: string }>(
        "POST",
        "/api/v1/playbooks",
        {
          body: {
            project_id: "proj_alpha_1",
            slug: "broken-dep-playbook",
            title: "Плейбук с битой зависимостью",
            description: "Должен быть отклонён",
            definition: brokenDepDefinition
          }
        }
      );
      assert.equal(brokenDepRes.status, 400);
      assert.equal(brokenDepRes.data.error, "PlaybookValidationError");
    });

    // =========================================================================
    // 14. Атомарный откат всей операции при ошибке
    // =========================================================================
    await t.test("14. Атомарный откат всей операции при сбое: отсутствие частично созданных миссий и задач", async () => {
      const missionsBefore = ctx.missionControl.listMissions({
        principal: aliceSession,
        project_id: "proj_alpha_1"
      });
      const detailsBefore = ctx.playbooks.getPlaybookDetails({
        principal: aliceSession,
        playbook_id: customPlaybookId
      });

      const failedInst = await apiRequest<{ error: string }>(
        "POST",
        `/api/v1/playbooks/${customPlaybookId}/instantiate`,
        {
          body: {
            project_id: "proj_alpha_1",
            variables: {
              project_name: "Rollback Target Mission"
            },
            simulate_mid_transaction_failure: true
          }
        }
      );
      assert.equal(failedInst.status, 400);

      const missionsAfter = ctx.missionControl.listMissions({
        principal: aliceSession,
        project_id: "proj_alpha_1"
      });
      const detailsAfter = ctx.playbooks.getPlaybookDetails({
        principal: aliceSession,
        playbook_id: customPlaybookId
      });

      assert.equal(
        missionsAfter.length,
        missionsBefore.length,
        "Zero partial missions may remain after mid-transaction failure"
      );
      assert.equal(
        detailsAfter.instantiations.length,
        detailsBefore.instantiations.length,
        "Zero partial playbook_instantiations rows may remain after failure"
      );
    });

    // =========================================================================
    // 15. Изоляция между пользователями, проектами и организациями
    // =========================================================================
    await t.test("15. Строгая изоляция private, project и organization плейбуков между пользователями и тенантами", async () => {
      // Bob (same tenant, different user) cannot access Alice's private playbook
      const bobReadPrivate = await apiRequest(
        "GET",
        `/api/v1/playbooks/${customPlaybookId}`,
        { token: bobSameTenantSession.token }
      );
      assert.equal(bobReadPrivate.status, 403);

      const bobInstantiatePrivate = await apiRequest(
        "POST",
        `/api/v1/playbooks/${customPlaybookId}/instantiate`,
        {
          token: bobSameTenantSession.token,
          body: { project_id: "proj_alpha_1" }
        }
      );
      assert.equal(bobInstantiatePrivate.status, 403);

      // Create a project-scoped playbook in proj_alpha_only
      const projPbRes = await apiRequest<{ playbook: { id: string } }>(
        "POST",
        "/api/v1/playbooks",
        {
          body: {
            project_id: "proj_alpha_only",
            slug: "proj-alpha-scoped",
            title: "Проектный плейбук Alpha",
            description: "Доступен участникам проекта proj_alpha_only",
            visibility: "project",
            definition: baseCustomDefinition,
            publish_immediately: true
          }
        }
      );
      assert.equal(projPbRes.status, 201);
      const projPbId = projPbRes.data.playbook.id;

      // Bob can read it when querying proj_alpha_only, but NOT from proj_other
      const bobSameProject = await apiRequest(
        "GET",
        `/api/v1/playbooks/${projPbId}?project_id=proj_alpha_only`,
        { token: bobSameTenantSession.token }
      );
      assert.equal(bobSameProject.status, 200);

      const bobWrongProject = await apiRequest(
        "GET",
        `/api/v1/playbooks/${projPbId}?project_id=proj_unrelated`,
        { token: bobSameTenantSession.token }
      );
      assert.equal(bobWrongProject.status, 403);

      // Bob cannot modify or archive Alice's project playbook
      const bobArchive = await apiRequest(
        "POST",
        `/api/v1/playbooks/${projPbId}/archive`,
        { token: bobSameTenantSession.token }
      );
      assert.equal(bobArchive.status, 403);

      // External tenant (tenant_beta) cannot access tenant_alpha's project or organization playbooks
      const orgPbRes = await apiRequest<{ playbook: { id: string } }>(
        "POST",
        "/api/v1/playbooks",
        {
          body: {
            slug: "org-alpha-shared",
            title: "Корпоративный плейбук Alpha",
            description: "Доступен всей организации tenant_alpha",
            visibility: "organization",
            definition: baseCustomDefinition,
            publish_immediately: true
          }
        }
      );
      assert.equal(orgPbRes.status, 201);
      const orgPbId = orgPbRes.data.playbook.id;

      const externalReadOrg = await apiRequest(
        "GET",
        `/api/v1/playbooks/${orgPbId}`,
        { token: externalTenantSession.token }
      );
      assert.equal(externalReadOrg.status, 403);
    });

    // =========================================================================
    // 16. Доступность встроенных плейбуков в режиме чтения без передачи владения
    // =========================================================================
    await t.test("16. Все 5 встроенных плейбуков доступны в режиме чтения без передачи владения шаблоном", async () => {
      const listRes = await apiRequest<{
        playbooks: Array<{ id: string; slug: string; visibility: string; owner_id: string }>;
      }>("GET", "/api/v1/playbooks?visibility=built_in", {
        token: externalTenantSession.token
      });

      assert.equal(listRes.status, 200);
      assert.equal(listRes.data.playbooks.length, 5);
      assert.equal(BUILT_IN_KOSMORA_PLAYBOOKS.length, 5);

      for (const builtIn of listRes.data.playbooks) {
        assert.equal(builtIn.visibility, "built_in");
        assert.equal(builtIn.owner_id, "system_kosmora");
      }

      // Attempting to edit or archive a built-in playbook must return 403 Forbidden
      const patchBuiltIn = await apiRequest(
        "PATCH",
        "/api/v1/playbooks/pbk_builtin_market_research",
        {
          token: externalTenantSession.token,
          body: { title: "Hijacked Built-in" }
        }
      );
      assert.equal(patchBuiltIn.status, 403);

      const archiveBuiltIn = await apiRequest(
        "POST",
        "/api/v1/playbooks/pbk_builtin_market_research/archive",
        { token: externalTenantSession.token }
      );
      assert.equal(archiveBuiltIn.status, 403);

      // Instantiating a built-in playbook creates a mission owned by the caller while keeping template owner = system_kosmora
      const instBuiltIn = await apiRequest<{
        mission: { owner_id: string; tenant_id: string };
      }>("POST", "/api/v1/playbooks/pbk_builtin_market_research/instantiate", {
        token: externalTenantSession.token,
        body: {
          project_id: "proj_beta_1"
        }
      });
      assert.equal(instBuiltIn.status, 201);
      assert.equal(instBuiltIn.data.mission.owner_id, "user_mallory");
      assert.equal(instBuiltIn.data.mission.tenant_id, "tenant_beta");

      const checkTemplateOwner = await apiRequest<{
        playbook: { owner_id: string };
      }>("GET", "/api/v1/playbooks/pbk_builtin_market_research", {
        token: externalTenantSession.token
      });
      assert.equal(checkTemplateOwner.data.playbook.owner_id, "system_kosmora");
    });

    // =========================================================================
    // 17. Соблюдение лимитов бюджета
    // =========================================================================
    await t.test("17. Блокировка создания миссии при превышении суммарным бюджетом задач лимита пользователя", async () => {
      // Planned budget of customPlaybookId with deep_scan=true is 4 + 5 + 4 + 3 = $16.00.
      // Passing budget_limit_override = 10.00 must be rejected with PlaybookBudgetExceededError (HTTP 400).
      const overBudgetRes = await apiRequest<{ error: string; message: string }>(
        "POST",
        `/api/v1/playbooks/${customPlaybookId}/instantiate`,
        {
          body: {
            project_id: "proj_alpha_1",
            budget_limit_override: 10.0
          }
        }
      );
      assert.equal(overBudgetRes.status, 400);
      assert.equal(overBudgetRes.data.error, "PlaybookBudgetExceededError");
    });

    // =========================================================================
    // 18. Полный API-сценарий от создания плейбука до создания миссии и архивации
    // =========================================================================
    await t.test("18. Полный сквозной API-сценарий (категории, создание, инстанцирование, связь mission <-> playbook, архивация)", async () => {
      const catsRes = await apiRequest<{
        categories: Array<{ category: string; count: number }>;
      }>("GET", "/api/v1/playbooks/categories?project_id=proj_alpha_1");
      assert.equal(catsRes.status, 200);
      assert.ok(catsRes.data.categories.length >= 5);

      const instRes = await apiRequest<{
        instantiation: { id: string; playbook_id: string; playbook_version_id: string };
        mission: { id: string };
      }>("POST", `/api/v1/playbooks/${customPlaybookId}/instantiate`, {
        body: {
          project_id: "proj_alpha_1",
          variables: {
            project_name: "Full E2E API Run",
            deep_scan: false
          }
        }
      });
      assert.equal(instRes.status, 201);

      // Verify GET /api/v1/missions/:missionId returns playbook_instantiation link
      const missionGet = await apiRequest<{
        mission: { id: string };
        tasks: Array<{ id: string }>;
        playbook_instantiation: {
          id: string;
          playbook_id: string;
          playbook_version_id: string;
        } | null;
      }>("GET", `/api/v1/missions/${instRes.data.mission.id}`);
      assert.equal(missionGet.status, 200);
      assert.equal(missionGet.data.tasks.length, 3); // deep_scan=false excluded 1 conditional task
      assert.ok(missionGet.data.playbook_instantiation);
      assert.equal(
        missionGet.data.playbook_instantiation!.playbook_id,
        customPlaybookId
      );

      // Archive the playbook and verify instantiation & editing are blocked after archiving
      const archRes = await apiRequest<{ playbook: { status: string; archived_at: string | null } }>(
        "POST",
        `/api/v1/playbooks/${customPlaybookId}/archive`
      );
      assert.equal(archRes.status, 200);
      assert.equal(archRes.data.playbook.status, "archived");
      assert.ok(archRes.data.playbook.archived_at);

      const instAfterArchive = await apiRequest(
        "POST",
        `/api/v1/playbooks/${customPlaybookId}/instantiate`,
        { body: { project_id: "proj_alpha_1" } }
      );
      assert.equal(instAfterArchive.status, 400);
    });

    // =========================================================================
    // 19. Полный UI-сценарий: выбор встроенного плейбука → заполнение переменных →
    //     предпросмотр (включая исключение условной задачи) → создание миссии → переход в миссию
    // =========================================================================
    await t.test("19. Полный UI-сценарий: каталог, переменные, предпросмотр с условным исключением задачи, создание миссии и переход в Mission Control (строгий монохром, русский интерфейс)", async () => {
      // 1) Select built-in playbook «Подготовка презентации» with include_design = true
      const vmWithDesign = buildPlaybooksViewModel({
        mode: "active",
        selected_playbook_slug: "presentation-prep",
        variable_overrides: {
          project_name: "Kosmora Q4 Board Deck",
          goal: "Утвердить инвестиционный план развития",
          market: "Enterprise AI",
          deadline: "2026-11-25",
          include_design: true
        }
      });
      assert.ok(vmWithDesign.selected_playbook);
      assert.ok(vmWithDesign.live_preview);
      assert.equal(vmWithDesign.live_preview!.included_tasks.length, 5);
      assert.equal(vmWithDesign.live_preview!.excluded_tasks.length, 0);
      assert.equal(vmWithDesign.live_preview!.planned_budget, 20.5);

      // 2) Toggle include_design = false in preview -> Designer task is excluded and budget drops to $16.00
      const vmWithoutDesign = buildPlaybooksViewModel({
        mode: "active",
        selected_playbook_slug: "presentation-prep",
        variable_overrides: {
          project_name: "Kosmora Q4 Board Deck",
          goal: "Утвердить инвестиционный план развития",
          market: "Enterprise AI",
          deadline: "2026-11-25",
          include_design: false
        },
        created_mission_id: "msn_deck_q4_created"
      });
      assert.equal(vmWithoutDesign.live_preview!.included_tasks.length, 4);
      assert.equal(vmWithoutDesign.live_preview!.excluded_tasks.length, 1);
      assert.equal(
        vmWithoutDesign.live_preview!.excluded_tasks[0]!.key,
        "deck_visual_layout"
      );
      assert.equal(vmWithoutDesign.live_preview!.planned_budget, 16.0);
      assert.equal(
        vmWithoutDesign.created_mission_link?.href,
        "/kosmora-workspace/missions?mission_id=msn_deck_q4_created"
      );

      // 3) Render PlaybooksPage, WorkspacePage, and all UI states (loading, empty, validation_error, access_denied, archived)
      const treeActive = KosmoraPlaybooksPanel({ viewModel: vmWithoutDesign });
      const treePage = KosmoraPlaybooksPage();
      const treeWorkspace = KosmoraWorkspacePage();

      const htmlActive = JSON.stringify(treeActive);
      const htmlPage = JSON.stringify(treePage);
      const htmlWorkspace = JSON.stringify(treeWorkspace);

      assert.ok(htmlActive.includes("Kosmora Playbooks — Версионируемые шаблоны миссий"));
      assert.ok(htmlActive.includes("Подготовка презентации"));
      assert.ok(htmlActive.includes("Исключённые по условиям задачи"));
      assert.ok(htmlActive.includes("deck_visual_layout"));
      assert.ok(htmlActive.includes("Создать миссию"));
      assert.ok(
        htmlActive.includes(
          "/kosmora-workspace/missions?mission_id=msn_deck_q4_created"
        )
      );
      assert.ok(htmlPage.includes("Исследование рынка"));
      assert.ok(htmlPage.includes("Аудит репозитория"));
      assert.ok(htmlPage.includes("Разбор пакета документов"));
      assert.ok(htmlPage.includes("Запуск клиентского проекта"));
      assert.ok(htmlWorkspace.includes("/kosmora-workspace/playbooks"));

      for (const mode of [
        "loading",
        "empty",
        "validation_error",
        "access_denied",
        "archived"
      ] as const) {
        const stateVm = buildPlaybooksViewModel({ mode });
        const stateTree = KosmoraPlaybooksPanel({ viewModel: stateVm });
        const stateHtml = JSON.stringify(stateTree);
        assert.ok(stateHtml.length > 50);
        assert.equal(
          /purple|#8b5cf6|#a855f7|#7c3aed|violet|indigo/i.test(stateHtml),
          false,
          `UI state '${mode}' must strictly adhere to monochrome palette without purple`
        );
      }
    });

    // =========================================================================
    // 20. Проверка миграций на чистой и существующей БД + отсутствие регрессий
    // =========================================================================
    await t.test("20. Проверка миграции 005 на чистой и существующей БД (v1..v4 -> v5) и rollback/re-apply", async () => {
      // A) Clean DB initialization
      const cleanDbPath = path.join(tmpDir, "clean-migration.sqlite");
      const cleanStore = new KosmoraRuntimeStore(cleanDbPath);
      const mig5 = cleanStore.ensurePlaybooksSchema();
      assert.equal(mig5.version, 5);
      assert.equal(mig5.name, "005_kosmora_playbooks_tables");

      const playbooksCols = cleanStore.inspectTableColumns("playbooks").map((c) => c.name);
      assert.ok(playbooksCols.includes("id"));
      assert.ok(playbooksCols.includes("draft_version_lock"));
      assert.ok(playbooksCols.includes("current_version"));

      const versionsIndexes = cleanStore
        .inspectTableIndexes("playbook_versions")
        .map((i) => i.name);
      assert.ok(
        versionsIndexes.includes("idx_playbook_versions_playbook_version")
      );

      // Test rollback and re-apply of migration 5
      assert.equal(cleanStore.rollbackMigration(5), true);
      const reapplied = cleanStore.ensurePlaybooksSchema();
      assert.equal(reapplied.version, 5);
      cleanStore.close(true);

      // B) Existing DB with Mission Control data upgraded to Playbooks
      const existingDbPath = path.join(tmpDir, "existing-upgrade.sqlite");
      const legacyStore = new KosmoraRuntimeStore(existingDbPath);
      const legacySecurity = new KosmoraEnterpriseSecurityEngine();
      const legacyMissionControl = new KosmoraMissionControlService(
        legacyStore,
        legacySecurity
      );

      const preExistingMission = legacyMissionControl.createMission({
        principal: aliceSession,
        workspace_id: "ws_alpha",
        project_id: "proj_legacy_1",
        title: "Существующая миссия до обновления Playbooks",
        goal: "Проверить сохранность данных при накатывании миграции 005"
      });
      assert.ok(preExistingMission.id);

      // Now attach KosmoraPlaybooksService to the existing store
      const upgradedPlaybooks = new KosmoraPlaybooksService(
        legacyStore,
        legacySecurity,
        legacyMissionControl
      );
      const builtIns = upgradedPlaybooks.listPlaybooks({
        principal: aliceSession
      });
      assert.equal(builtIns.length, 5);

      const preservedMission = legacyMissionControl.getMissionDetails({
        principal: aliceSession,
        mission_id: preExistingMission.id
      });
      assert.equal(
        preservedMission.mission.title,
        "Существующая миссия до обновления Playbooks"
      );
      legacyStore.close(true);
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    ctx.store.close(true);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
