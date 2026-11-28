"use client";

import { useEffect, useMemo, useState } from "react";
import { startVisibleReadPolling } from "../visible-read-poller";
import { acceptsStarsProgress } from "../task-runtime-evidence";
import styles from "./stars.module.css";
import { StarsExecution, type MissionExecution } from "./stars-execution";
import { StarsOrgPanel } from "./stars-org-panel";

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
  messages: Array<{ id: string; from: string; to: string; text: string; at: number }>;
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
  const [replacement, setReplacement] = useState("");
  const [readIssue, setReadIssue] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/v1/projects", { cache: "no-store", signal: controller.signal })
      .then((response) => response.json())
      .then((data: { items?: { id: string; title: string }[] }) => setProjects(data.items ?? []))
      .catch(() => {});
    const chosen = new URLSearchParams(window.location.search).get("mission");
    const path = "/api/v1/stars/missions" + (chosen ? "/" + encodeURIComponent(chosen) : "");
    void fetch(path, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("MISSION_UNAVAILABLE");
        const data = (await response.json()) as Mission & { items?: Mission[] };
        if (chosen && data.id !== chosen) throw new Error("MISSION_MISMATCH");
        if (!controller.signal.aborted)
          setMission((current) => current ?? (chosen ? data : (data.items?.[0] ?? null)));
      })
      .catch(() => {
        if (!controller.signal.aborted && chosen) setReadIssue("Сохранённая миссия недоступна.");
      });
    return () => controller.abort();
  }, []);

  const selectedId = mission?.id;
  useEffect(() => {
    if (!selectedId) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("mission") === selectedId) return;
    url.searchParams.set("mission", selectedId);
    window.history.replaceState(window.history.state, "", url);
  }, [selectedId]);

  const missionId = mission?.execution ? mission.id : null;
  useEffect(() => {
    if (!missionId) return;
    return startVisibleReadPolling(
      async (signal) => {
        const response = await fetch(`/api/v1/stars/missions/${encodeURIComponent(missionId)}`, {
          cache: "no-store",
          signal: AbortSignal.any([signal, AbortSignal.timeout(8000)])
        });
        if (signal.aborted) return;
        if ([401, 403, 404, 410].includes(response.status)) {
          setMission((current) => (current?.id === missionId ? null : current));
          setReadIssue("Миссия недоступна.");
          return;
        }
        if (!response.ok) throw new Error("MISSION_READ_FAILED");
        const fresh = (await response.json()) as Mission;
        if (signal.aborted) return;
        if (fresh.id !== missionId) throw new Error("MISSION_READ_MISMATCH");
        setMission((current) =>
          current && acceptsStarsProgress(current, fresh) ? fresh : current
        );
        setReadIssue("");
      },
      {
        intervalMs: 3000,
        onError: () =>
          setReadIssue("Связь прервана. Показано последнее подтверждённое состояние миссии.")
      }
    );
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
    setReadIssue("");
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
      {readIssue && <p role="alert">{readIssue}</p>}
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
          <StarsOrgPanel scope={mission?.team_scope ?? scope} />
          <StarsExecution
            key={mission.id}
            mission={mission}
            onBound={(bound) => {
              setMission((current) =>
                current && acceptsStarsProgress(current, bound) ? bound : current
              );
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
                {mission.messages.length > 0 && (
                  <ul aria-label="История сообщений команды">
                    {mission.messages.map((message) => (
                      <li key={message.id}>
                        {message.from} → {message.to}: {message.text}
                      </li>
                    ))}
                  </ul>
                )}
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
                  <input
                    value={replacement}
                    onChange={(e) => setReplacement(e.target.value)}
                    placeholder="ID заменяющего агента"
                    aria-label="ID заменяющего агента"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      void event({ type: "fail", agent_id: selected, reason: "owner_stop" })
                    }
                  >
                    Остановить агента
                  </button>
                  <button
                    type="button"
                    disabled={!replacement.trim()}
                    onClick={() =>
                      void event({
                        type: "replace",
                        failed_agent_id: selected,
                        replacement_id: replacement.trim()
                      })
                    }
                  >
                    Заменить
                  </button>
                  <button type="button" onClick={() => void event({ type: "resume" })}>
                    Повторить
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
