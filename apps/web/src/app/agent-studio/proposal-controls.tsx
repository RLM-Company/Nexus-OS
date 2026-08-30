"use client";

import { useMemo, useState, type FormEvent } from "react";
import styles from "./proposal-controls.module.css";

type Reference = { id: string; version: number };
type Blueprint = {
  blueprint_id: string;
  version: number;
  model_profile_ref: Reference;
  grant: { delegation_depth: number; valid_until: string };
};
type Proposal = {
  instance_id: string;
  blueprint: Blueprint;
  parent_instance_id: string | null;
  status: "proposed";
};

type ProposalControlsProps = {
  projectId: string;
  blueprints: Blueprint[];
  proposals: Proposal[];
  onSaved: () => Promise<void> | void;
};

const exactRefValue = (blueprint: Blueprint): string =>
  JSON.stringify({ id: blueprint.blueprint_id, version: blueprint.version });

const parseExactRef = (value: string): Reference => {
  const parsed = JSON.parse(value) as Partial<Reference>;
  if (
    typeof parsed.id !== "string" ||
    typeof parsed.version !== "number" ||
    !Number.isInteger(parsed.version)
  ) {
    throw new Error("Некорректная ссылка на blueprint");
  }
  return { id: parsed.id, version: parsed.version };
};

const shortId = (value: string): string =>
  value.length > 16 ? `${value.slice(0, 13)}…` : value;

const postProposal = async <T,>(url: string, payload: unknown): Promise<T> => {
  const response = await fetch(url, {
    method: "POST",
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      "idempotency-key": `agent-studio-ui-${crypto.randomUUID()}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(body?.error?.message ?? `Cosmora API returned ${response.status}`);
  }

  return (await response.json()) as T;
};

export default function ProposalControls({
  projectId,
  blueprints,
  proposals,
  onSaved
}: ProposalControlsProps) {
  const [pending, setPending] = useState<"root" | "delegated" | null>(null);
  const [selectedParentId, setSelectedParentId] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const parents = useMemo(
    () => proposals.filter((proposal) => proposal.blueprint.grant.delegation_depth > 0),
    [proposals]
  );
  const selectedParent = parents.find((proposal) => proposal.instance_id === selectedParentId);
  const childBlueprints = useMemo(() => {
    if (!selectedParent) return blueprints;
    const parentExpiry = Date.parse(selectedParent.blueprint.grant.valid_until);
    return blueprints.filter(
      (blueprint) =>
        blueprint.grant.delegation_depth < selectedParent.blueprint.grant.delegation_depth &&
        Date.parse(blueprint.grant.valid_until) <= parentExpiry
    );
  }, [blueprints, selectedParent]);

  const base = `/api/v1/projects/${encodeURIComponent(projectId)}/agent-studio`;

  const saveRoot = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const rawRef = String(form.get("root-blueprint") ?? "");
    if (!rawRef) return;

    setPending("root");
    setNotice(null);
    setError(null);
    try {
      await postProposal(`${base}/proposals`, { blueprint_ref: parseExactRef(rawRef) });
      await onSaved();
      setNotice("Корневое предложение сохранено. Агент остаётся в состоянии proposed.");
      formElement.reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить предложение");
    } finally {
      setPending(null);
    }
  };

  const saveDelegated = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const parentInstanceId = String(form.get("parent-instance") ?? "");
    const rawRef = String(form.get("child-blueprint") ?? "");
    if (!parentInstanceId || !rawRef) return;

    setPending("delegated");
    setNotice(null);
    setError(null);
    try {
      await postProposal(`${base}/proposals/delegated`, {
        parent_instance_id: parentInstanceId,
        blueprint_ref: parseExactRef(rawRef)
      });
      await onSaved();
      setNotice("Дочернее предложение сохранено после проверки Policy Engine.");
      formElement.reset();
      setSelectedParentId("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Policy Engine отклонил предложение");
    } finally {
      setPending(null);
    }
  };

  return (
    <div className={styles.controls}>
      <div className={styles.boundary}>
        <strong>Proposal-only</strong>
        <span>Сохранение не активирует агента и не выдаёт ему полномочия.</span>
      </div>

      <div className={styles.forms}>
        <form onSubmit={(event) => void saveRoot(event)}>
          <div className={styles.formHeading}>
            <span>Root</span>
            <strong>Корневой агент</strong>
          </div>
          <label htmlFor="root-blueprint">Точная версия blueprint</label>
          <select id="root-blueprint" name="root-blueprint" required disabled={pending !== null}>
            <option value="">Выберите blueprint</option>
            {blueprints.map((blueprint) => (
              <option
                key={`${blueprint.blueprint_id}:${blueprint.version}`}
                value={exactRefValue(blueprint)}
              >
                {shortId(blueprint.blueprint_id)} · v{blueprint.version} ·{" "}
                {blueprint.model_profile_ref.id}
              </option>
            ))}
          </select>
          <button disabled={pending !== null || blueprints.length === 0}>
            {pending === "root" ? "Сохраняю…" : "Сохранить root proposal"}
          </button>
        </form>

        <form onSubmit={(event) => void saveDelegated(event)}>
          <div className={styles.formHeading}>
            <span>Delegated</span>
            <strong>Дочерний агент</strong>
          </div>
          <label htmlFor="parent-instance">Предложенный родитель</label>
          <select
            id="parent-instance"
            name="parent-instance"
            required
            value={selectedParentId}
            onChange={(event) => setSelectedParentId(event.target.value)}
            disabled={pending !== null}
          >
            <option value="">Выберите родителя</option>
            {parents.map((proposal) => (
              <option key={proposal.instance_id} value={proposal.instance_id}>
                {shortId(proposal.instance_id)} · depth {proposal.blueprint.grant.delegation_depth}
              </option>
            ))}
          </select>
          <label htmlFor="child-blueprint">Более узкий blueprint</label>
          <select id="child-blueprint" name="child-blueprint" required disabled={pending !== null}>
            <option value="">Выберите blueprint</option>
            {childBlueprints.map((blueprint) => (
              <option
                key={`${blueprint.blueprint_id}:${blueprint.version}`}
                value={exactRefValue(blueprint)}
              >
                {shortId(blueprint.blueprint_id)} · v{blueprint.version} · depth{" "}
                {blueprint.grant.delegation_depth}
              </option>
            ))}
          </select>
          <button
            disabled={pending !== null || parents.length === 0 || childBlueprints.length === 0}
          >
            {pending === "delegated" ? "Проверяю…" : "Сохранить delegated proposal"}
          </button>
          <small>
            Финальную проверку сужения полномочий всегда выполняет Policy Engine на сервере.
          </small>
        </form>
      </div>

      {notice && <p className={styles.notice}>{notice}</p>}
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
