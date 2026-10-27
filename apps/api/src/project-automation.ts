import { createHash } from "node:crypto";
import {
  isWorkDeadline,
  type PlaybookDefinition,
  type PlaybookInstantiate,
  type AutomationScheduleInput,
  type EvaluationSuiteInput,
  type KnowledgeCollectionInput
} from "@cosmora/contracts";
import {
  automationHash,
  renderPlaybook,
  validatePlaybookDefinition,
  validateEvaluationRules,
  evaluateSavedFiles
} from "@cosmora/core";
import {
  AutomationStoreError,
  type ProjectAutomationStore,
  type AutomationScope,
  type AutomationRecord,
  type ManagerWorkStore
} from "@cosmora/db";
import type { ProjectKnowledge } from "./project-knowledge.js";

type Playbook = { title: string; published_version: number; archived: boolean };
type Published = {
  playbook_id: string;
  number: number;
  definition: PlaybookDefinition;
  checksum: string;
  changelog: string;
  actor_id: string;
};
type Instantiation = {
  playbook_id: string;
  playbook_version: number;
  dag_id: string;
  actor_id: string;
  definition_sha256: string;
  variables_sha256: string;
};
type Schedule = Omit<AutomationScheduleInput, "client_request_id" | "due_at"> & {
  next_due_at: string | null;
  paused: boolean;
  created_by: string;
};
type Occurrence = {
  schedule_id: string;
  due_at: string;
  coalesced_intervals: number;
  playbook_id: string;
  playbook_version: number;
  variables: Record<string, string>;
  requires_owner_start: true;
};
const missing = (): never => {
  throw new AutomationStoreError("AUTOMATION_NOT_FOUND");
};
const conflict = (message: string): never => {
  throw new AutomationStoreError(message);
};
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

/** Gemini's five domains adapted to the existing verified identity, native DB and Work runtime.
 * No independent bearer tokens, synthetic agents, standalone databases or model dispatches. */
export class ProjectAutomation {
  constructor(
    readonly store: ProjectAutomationStore,
    readonly work: ManagerWorkStore,
    readonly knowledge: ProjectKnowledge,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  createPlaybook(
    scope: AutomationScope,
    actor: string,
    input: { client_request_id: string; title: string; definition: PlaybookDefinition }
  ) {
    validatePlaybookDefinition(input.definition);
    return this.store.transaction(() => {
      const record = this.store.create<Playbook>(
        scope,
        "playbook",
        input.client_request_id,
        automationHash(input),
        { title: input.title, published_version: 1, archived: false }
      );
      this.store.create<Published>(
        scope,
        "playbook_version",
        record.id + "_1",
        automationHash({ definition: input.definition, actor }),
        {
          playbook_id: record.id,
          number: 1,
          definition: input.definition,
          checksum: automationHash(input.definition),
          changelog: "Initial version",
          actor_id: actor
        }
      );
      return record;
    });
  }
  publish(
    scope: AutomationScope,
    actor: string,
    id: string,
    input: {
      expected_version: number;
      title: string;
      definition: PlaybookDefinition;
      changelog: string;
    }
  ) {
    validatePlaybookDefinition(input.definition);
    return this.store.transaction(() => {
      const current = this.store.get<Playbook>(scope, "playbook", id) ?? missing();
      if (current.body.archived) conflict("PLAYBOOK_ARCHIVED");
      const number = current.body.published_version + 1;
      const next = this.store.update(scope, "playbook", id, input.expected_version, {
        ...current.body,
        title: input.title,
        published_version: number
      });
      this.store.create<Published>(
        scope,
        "playbook_version",
        id + "_" + number,
        automationHash(input),
        {
          playbook_id: id,
          number,
          definition: input.definition,
          checksum: automationHash(input.definition),
          changelog: input.changelog,
          actor_id: actor
        }
      );
      return next;
    });
  }
  archivePlaybook(scope: AutomationScope, id: string, expected: number, archived: boolean) {
    const current = this.store.get<Playbook>(scope, "playbook", id) ?? missing();
    return this.store.update(scope, "playbook", id, expected, { ...current.body, archived });
  }
  version(scope: AutomationScope, id: string, number: number): AutomationRecord<Published> {
    const result =
      this.store.byKey<Published>(scope, "playbook_version", id + "_" + number) ?? missing();
    if (result.body.checksum !== automationHash(result.body.definition))
      conflict("PLAYBOOK_CORRUPT");
    return result;
  }
  preview(scope: AutomationScope, id: string, input: PlaybookInstantiate) {
    const current = this.store.get<Playbook>(scope, "playbook", id) ?? missing();
    if (current.body.archived) conflict("PLAYBOOK_ARCHIVED");
    return renderPlaybook(
      this.version(scope, id, input.playbook_version).body.definition,
      input.variables
    );
  }
  instantiate(scope: AutomationScope, actor: string, id: string, input: PlaybookInstantiate) {
    return this.store.transaction(() => {
      this.store.assertWritable(scope);
      const fingerprint = automationHash({ id, input });
      const prior = this.store.byKey<Instantiation>(
        scope,
        "instantiation",
        input.client_request_id
      );
      if (prior) {
        // The store verifies the original request fingerprint without changing any data.
        this.store.create(scope, "instantiation", input.client_request_id, fingerprint, prior.body);
        const graph = this.work.dag.get(prior.body.dag_id, scope.owner) ?? missing();
        if (graph.project_id !== scope.project) missing();
        return { receipt: prior, mission: graph, model_dispatched: false };
      }
      const rendered = this.preview(scope, id, input);
      const published = this.version(scope, id, input.playbook_version);
      const graph = this.work.dag.create(scope.project, scope.owner, actor, {
        client_request_id: "pb_" + sha(input.client_request_id),
        ...rendered
      });
      const receipt = this.store.create<Instantiation>(
        scope,
        "instantiation",
        input.client_request_id,
        fingerprint,
        {
          playbook_id: id,
          playbook_version: input.playbook_version,
          dag_id: graph.id,
          actor_id: actor,
          definition_sha256: published.body.checksum,
          variables_sha256: automationHash(input.variables)
        }
      );
      return { receipt, mission: graph, model_dispatched: false };
    });
  }
  createSchedule(scope: AutomationScope, actor: string, input: AutomationScheduleInput) {
    if (!isWorkDeadline(input.due_at) || input.due_at !== new Date(input.due_at).toISOString())
      conflict("INVALID_SCHEDULE_DATE");
    this.preview(scope, input.playbook_id, {
      ...input,
      client_request_id: input.client_request_id
    });
    return this.store.create<Schedule>(
      scope,
      "schedule",
      input.client_request_id,
      automationHash(input),
      {
        playbook_id: input.playbook_id,
        playbook_version: input.playbook_version,
        variables: input.variables,
        next_due_at: input.due_at,
        interval_seconds: input.interval_seconds,
        paused: false,
        created_by: actor
      }
    );
  }
  pauseSchedule(scope: AutomationScope, id: string, expected: number, paused: boolean) {
    const schedule = this.store.get<Schedule>(scope, "schedule", id) ?? missing();
    return this.store.update(scope, "schedule", id, expected, { ...schedule.body, paused });
  }
  /** Bounded explicit tick creates approval candidates only. Downtime coalesces; never invokes a model. */
  collectDue(scope: AutomationScope) {
    return this.store.transaction(() => {
      this.store.assertWritable(scope);
      const now = Date.parse(this.now());
      const items: AutomationRecord<Occurrence>[] = [];
      for (const schedule of this.store.list<Schedule>(scope, "schedule")) {
        const s = schedule.body;
        if (s.paused || !s.next_due_at || Date.parse(s.next_due_at) > now) continue;
        const playbook = this.store.get<Playbook>(scope, "playbook", s.playbook_id);
        if (!playbook || playbook.body.archived) continue;
        const elapsed =
          s.interval_seconds === null
            ? 0
            : Math.floor((now - Date.parse(s.next_due_at)) / (s.interval_seconds * 1000));
        const body: Occurrence = {
          schedule_id: schedule.id,
          due_at: s.next_due_at,
          coalesced_intervals: elapsed,
          playbook_id: s.playbook_id,
          playbook_version: s.playbook_version,
          variables: s.variables,
          requires_owner_start: true
        };
        items.push(
          this.store.create(
            scope,
            "occurrence",
            schedule.id + "_" + sha(s.next_due_at).slice(0, 24),
            automationHash(body),
            body
          )
        );
        const next =
          s.interval_seconds === null
            ? null
            : new Date(
                Date.parse(s.next_due_at) + (elapsed + 1) * s.interval_seconds * 1000
              ).toISOString();
        this.store.update(scope, "schedule", schedule.id, schedule.version, {
          ...s,
          next_due_at: next
        });
      }
      return { items, model_dispatched: false, requires_owner_start: true };
    });
  }
  acceptOccurrence(scope: AutomationScope, actor: string, id: string) {
    const occurrence = this.store.get<Occurrence>(scope, "occurrence", id) ?? missing();
    return this.instantiate(scope, actor, occurrence.body.playbook_id, {
      client_request_id: "occ_" + id,
      playbook_version: occurrence.body.playbook_version,
      variables: occurrence.body.variables
    });
  }
  createSuite(scope: AutomationScope, input: EvaluationSuiteInput) {
    validateEvaluationRules(input.rules);
    return this.store.create(scope, "suite", input.client_request_id, automationHash(input), {
      title: input.title,
      rules: input.rules
    });
  }
  evaluate(scope: AutomationScope, suiteId: string, workId: string, key: string) {
    const suite =
      this.store.get<Omit<EvaluationSuiteInput, "client_request_id">>(scope, "suite", suiteId) ??
      missing();
    const work = this.work.get(workId, scope.owner) ?? missing();
    if (work.project_id !== scope.project) missing();
    if (work.status !== "completed") conflict("WORK_NOT_COMPLETED");
    const artifacts = this.work.runtime.artifacts(scope.project, scope.owner, workId);
    if (artifacts.length >= 100) conflict("EVALUATION_ARTIFACT_LIMIT");
    const files = artifacts
      .filter((f) => f.published)
      .map((metadata) => {
        const file = this.work.runtime.artifact(scope.project, scope.owner, metadata.id);
        if (!file || sha(file.content) !== metadata.sha256) conflict("ARTIFACT_CORRUPT");
        return {
          id: metadata.id,
          name: metadata.name,
          content: file!.content,
          sha256: metadata.sha256,
          version: metadata.version
        };
      });
    const result = evaluateSavedFiles(suite.body.rules, files);
    return this.store.create(scope, "evaluation", key, automationHash({ suiteId, workId }), {
      suite_id: suiteId,
      suite_sha256: automationHash(suite.body),
      work_id: workId,
      work_version: work.version,
      artifacts: files.map((f) => ({
        id: f.id,
        name: f.name,
        sha256: f.sha256,
        version: f.version
      })),
      ...result
    });
  }
  createCollection(scope: AutomationScope, input: KnowledgeCollectionInput) {
    // Re-read every selected revision and exact excerpt before accepting references.
    const context = this.knowledge.context(scope.project, scope.owner, input.references);
    return this.store.create(scope, "collection", input.client_request_id, automationHash(input), {
      title: input.title,
      references: input.references,
      accepted_context_sha256: context.attachment_sha256,
      evidence_is_untrusted: true
    });
  }
  collectionContext(scope: AutomationScope, id: string) {
    const collection =
      this.store.get<Omit<KnowledgeCollectionInput, "client_request_id">>(
        scope,
        "collection",
        id
      ) ?? missing();
    // A deleted/changed source fails; references do not become permanent read capabilities.
    return this.knowledge.context(scope.project, scope.owner, collection.body.references);
  }
}
