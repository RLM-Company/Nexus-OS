"use client";

import { useMemo, useState, type FormEvent } from "react";
import { safeApiError } from "../safe-api-error";
import styles from "./blueprint-controls.module.css";

type Reference = { id: string; version: number };
type AgentFunction = {
  function_id: string;
  version: number;
  name: string;
};
type BehaviorPattern = {
  pattern_id: string;
  version: number;
  name: string;
  allowed_function_ids: string[];
};
type Blueprint = {
  blueprint_id: string;
  version: number;
  function_ref: Reference;
  behavior_pattern_ref: Reference;
  model_profile_ref: Reference;
  grant: {
    capability_ids: string[];
    tool_ids: string[];
    data_scope_ids: string[];
    object_ids: string[];
    budget: {
      currency: string;
      money_minor: number;
      tokens: number;
      operations: number;
    };
    delegation_depth: number;
    valid_until: string;
  };
  memory_scope: {
    read_mode: "none" | "task" | "project_segments" | "handoff";
    source_ids: string[];
    write_back: "none" | "result_only" | "result_and_evidence";
  };
  task_contract: string;
  start_condition: string;
  close_conditions: string[];
};

type BlueprintControlsProps = {
  projectId: string;
  functions: AgentFunction[];
  patterns: BehaviorPattern[];
  blueprints: Blueprint[];
  onSaved: () => Promise<void> | void;
};

const CAPABILITY_IDS = [
  "context.web.read",
  "context.project.read",
  "context.global.read",
  "workspace.write",
  "integration.private.use",
  "external.communicate",
  "audience.expand",
  "account.manage",
  "production.deploy",
  "finance.spend",
  "finance.credit",
  "legal.accept_terms",
  "contract.finalize",
  "data.disclose",
  "agent.manage",
  "prompt.temporary",
  "prompt.permanent",
  "strategy.change",
  "sandbox.experiment"
] as const;

const formString = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
};

const lines = (value: string): string[] =>
  value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);

const numberValue = (form: FormData, name: string): number => {
  const value = Number(formString(form, name));
  return Number.isFinite(value) && value >= 0 ? value : 0;
};

const readError = (response: Response): Error => safeApiError(response);

export default function BlueprintControls({
  projectId,
  functions,
  patterns,
  blueprints,
  onSaved
}: BlueprintControlsProps) {
  const [target, setTarget] = useState("");
  const [functionId, setFunctionId] = useState(functions[0]?.function_id ?? "");
  const [patternId, setPatternId] = useState("");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedBlueprint = blueprints.find((item) => item.blueprint_id === target);
  const selectedFunction = functions.find((item) => item.function_id === functionId);
  const eligiblePatterns = useMemo(
    () => patterns.filter((item) => item.allowed_function_ids.includes(functionId)),
    [patterns, functionId]
  );
  const selectedPattern = eligiblePatterns.find((item) => item.pattern_id === patternId);
  const base = `/api/v1/projects/${encodeURIComponent(projectId)}/agent-studio`;

  const chooseTarget = (blueprintId: string): void => {
    setTarget(blueprintId);
    const blueprint = blueprints.find((item) => item.blueprint_id === blueprintId);
    if (!blueprint) {
      setFunctionId(functions[0]?.function_id ?? "");
      setPatternId("");
      return;
    }
    setFunctionId(blueprint.function_ref.id);
    const patternStillActive = patterns.some(
      (item) =>
        item.pattern_id === blueprint.behavior_pattern_ref.id &&
        item.allowed_function_ids.includes(blueprint.function_ref.id)
    );
    setPatternId(patternStillActive ? blueprint.behavior_pattern_ref.id : "");
  };

  const chooseFunction = (nextFunctionId: string): void => {
    setFunctionId(nextFunctionId);
    const stillEligible = patterns.some(
      (item) => item.pattern_id === patternId && item.allowed_function_ids.includes(nextFunctionId)
    );
    if (!stillEligible) setPatternId("");
  };

  const save = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!selectedFunction || !selectedPattern) return;
    const form = new FormData(event.currentTarget);
    const validUntilRaw = formString(form, "valid-until");
    const validUntilDate = new Date(validUntilRaw);
    if (!validUntilRaw || Number.isNaN(validUntilDate.getTime())) {
      setError("Укажите корректный valid_until в ISO-формате.");
      return;
    }

    const capabilityIds = form
      .getAll("capability")
      .filter((value): value is string => typeof value === "string" && value.length > 0);
    const closeConditions = lines(formString(form, "close-conditions"));
    const taskContract = formString(form, "task-contract");
    const startCondition = formString(form, "start-condition");
    const modelProfileId = formString(form, "model-profile-id");
    if (!taskContract || !startCondition || closeConditions.length === 0 || !modelProfileId) return;

    const payload = {
      function_ref: { id: selectedFunction.function_id, version: selectedFunction.version },
      behavior_pattern_ref: { id: selectedPattern.pattern_id, version: selectedPattern.version },
      model_profile_ref: {
        id: modelProfileId,
        version: Math.max(1, numberValue(form, "model-profile-version"))
      },
      grant: {
        capability_ids: capabilityIds,
        tool_ids: lines(formString(form, "tool-ids")),
        data_scope_ids: lines(formString(form, "data-scope-ids")),
        object_ids: lines(formString(form, "object-ids")),
        budget: {
          currency: formString(form, "currency") || "USD",
          money_minor: numberValue(form, "money-minor"),
          tokens: numberValue(form, "tokens"),
          operations: numberValue(form, "operations")
        },
        delegation_depth: Math.min(16, numberValue(form, "delegation-depth")),
        valid_until: validUntilDate.toISOString()
      },
      memory_scope: {
        read_mode: formString(form, "memory-read-mode"),
        source_ids: lines(formString(form, "memory-source-ids")),
        write_back: formString(form, "memory-write-back")
      },
      task_contract: taskContract,
      start_condition: startCondition,
      close_conditions: closeConditions
    };

    setPending(true);
    setNotice(null);
    setError(null);
    try {
      const isVersion = Boolean(selectedBlueprint);
      const url = selectedBlueprint
        ? `${base}/blueprints/${encodeURIComponent(selectedBlueprint.blueprint_id)}/versions`
        : `${base}/blueprints`;
      const response = await fetch(url, {
        method: "POST",
        cache: "no-store",
        headers: {
          "content-type": "application/json",
          ...(isVersion ? {} : { "idempotency-key": `agent-studio-ui-${crypto.randomUUID()}` })
        },
        body: JSON.stringify(
          selectedBlueprint ? { ...payload, expected_version: selectedBlueprint.version } : payload
        )
      });
      if (!response.ok) throw readError(response);
      setNotice(
        selectedBlueprint
          ? `Новая версия чертежа сохранена: v${selectedBlueprint.version + 1}.`
          : "Чертёж сохранён как immutable v1. Агент не активирован."
      );
      await onSaved();
      setTarget("");
      setPatternId("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить чертёж");
    } finally {
      setPending(false);
    }
  };

  const defaults = selectedBlueprint;
  const formKey = defaults ? `${defaults.blueprint_id}:${defaults.version}` : "new";

  return (
    <div className={styles.composer}>
      <div className={styles.boundary}>
        <strong>Declared grant only</strong>
        <span>
          Чертёж описывает будущие границы агента. Сохранение не выдаёт полномочия и не запускает
          runtime.
        </span>
      </div>

      <label className={styles.mode} htmlFor="blueprint-target">
        <span>Режим</span>
        <select
          id="blueprint-target"
          value={target}
          onChange={(event) => chooseTarget(event.target.value)}
          disabled={pending}
        >
          <option value="">Создать новый blueprint v1</option>
          {blueprints.map((item) => (
            <option key={item.blueprint_id} value={item.blueprint_id}>
              Новая версия · {item.blueprint_id.slice(0, 10)}… · v{item.version}
            </option>
          ))}
        </select>
      </label>

      <form key={formKey} className={styles.form} onSubmit={(event) => void save(event)}>
        <div className={styles.row}>
          <label>
            <span>Функция · exact latest version</span>
            <select
              id="blueprint-function"
              value={functionId}
              onChange={(event) => chooseFunction(event.target.value)}
              disabled={pending || functions.length === 0}
              required
            >
              <option value="">Выберите функцию</option>
              {functions.map((item) => (
                <option key={item.function_id} value={item.function_id}>
                  {item.name} · v{item.version}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Паттерн · разрешён для функции</span>
            <select
              id="blueprint-pattern"
              value={patternId}
              onChange={(event) => setPatternId(event.target.value)}
              disabled={pending || !functionId || eligiblePatterns.length === 0}
              required
            >
              <option value="">Выберите активный паттерн</option>
              {eligiblePatterns.map((item) => (
                <option key={item.pattern_id} value={item.pattern_id}>
                  {item.name} · v{item.version}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className={styles.row}>
          <label>
            <span>Model profile ID</span>
            <input
              id="model-profile-id"
              name="model-profile-id"
              defaultValue={defaults?.model_profile_ref.id ?? "cosmora-mars"}
              disabled={pending}
              required
            />
          </label>
          <label>
            <span>Model profile version</span>
            <input
              id="model-profile-version"
              name="model-profile-version"
              type="number"
              min={1}
              defaultValue={defaults?.model_profile_ref.version ?? 1}
              disabled={pending}
              required
            />
          </label>
        </div>

        <fieldset>
          <legend>Capability IDs · декларация, не активный grant</legend>
          <div className={styles.capabilities}>
            {CAPABILITY_IDS.map((capability) => (
              <label key={capability} className={styles.check}>
                <input
                  type="checkbox"
                  name="capability"
                  value={capability}
                  defaultChecked={
                    defaults?.grant.capability_ids.includes(capability) ??
                    capability === "context.project.read"
                  }
                  disabled={pending}
                />
                <span>{capability}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className={styles.rowThree}>
          <label>
            <span>Tool IDs · по одному на строку</span>
            <textarea
              name="tool-ids"
              rows={3}
              defaultValue={defaults?.grant.tool_ids.join("\n") ?? ""}
              disabled={pending}
            />
          </label>
          <label>
            <span>Data scope IDs</span>
            <textarea
              name="data-scope-ids"
              rows={3}
              defaultValue={defaults?.grant.data_scope_ids.join("\n") ?? "project-memory"}
              disabled={pending}
            />
          </label>
          <label>
            <span>Object IDs</span>
            <textarea
              name="object-ids"
              rows={3}
              defaultValue={defaults?.grant.object_ids.join("\n") ?? projectId}
              disabled={pending}
            />
          </label>
        </div>

        <div className={styles.rowFour}>
          <label>
            <span>Currency</span>
            <input
              name="currency"
              defaultValue={defaults?.grant.budget.currency ?? "USD"}
              required
            />
          </label>
          <label>
            <span>Money minor</span>
            <input
              name="money-minor"
              type="number"
              min={0}
              defaultValue={defaults?.grant.budget.money_minor ?? 0}
              required
            />
          </label>
          <label>
            <span>Tokens</span>
            <input
              name="tokens"
              type="number"
              min={0}
              defaultValue={defaults?.grant.budget.tokens ?? 1000}
              required
            />
          </label>
          <label>
            <span>Operations</span>
            <input
              name="operations"
              type="number"
              min={0}
              defaultValue={defaults?.grant.budget.operations ?? 0}
              required
            />
          </label>
        </div>

        <div className={styles.row}>
          <label>
            <span>Delegation depth · 0–16</span>
            <input
              id="delegation-depth"
              name="delegation-depth"
              type="number"
              min={0}
              max={16}
              defaultValue={defaults?.grant.delegation_depth ?? 0}
              required
            />
          </label>
          <label>
            <span>Valid until · ISO 8601</span>
            <input
              id="valid-until"
              name="valid-until"
              defaultValue={defaults?.grant.valid_until ?? "2030-01-01T00:00:00.000Z"}
              disabled={pending}
              required
            />
          </label>
        </div>

        <div className={styles.rowThree}>
          <label>
            <span>Memory read mode</span>
            <select
              name="memory-read-mode"
              defaultValue={defaults?.memory_scope.read_mode ?? "project_segments"}
              disabled={pending}
            >
              <option value="none">none</option>
              <option value="task">task</option>
              <option value="project_segments">project_segments</option>
              <option value="handoff">handoff</option>
            </select>
          </label>
          <label>
            <span>Memory source IDs</span>
            <textarea
              name="memory-source-ids"
              rows={3}
              defaultValue={defaults?.memory_scope.source_ids.join("\n") ?? "project-memory"}
              disabled={pending}
            />
          </label>
          <label>
            <span>Write back</span>
            <select
              name="memory-write-back"
              defaultValue={defaults?.memory_scope.write_back ?? "result_and_evidence"}
              disabled={pending}
            >
              <option value="none">none</option>
              <option value="result_only">result_only</option>
              <option value="result_and_evidence">result_and_evidence</option>
            </select>
          </label>
        </div>

        <label>
          <span>Task contract</span>
          <textarea
            id="task-contract"
            name="task-contract"
            rows={3}
            defaultValue={defaults?.task_contract ?? "Return the bounded project result."}
            disabled={pending}
            required
          />
        </label>
        <label>
          <span>Start condition</span>
          <textarea
            id="start-condition"
            name="start-condition"
            rows={2}
            defaultValue={
              defaults?.start_condition ??
              "A later activation increment explicitly approves the proposal."
            }
            disabled={pending}
            required
          />
        </label>
        <label>
          <span>Close conditions · по одному на строку</span>
          <textarea
            id="close-conditions"
            name="close-conditions"
            rows={3}
            defaultValue={defaults?.close_conditions.join("\n") ?? "The result is accepted."}
            disabled={pending}
            required
          />
        </label>

        <button
          disabled={
            pending || !selectedFunction || !selectedPattern || eligiblePatterns.length === 0
          }
        >
          {pending
            ? "Сохраняю…"
            : selectedBlueprint
              ? `Создать blueprint v${selectedBlueprint.version + 1}`
              : "Создать blueprint v1"}
        </button>
      </form>

      {eligiblePatterns.length === 0 && functionId && (
        <p className={styles.warning}>Для выбранной функции нет активного разрешающего паттерна.</p>
      )}
      {notice && (
        <p className={styles.notice} role="status" aria-live="polite">
          {notice}
        </p>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
