"use client";

import Link from "next/link";
import { useState } from "react";
import type {
  AgentInstance,
  PlanAgentTeamResponse,
  ConfirmAgentTeamResponse
} from "@cosmora/contracts";

export type MissionExecution = {
  execution?: { project_id: string; graph_id: string; manager_node_id: string };
  runtime?: {
    status: string;
    reason: string | null;
    nodes: {
      id: string;
      title: string;
      status: string;
      artifact_count: number;
      attempts: number;
    }[];
  } | null;
};

async function post<T>(path: string, payload: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.message ?? data?.error ?? "REQUEST_FAILED");
  return data as T;
}

export function StarsExecution<Mission extends MissionExecution>({
  mission,
  onBound
}: {
  mission: Mission & { id: string; team_scope: string; version: number; stage: string };
  onBound: (mission: Mission) => void;
}) {
  const [items, setItems] = useState<AgentInstance[]>([]);
  const [manager, setManager] = useState("");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const project = encodeURIComponent(mission.team_scope);
  const team = `/api/v1/projects/${project}/agent-studio/teams`;

  const prepare = async () => {
    setPending(true);
    setNotice("");
    try {
      const plan = await post<PlanAgentTeamResponse>(team + "/plan", {});
      setItems(plan.items);
      if (plan.items.length !== 3)
        setNotice("В Agent Studio нужны три действующих описания ролей для этого проекта.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Не удалось получить состав");
    } finally {
      setPending(false);
    }
  };

  const connect = async () => {
    setPending(true);
    setNotice("");
    try {
      const { composition_id } = await post<ConfirmAgentTeamResponse>(team + "/confirm", {
        instance_ids: items.map(({ instance_id }) => instance_id)
      });
      onBound(
        await post<Mission>(`/api/v1/stars/missions/${encodeURIComponent(mission.id)}/execution`, {
          expected_version: mission.version,
          composition_id,
          manager_instance_id: manager
        })
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Не удалось связать команду");
    } finally {
      setPending(false);
    }
  };

  if (mission.execution) {
    const graph = encodeURIComponent(mission.execution.graph_id);
    const finished = mission.runtime?.status === "completed";
    return (
      <section aria-label="Исполнение миссии">
        <h2>Исполнение в Koswork</h2>
        {mission.runtime ? (
          <>
            <p role="status">
              {mission.runtime.status}
              {mission.runtime.reason ? ` · ${mission.runtime.reason}` : ""}
            </p>
            <ul>
              {mission.runtime.nodes.map((node) => (
                <li key={node.id}>
                  {node.title} · {node.status} · файлов {node.artifact_count} · попыток{" "}
                  {node.attempts}
                </li>
              ))}
            </ul>
            <Link href={`/?project=${project}&view=plan&plan=${graph}`}>
              Открыть план в Koswork
            </Link>
            {finished && (
              <p>
                <a href={`/api/v1/projects/${project}/work-dags/${graph}/results.zip`}>
                  Скачать проверенные файлы ZIP
                </a>
              </p>
            )}
          </>
        ) : (
          <p>План недоступен.</p>
        )}
      </section>
    );
  }

  if (mission.stage !== "working") return null;
  return (
    <section aria-label="Команда из Agent Studio">
      <button type="button" onClick={() => void prepare()} disabled={pending}>
        Подготовить состав Agent Studio
      </button>
      {items.length === 3 && (
        <>
          <label>
            Менеджер команды
            <select
              value={manager}
              onChange={(event) => setManager(event.target.value)}
              disabled={pending}
            >
              <option value="">Выберите менеджера</option>
              {items.map((item) => (
                <option key={item.instance_id} value={item.instance_id}>
                  {item.blueprint.task_contract.slice(0, 100)}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => void connect()} disabled={!manager || pending}>
            Подтвердить состав и подготовить план
          </button>
        </>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
