"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { safeApiError } from "../safe-api-error";
import { KosmoraBrandMark } from "../kosmora-brand";
import BlueprintControls from "./blueprint-controls";
import CatalogControls from "./catalog-controls";
import ProposalControls from "./proposal-controls";
import styles from "./agent-studio.module.css";

type Reference = { id: string; version: number };
type AgentFunction = {
  function_id: string;
  version: number;
  name: string;
  description: string;
};
type BehaviorPattern = {
  pattern_id: string;
  version: number;
  name: string;
  description: string;
  allowed_function_ids: string[];
  test_status: "untested" | "verified" | "restricted" | "rejected";
  archived_at: string | null;
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
type Proposal = {
  instance_id: string;
  blueprint: Blueprint;
  parent_instance_id: string | null;
  status: "proposed";
  created_at: string;
};
type DecisionEvent = {
  event_id: string;
  actor_id: string;
  operation: string;
  object_type: string;
  object_ref: Reference;
  created_at: string;
};
type StudioData = {
  functions: AgentFunction[];
  patterns: BehaviorPattern[];
  blueprints: Blueprint[];
  proposals: Proposal[];
  events: DecisionEvent[];
};

const emptyData: StudioData = {
  functions: [],
  patterns: [],
  blueprints: [],
  proposals: [],
  events: []
};

const api = async <T,>(url: string): Promise<T> => {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw safeApiError(response);
  return (await response.json()) as T;
};

const shortId = (value: string): string => (value.length > 16 ? `${value.slice(0, 13)}…` : value);
const dateTime = (value: string): string =>
  new Date(value).toLocaleString("ru", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });

const operationLabel: Record<string, string> = {
  "function.create": "Создана функция",
  "function.version": "Новая версия функции",
  "pattern.create": "Создан паттерн",
  "pattern.version": "Новая версия паттерна",
  "pattern.archive": "Паттерн архивирован",
  "blueprint.create": "Создан чертёж",
  "blueprint.version": "Новая версия чертежа",
  "proposal.root": "Предложен корневой агент",
  "proposal.delegated": "Предложен дочерний агент"
};

export default function AgentStudioPage() {
  const [projectId, setProjectId] = useState("");
  const [draftProjectId, setDraftProjectId] = useState("");
  const [data, setData] = useState<StudioData>(emptyData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (id: string): Promise<void> => {
    setLoading(true);
    setError(null);
    const base = `/api/v1/projects/${encodeURIComponent(id)}/agent-studio`;
    try {
      const [functions, patterns, blueprints, proposals, events] = await Promise.all([
        api<{ items: AgentFunction[] }>(`${base}/functions`),
        api<{ items: BehaviorPattern[] }>(`${base}/patterns`),
        api<{ items: Blueprint[] }>(`${base}/blueprints`),
        api<{ items: Proposal[] }>(`${base}/proposals`),
        api<{ items: DecisionEvent[] }>(`${base}/decision-events?limit=50`)
      ]);
      setData({
        functions: functions.items,
        patterns: patterns.items,
        blueprints: blueprints.items,
        proposals: proposals.items,
        events: events.items
      });
    } catch (cause) {
      setData(emptyData);
      setError(cause instanceof Error ? cause.message : "Не удалось загрузить Agent Studio");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("project")?.trim() ?? "";
    setProjectId(id);
    setDraftProjectId(id);
    if (id) void load(id);
  }, [load]);

  const openProject = (event: FormEvent): void => {
    event.preventDefault();
    const id = draftProjectId.trim();
    if (!id) return;
    window.history.replaceState(null, "", `/agent-studio?project=${encodeURIComponent(id)}`);
    setProjectId(id);
    void load(id);
  };

  return (
    <main className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <span className={styles.orbit} aria-hidden="true">
            <KosmoraBrandMark />
          </span>
          <div>
            <span>Kosmora</span>
            <strong>Agent Studio</strong>
          </div>
        </div>
        <div className={styles.safety}>
          <i /> Control plane · агенты не запущены
        </div>
        <Link href="/" className={styles.back}>
          ← Рабочая область
        </Link>
      </header>

      <section className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>Конструктор команды</span>
          <h1>Структура агентов под контролем владельца</h1>
          <p>
            Создавайте версионируемые функции, паттерны и чертежи, затем сохраняйте предложения
            команды. Этот экран не активирует агентов, не превращает declared grant в реальные
            полномочия и не запускает модель или инструмент.
          </p>
        </div>
        <form className={styles.projectForm} onSubmit={openProject}>
          <label htmlFor="project-id">ID проекта</label>
          <div>
            <input
              id="project-id"
              value={draftProjectId}
              onChange={(event) => setDraftProjectId(event.target.value)}
              placeholder="project-id"
              autoComplete="off"
            />
            <button disabled={!draftProjectId.trim() || loading}>
              {loading ? "Загрузка…" : "Открыть"}
            </button>
          </div>
        </form>
      </section>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {!projectId ? (
        <section className={styles.emptyState}>
          <span>01</span>
          <h2>Выберите проект</h2>
          <p>
            Скопируйте ID проекта из Control Center. Данные других владельцев не будут показаны.
          </p>
        </section>
      ) : (
        <>
          <section className={styles.metrics} aria-label="Сводка Agent Studio">
            {[
              ["Функции", data.functions.length],
              ["Паттерны", data.patterns.length],
              ["Чертежи", data.blueprints.length],
              ["Предложения", data.proposals.length]
            ].map(([label, value]) => (
              <article key={String(label)}>
                <span>{label}</span>
                <strong>{value}</strong>
              </article>
            ))}
          </section>

          <div className={styles.grid}>
            <section className={styles.panel}>
              <header>
                <div>
                  <span className={styles.eyebrow}>Команда</span>
                  <h2>Предложенные агенты</h2>
                </div>
                <button className={styles.refresh} onClick={() => void load(projectId)}>
                  Обновить
                </button>
              </header>
              <ProposalControls
                projectId={projectId}
                blueprints={data.blueprints}
                proposals={data.proposals}
                onSaved={() => load(projectId)}
              />
              <div className={styles.list}>
                {data.proposals.map((proposal) => (
                  <article className={styles.proposal} key={proposal.instance_id}>
                    <div className={styles.proposalMark}>
                      {proposal.parent_instance_id ? "↳" : "◎"}
                    </div>
                    <div>
                      <strong>
                        {proposal.parent_instance_id ? "Дочерний агент" : "Корневой агент"}
                      </strong>
                      <span>
                        {shortId(proposal.instance_id)} · blueprint v{proposal.blueprint.version}
                      </span>
                      <small>
                        {proposal.blueprint.model_profile_ref.id} · делегирование до уровня{" "}
                        {proposal.blueprint.grant.delegation_depth}
                      </small>
                    </div>
                    <em>proposed</em>
                  </article>
                ))}
                {!loading && data.proposals.length === 0 && (
                  <p className={styles.muted}>В этом проекте пока нет предложенных агентов.</p>
                )}
              </div>
            </section>

            <section className={styles.panel}>
              <header>
                <div>
                  <span className={styles.eyebrow}>Decision Trace</span>
                  <h2>Последние изменения</h2>
                </div>
                <span className={styles.contentFree}>без содержимого</span>
              </header>
              <div className={styles.timeline}>
                {data.events.map((event) => (
                  <article key={event.event_id}>
                    <i />
                    <div>
                      <strong>{operationLabel[event.operation] ?? event.operation}</strong>
                      <span>
                        {event.object_type} · {shortId(event.object_ref.id)} · v
                        {event.object_ref.version}
                      </span>
                      <small>
                        {dateTime(event.created_at)} · {shortId(event.actor_id)}
                      </small>
                    </div>
                  </article>
                ))}
                {!loading && data.events.length === 0 && (
                  <p className={styles.muted}>Изменения через Agent Studio API ещё не записаны.</p>
                )}
              </div>
            </section>
          </div>

          <div className={styles.grid}>
            <section className={styles.panel}>
              <header>
                <div>
                  <span className={styles.eyebrow}>Каталог</span>
                  <h2>Функции и паттерны</h2>
                </div>
              </header>
              <CatalogControls
                projectId={projectId}
                functions={data.functions}
                patterns={data.patterns}
                onSaved={() => load(projectId)}
              />
              <div className={styles.catalogColumns}>
                <div>
                  <h3>Функции</h3>
                  {data.functions.map((item) => (
                    <article className={styles.catalogItem} key={item.function_id}>
                      <strong>{item.name}</strong>
                      <span>{item.description}</span>
                      <small>
                        v{item.version} · {shortId(item.function_id)}
                      </small>
                    </article>
                  ))}
                </div>
                <div>
                  <h3>Паттерны</h3>
                  {data.patterns.map((item) => (
                    <article className={styles.catalogItem} key={item.pattern_id}>
                      <strong>{item.name}</strong>
                      <span>{item.description}</span>
                      <small>
                        v{item.version} · {item.test_status}
                      </small>
                    </article>
                  ))}
                </div>
              </div>
            </section>

            <section className={styles.panel}>
              <header>
                <div>
                  <span className={styles.eyebrow}>Blueprint Registry</span>
                  <h2>Чертежи агентов</h2>
                </div>
              </header>
              <BlueprintControls
                projectId={projectId}
                functions={data.functions}
                patterns={data.patterns}
                blueprints={data.blueprints}
                onSaved={() => load(projectId)}
              />
              <div className={styles.list}>
                {data.blueprints.map((item) => (
                  <article className={styles.blueprint} key={item.blueprint_id}>
                    <div>
                      <strong>{shortId(item.blueprint_id)}</strong>
                      <span>
                        v{item.version} · {item.model_profile_ref.id}
                      </span>
                    </div>
                    <dl>
                      <div>
                        <dt>Функция</dt>
                        <dd>{shortId(item.function_ref.id)}</dd>
                      </div>
                      <div>
                        <dt>Паттерн</dt>
                        <dd>{shortId(item.behavior_pattern_ref.id)}</dd>
                      </div>
                      <div>
                        <dt>Глубина</dt>
                        <dd>{item.grant.delegation_depth}</dd>
                      </div>
                    </dl>
                  </article>
                ))}
                {!loading && data.blueprints.length === 0 && (
                  <p className={styles.muted}>Чертежи ещё не созданы.</p>
                )}
              </div>
            </section>
          </div>
        </>
      )}
    </main>
  );
}
