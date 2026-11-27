"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./stars.module.css";
import { StarsExecution, type MissionExecution } from "./stars-execution";

type MissionAgent = {
  id: string;
  role: "manager" | "executor" | "senior";
  task: string;
  status: string;
  context_scopes: string[];
  replaced_by?: string | null;
  handoff?: string | null;
};
type Mission = MissionExecution & {
  id: string;
  team_scope: string;
  version: number;
  goal: string;
  stage: string;
  agents: MissionAgent[];
  dependencies: Record<string, string[]>;
  messages: Array<{ from: string; to: string; text: string; at: number }>;
  results: Array<{ agent_id: string; summary: string; verification: string }>;
  combined_result: string | null;
  question: string | null;
};

const POST = async <T,>(url: string, body: unknown): Promise<T> => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(detail?.error ?? "REQUEST_FAILED");
  }
  return response.json() as Promise<T>;
};

export default function StarsPage() {
  const [mission, setMission] = useState<Mission | null>(null);
  const [scope, setScope] = useState("");
  const [projects, setProjects] = useState<{ id: string; title: string }[]>([]);
  const [creating, setCreating] = useState(false);
  const [goal, setGoal] = useState("Сравнить предложения поставщиков");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [address, setAddress] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/v1/projects", { cache: "no-store", signal: controller.signal })
      .then((response) => response.json())
      .then((data: { items?: { id: string; title: string }[] }) => setProjects(data.items ?? []))
      .catch(() => {});
    fetch("/api/v1/stars/missions", { cache: "no-store", signal: controller.signal })
      .then((response) => response.json())
      .then((data: { items?: Mission[] }) =>
        setMission((current) => current ?? data.items?.[0] ?? null)
      )
      .catch(() => {});
    return () => controller.abort();
  }, []);

  const missionId = mission?.execution ? mission.id : null;
  useEffect(() => {
    if (!missionId) return;
    const controller = new AbortController();
    const refresh = () => {
      void fetch(`/api/v1/stars/missions/${encodeURIComponent(missionId)}`, {
        cache: "no-store",
        signal: controller.signal
      })
        .then((response) => (response.ok ? (response.json() as Promise<Mission>) : null))
        .then((fresh) => {
          if (fresh) setMission((current) => (current?.id === fresh.id ? fresh : current));
        })
        .catch(() => {});
    };
    const timer = window.setInterval(refresh, 3000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [missionId]);

  const edges = useMemo(
    () =>
      Object.entries(mission?.dependencies ?? {}).flatMap(([to, deps]) =>
        deps.map((from) => ({ from, to }))
      ),
    [mission]
  );

  const start = async () => {
    if (!scope || creating || !goal.trim()) return;
    setCreating(true);
    setError("");
    try {
      const created = await POST<Mission>("/api/v1/stars/missions", {
        client_request_id: crypto.randomUUID(),
        team_scope: scope,
        goal
      });
      const planned = await POST<Mission>(`/api/v1/stars/missions/${created.id}/events`, {
        type: "brief",
        goal,
        expected_version: created.version
      });
      setMission(
        await POST<Mission>(`/api/v1/stars/missions/${created.id}/events`, {
          type: "plan",
          agents: [
            {
              id: "manager",
              role: "manager",
              task: "Собрать итог и проверить результаты",
              context_scopes: [scope]
            },
            {
              id: "extractor",
              role: "executor",
              task: "Извлечь предложения из разрешённых файлов",
              context_scopes: [scope]
            },
            {
              id: "reviewer",
              role: "executor",
              task: "Сверить комплектность и расходы",
              context_scopes: [scope]
            }
          ],
          dependencies: { manager: ["extractor", "reviewer"] },
          expected_version: planned.version
        })
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось создать миссию");
    } finally {
      setCreating(false);
    }
  };

  const event = async (body: Record<string, unknown>) => {
    if (!mission) return;
    setError("");
    try {
      setMission(
        await POST<Mission>(`/api/v1/stars/missions/${mission.id}/events`, {
          ...body,
          expected_version: mission.version
        })
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Событие отклонено");
    }
  };

  const sendAddress = async () => {
    if (!selected || !address.trim()) return;
    await event({ type: "message", from: "manager", to: selected, text: address.trim() });
    setAddress("");
  };

  return (
    <main className={styles.page} aria-label="Stars — команда агентов">
      <h1>Stars</h1>
      <section className={styles.setup}>
        <label>
          Проект команды
          <select value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="">Выберите проект</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Поручение
          <input value={goal} onChange={(e) => setGoal(e.target.value)} />
        </label>
        <button
          type="button"
          disabled={creating || !scope || !goal.trim()}
          onClick={() => void start()}
        >
          Начать миссию
        </button>
      </section>
      {error && <p role="alert">{error}</p>}
      {mission && (
        <>
          <section className={styles.summary}>
            <strong>{mission.goal}</strong>
            <span>
              стадия:{" "}
              {mission.execution ? (mission.runtime?.status ?? "недоступно") : mission.stage}
            </span>
            <span>версия: {mission.version}</span>
          </section>
          <StarsExecution
            key={mission.id}
            mission={mission}
            onBound={(bound) => {
              setMission((current) => (current?.id === bound.id ? bound : current));
            }}
          />
          {!mission.execution && (
            <>
              <section aria-label="Карта команды" className={styles.map}>
                {mission.agents.map((agent) => (
                  <button
                    key={agent.id}
                    type="button"
                    className={styles.agent}
                    data-role={agent.role}
                    data-status={agent.status}
                    onClick={() => setSelected(agent.id)}
                  >
                    <strong>{agent.id}</strong>
                    <span>{agent.role}</span>
                    <small>{agent.status}</small>
                    <span>{agent.task}</span>
                    {agent.replaced_by && <small>замена: {agent.replaced_by}</small>}
                    {agent.handoff && <small>передано: {agent.handoff}</small>}
                  </button>
                ))}
              </section>
              <p className={styles.edges}>
                Связи: {edges.length ? edges.map((e) => `${e.from} → ${e.to}`).join(", ") : "нет"}
              </p>
              <section className={styles.work}>
                <h2>Текущая работа</h2>
                <ul>
                  {mission.results.map((result) => (
                    <li key={result.agent_id}>
                      {result.agent_id}: {result.summary} — проверка: {result.verification}
                    </li>
                  ))}
                </ul>
                {mission.combined_result && <p>Общий итог: {mission.combined_result}</p>}
                {mission.question && <p role="status">Вопрос: {mission.question}</p>}
              </section>
              {selected && (
                <section className={styles.address}>
                  <h2>Обращение к {selected}</h2>
                  <input
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Новое указание агенту"
                  />
                  <button type="button" onClick={() => void sendAddress()}>
                    Отправить
                  </button>
                  <button type="button" onClick={() => void event({ type: "pause" })}>
                    Пауза
                  </button>
                  <button type="button" onClick={() => void event({ type: "resume" })}>
                    Продолжить
                  </button>
                  <button type="button" onClick={() => void event({ type: "cancel" })}>
                    Отмена
                  </button>
                </section>
              )}
            </>
          )}
        </>
      )}
    </main>
  );
}
