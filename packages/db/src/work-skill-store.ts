import type { DatabaseSync } from "node:sqlite";
import {
  CHAT_SKILLS_MAX_BYTES,
  CHAT_SKILLS_MAX_COUNT,
  type AcceptedWorkSkills,
  type ChatSkillReference,
  type ChatSkillSelection,
  type ChatSkillSnapshot
} from "@cosmora/contracts";

export class WorkSkillError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string
  ) {
    super(message);
  }
}

/** Project selection applies only at admission. Plans freeze it once for all their attempts. */
export class WorkSkillStore {
  constructor(private readonly sql: DatabaseSync) {}
  private owned(project: string, owner: string): void {
    if (!this.sql.prepare("SELECT 1 FROM projects WHERE id=? AND owner_id=?").get(project, owner))
      throw new WorkSkillError(404, "Проект не найден.");
  }
  private writable(owner: string): void {
    if (
      this.sql
        .prepare("SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=? AND state<>'active'")
        .get(owner) ||
      this.sql.prepare("SELECT 1 FROM work_owner_fences WHERE owner_id=? AND fenced=1").get(owner)
    )
      throw new WorkSkillError(409, "Данные аккаунта временно недоступны для изменения.");
  }
  get(project: string, owner: string): ChatSkillSelection {
    this.owned(project, owner);
    const current = this.sql
      .prepare("SELECT version,updated_at FROM work_skill_settings WHERE project_id=?")
      .get(project) as { version: number; updated_at: string } | undefined;
    const items = this.sql
      .prepare(
        `SELECT s.skill_id,s.version,v.name,v.summary,v.instructions
      FROM work_skill_selections s JOIN owner_skill_versions v ON v.skill_id=s.skill_id AND v.version=s.version
      WHERE s.project_id=? AND v.owner_id=? ORDER BY s.position`
      )
      .all(project, owner) as unknown as ChatSkillSnapshot[];
    return { version: current?.version ?? 0, updated_at: current?.updated_at ?? null, items };
  }
  update(
    project: string,
    owner: string,
    expected: number,
    refs: ChatSkillReference[]
  ): ChatSkillSelection {
    if (
      !Number.isSafeInteger(expected) ||
      expected < 0 ||
      expected >= Number.MAX_SAFE_INTEGER ||
      !Array.isArray(refs) ||
      refs.length > CHAT_SKILLS_MAX_COUNT ||
      refs.some(
        (r) =>
          !r ||
          typeof r.skill_id !== "string" ||
          !r.skill_id ||
          r.skill_id.length > 160 ||
          !Number.isSafeInteger(r.version) ||
          r.version < 1
      ) ||
      new Set(refs.map((r) => r.skill_id)).size !== refs.length
    )
      throw new WorkSkillError(400, "Выберите до трёх разных Skills с допустимыми версиями.");
    this.sql.exec("BEGIN IMMEDIATE");
    try {
      const current = this.get(project, owner);
      this.writable(owner);
      if (!this.sql.prepare("SELECT 1 FROM projects WHERE id=? AND status='ACTIVE'").get(project))
        throw new WorkSkillError(409, "Проект неактивен.");
      if (current.version !== expected)
        throw new WorkSkillError(
          409,
          "Skills Work изменены в другой вкладке. Загрузите сохранённый выбор."
        );
      const items = refs.map((ref) => {
        const row = this.sql
          .prepare(
            "SELECT skill_id,version,name,summary,instructions FROM owner_skill_versions WHERE skill_id=? AND version=? AND owner_id=?"
          )
          .get(ref.skill_id, ref.version, owner) as ChatSkillSnapshot | undefined;
        if (!row) throw new WorkSkillError(404, "Выбранный Skill или его версия недоступны.");
        return row;
      });
      if (new TextEncoder().encode(JSON.stringify(items)).length > CHAT_SKILLS_MAX_BYTES)
        throw new WorkSkillError(
          400,
          "Выбранные инструкции превышают общий размер 16 КБ. Сократите их или выберите меньше Skills."
        );
      this.sql
        .prepare(
          `INSERT INTO work_skill_settings(project_id,version,updated_at) VALUES(?,?,?)
        ON CONFLICT(project_id) DO UPDATE SET version=excluded.version,updated_at=excluded.updated_at`
        )
        .run(project, current.version + 1, new Date().toISOString());
      this.sql.prepare("DELETE FROM work_skill_selections WHERE project_id=?").run(project);
      const insert = this.sql.prepare(
        "INSERT INTO work_skill_selections(project_id,skill_id,version,position) VALUES(?,?,?,?)"
      );
      items.forEach((r, i) => insert.run(project, r.skill_id, r.version, i));
      const result = this.get(project, owner);
      this.sql.exec("COMMIT");
      return result;
    } catch (cause) {
      this.sql.exec("ROLLBACK");
      throw cause;
    }
  }
  /** Must run inside the transaction that creates its parent. No retroactive catalog resolution. */
  capturePlan(graph: string, project: string, owner: string): void {
    this.writable(owner);
    const s = this.get(project, owner);
    const result = this.sql
      .prepare(
        `INSERT INTO work_dag_skill_snapshots(graph_id,selection_version,skills_json,captured_at,source,source_id)
      SELECT d.id,?,?,?,'project',d.project_id FROM work_dags d JOIN projects p ON p.id=d.project_id
      WHERE d.id=? AND d.project_id=? AND d.owner_id=? AND p.owner_id=?`
      )
      .run(
        s.version,
        JSON.stringify(s.items),
        new Date().toISOString(),
        graph,
        project,
        owner,
        owner
      );
    if (Number(result.changes) !== 1) throw new WorkSkillError(404, "План не найден.");
  }
  captureWork(work: string, project: string, owner: string, graph?: string): void {
    this.writable(owner);
    const s = graph ? this.forPlan(graph, owner, project) : this.get(project, owner);
    if (!s) throw new WorkSkillError(404, "План не найден.");
    const version = "selection_version" in s ? s.selection_version : s.version;
    const result = this.sql
      .prepare(
        `INSERT INTO manager_work_skill_snapshots(work_id,selection_version,skills_json,captured_at,source,source_id)
      SELECT w.id,?,?,?,?,? FROM manager_work w JOIN projects p ON p.id=w.project_id
      WHERE w.id=? AND w.project_id=? AND w.owner_id=? AND p.owner_id=?`
      )
      .run(
        version,
        JSON.stringify(s.items),
        new Date().toISOString(),
        graph ? "plan" : "project",
        graph ?? project,
        work,
        project,
        owner,
        owner
      );
    if (Number(result.changes) !== 1) throw new WorkSkillError(404, "Задача не найдена.");
  }
  private decode(
    row:
      | {
          selection_version: number | null;
          skills_json: string | null;
          captured_at: string | null;
          source: AcceptedWorkSkills["source"] | null;
          source_id: string | null;
        }
      | undefined
  ): AcceptedWorkSkills | null {
    return row
      ? {
          selection_version: row.selection_version ?? 0,
          items: row.skills_json ? (JSON.parse(row.skills_json) as ChatSkillSnapshot[]) : [],
          captured_at: row.captured_at,
          source: row.source ?? "legacy",
          source_id: row.source_id
        }
      : null;
  }
  forWork(id: string, owner: string, project?: string): AcceptedWorkSkills | null {
    return this.decode(
      this.sql
        .prepare(
          `SELECT s.selection_version,s.skills_json,s.captured_at,s.source,s.source_id
      FROM manager_work w JOIN projects p ON p.id=w.project_id LEFT JOIN manager_work_skill_snapshots s ON s.work_id=w.id
      WHERE w.id=? AND w.owner_id=? AND p.owner_id=? AND (? IS NULL OR w.project_id=?)`
        )
        .get(id, owner, owner, project ?? null, project ?? null) as Parameters<
        WorkSkillStore["decode"]
      >[0]
    );
  }
  forPlan(id: string, owner: string, project?: string): AcceptedWorkSkills | null {
    return this.decode(
      this.sql
        .prepare(
          `SELECT s.selection_version,s.skills_json,s.captured_at,s.source,s.source_id
      FROM work_dags d JOIN projects p ON p.id=d.project_id LEFT JOIN work_dag_skill_snapshots s ON s.graph_id=d.id
      WHERE d.id=? AND d.owner_id=? AND p.owner_id=? AND (? IS NULL OR d.project_id=?)`
        )
        .get(id, owner, owner, project ?? null, project ?? null) as Parameters<
        WorkSkillStore["decode"]
      >[0]
    );
  }
}
