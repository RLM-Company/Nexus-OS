"use client";
import { useEffect, useState } from "react";
import styles from "./stars.module.css";

type OrgNode = {
  id: string;
  role: string;
  manager_id: string | null;
  responsibility_zones: string[];
  project_ids: string[];
  status: "active" | "removed";
};
type Org = {
  team_scope: string;
  version: number;
  nodes: OrgNode[];
  checksum: string;
};

/** Read-only view of the durable Stars team composition. The authoritative
 * writes go through the org API; this panel never keeps a second status copy. */
export function StarsOrgPanel({ scope }: { scope: string }) {
  const [org, setOrg] = useState<Org | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!scope) return;
    const controller = new AbortController();
    fetch(`/api/v1/stars/org/${encodeURIComponent(scope)}`, {
      cache: "no-store",
      signal: controller.signal
    })
      .then((response) => {
        if (response.status === 404) return null;
        if (!response.ok) throw new Error("ORG_UNAVAILABLE");
        return response.json() as Promise<Org>;
      })
      .then(setOrg)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "ORG_UNAVAILABLE");
      });
    return () => controller.abort();
  }, [scope]);
  if (!scope) return null;
  return (
    <section aria-label="Состав постоянной команды" className={styles.work}>
      <h2>Состав команды</h2>
      {error && <p role="alert">{error}</p>}
      {!org && !error && <p>Состав не настроен.</p>}
      {org && (
        <>
          <p>
            Версия {org.version} · контрольная сумма {org.checksum.slice(0, 12)}
          </p>
          <ul>
            {org.nodes.map((node) => (
              <li key={node.id}>
                <strong>{node.id}</strong> — {node.role}
                {node.manager_id ? `, руководитель: ${node.manager_id}` : ""}
                {node.responsibility_zones.length
                  ? `, зоны: ${node.responsibility_zones.join(", ")}`
                  : ""}
                {node.project_ids.length ? `, проекты: ${node.project_ids.join(", ")}` : ""}
                {node.status !== "active" ? " (неактивен)" : ""}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
