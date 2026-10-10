import {
  deduplicateCandidates,
  RESEARCH_LIMITS,
  researchPassages,
  type ResearchRun,
  type ResearchStatus,
  type ResearchSource
} from "@cosmora/core";
import type { WebSearch } from "../web-search.js";
import { ResearchNetworkError, ResearchPageReader } from "./page-reader.js";
import type { ResearchStore } from "./research-store.js";
import type { ResearchSynthesis } from "./research-synthesis.js";
import { randomUUID } from "node:crypto";

export interface ResearchStopGate {
  getProcessStop(): unknown;
  getProjectStop(projectId: string, ownerId: string): unknown;
}

export class ResearchCoordinator {
  private readonly active = new Map<string, AbortController>();
  private readonly tasks = new Set<Promise<void>>();
  constructor(
    private readonly store: ResearchStore,
    private readonly search: Pick<WebSearch, "search" | "configured">,
    private readonly reader = new ResearchPageReader(),
    private readonly stopGate?: ResearchStopGate,
    private readonly clock: () => number = Date.now,
    private readonly policyAllows: (run: ResearchRun) => boolean = () => false,
    private readonly synthesis?: ResearchSynthesis
  ) {}
  private allowed(run: ResearchRun): boolean {
    return (
      this.policyAllows(run) &&
      !this.stopGate?.getProcessStop() &&
      !this.stopGate?.getProjectStop(run.project_id, run.owner_id)
    );
  }
  launch(run: ResearchRun): boolean {
    if (
      (!this.search.configured && !run.sources.length) ||
      this.store.isFenced(run.owner_id) ||
      this.active.has(run.id) ||
      this.active.size >= 2 ||
      !this.allowed(run)
    )
      return false;
    if (
      run.attempts >= RESEARCH_LIMITS.maxAttempts ||
      !["queued", "paused"].includes(run.status) ||
      ["dispatching", "uncertain"].includes(run.model?.phase ?? "pending")
    )
      return false;
    const controller = new AbortController();
    this.active.set(run.id, controller);
    const task = this.work(run.id, run.owner_id, controller.signal)
      .catch(() => {
        this.store.update(
          run.id,
          run.owner_id,
          ["queued", "searching", "reading", "synthesizing"],
          (state) => {
            state.status = "failed";
            state.error_code = "RESEARCH_UNAVAILABLE";
            state.stage = "Исследование не завершено";
          }
        );
      })
      .finally(() => {
        if (this.active.get(run.id) === controller) this.active.delete(run.id);
        this.tasks.delete(task);
      });
    this.tasks.add(task);
    return true;
  }
  pause(id: string, ownerId: string): ResearchRun | null {
    const run = this.store.update(
      id,
      ownerId,
      ["queued", "searching", "reading", "synthesizing"],
      (state) => {
        if (state.status === "synthesizing" && state.model?.phase === "dispatching") {
          state.model.phase = "uncertain";
          state.model.usage_state = "uncertain";
        }
        state.status = "paused";
        state.stage = "Приостановлено владельцем";
      }
    );
    if (run) this.active.get(id)?.abort();
    return run;
  }
  cancel(id: string, ownerId: string): ResearchRun | null {
    const run = this.store.update(
      id,
      ownerId,
      ["queued", "paused", "searching", "reading", "synthesizing"],
      (state) => {
        if (state.status === "synthesizing" && state.model?.phase === "dispatching") {
          state.model.phase = "uncertain";
          state.model.usage_state = "uncertain";
        }
        state.status = "cancelled";
        state.stage = "Отменено владельцем";
      }
    );
    if (run) this.active.get(id)?.abort();
    return run;
  }
  /** Durable owner fence. No late worker may recreate data or write after delete. */
  async quiesce(ownerId: string): Promise<void> {
    for (const run of this.store.list(ownerId)) {
      this.pause(run.id, ownerId);
    }
    this.store.fence(ownerId);
    for (const run of this.store.list(ownerId)) this.active.get(run.id)?.abort();
    await Promise.allSettled([...this.tasks]);
  }
  async stop(): Promise<void> {
    for (const controller of this.active.values()) controller.abort();
    await Promise.allSettled([...this.tasks]);
  }
  private activeUpdate(
    id: string,
    owner: string,
    statuses: ResearchStatus[],
    cb: (run: ResearchRun) => void
  ): ResearchRun | null {
    return this.store.update(id, owner, statuses, (run) => {
      if (!this.allowed(run)) {
        run.status = "paused";
        run.stage = "Приостановлено системой безопасности";
      } else cb(run);
    });
  }
  private async work(id: string, owner: string, outer: AbortSignal): Promise<void> {
    const deadline = this.clock() + RESEARCH_LIMITS.maxRunMilliseconds;
    const timed = AbortSignal.any([outer, AbortSignal.timeout(RESEARCH_LIMITS.maxRunMilliseconds)]);
    let run = this.activeUpdate(id, owner, ["queued", "paused"], (state) => {
      state.attempts++;
      state.status = state.candidates.length || state.sources.length ? "reading" : "searching";
      state.stage =
        state.status === "reading" ? "Продолжаем проверку источников" : "Поиск через SearxNG";
    });
    if (!run || run.status === "paused") return;
    if (!run.candidates.length) {
      try {
        const result = await this.search.search(run.question);
        if (timed.aborted || this.clock() >= deadline) throw new Error("TIME_BUDGET");
        run = this.activeUpdate(id, owner, ["searching"], (state) => {
          state.candidates = deduplicateCandidates(result.items);
          state.status = "reading";
          state.stage = `Найдено ${state.candidates.length} адресов`;
        });
      } catch {
        if (!outer.aborted)
          this.activeUpdate(id, owner, ["searching"], (state) => {
            state.status = "paused";
            state.error_code = "SEARCH_UNAVAILABLE";
            state.stage = "Поиск не выполнен. Можно повторить";
          });
        return;
      }
    }
    if (!run || run.status !== "reading") return;
    while (
      run.next_index < run.candidates.length &&
      run.sources.filter((s) => s.status === "read").length < RESEARCH_LIMITS.maxSources
    ) {
      if (timed.aborted || this.clock() >= deadline) {
        this.activeUpdate(id, owner, ["reading"], (state) => {
          state.status = "paused";
          state.stage = "Лимит времени. Можно продолжить";
        });
        return;
      }
      if (!this.allowed(run)) {
        this.pause(id, owner);
        return;
      }
      const candidate = run.candidates[run.next_index]!;
      const started = this.activeUpdate(id, owner, ["reading"], (state) => {
        state.stage = `Чтение ${state.next_index + 1} из ${state.candidates.length}`;
      });
      if (!started || started.status !== "reading") return;
      let status: ResearchSource["status"] = "unavailable";
      let passages: string[] = [];
      try {
        const text = await this.reader.read(candidate.url, timed);
        if (timed.aborted) throw new Error("ABORTED");
        passages = researchPassages(text, run.question);
        status = passages.length ? "read" : "unavailable";
      } catch (error) {
        if (timed.aborted) {
          if (!outer.aborted)
            this.activeUpdate(id, owner, ["reading"], (state) => {
              state.status = "paused";
              state.stage = "Лимит времени. Можно продолжить";
            });
          return;
        }
        if (error instanceof ResearchNetworkError) {
          status =
            error.code === "ROBOTS_DENIED"
              ? "robots_denied"
              : error.code === "NETWORK_DENIED"
                ? "network_denied"
                : "unavailable";
        }
      }
      run = this.activeUpdate(id, owner, ["reading"], (state) => {
        state.sources.push({
          ...candidate,
          status,
          passages,
          checked_at: new Date().toISOString()
        });
        state.next_index++;
      });
      if (!run || run.status !== "reading") return;
    }
    run = this.activeUpdate(id, owner, ["reading"], (state) => {
      if (!state.sources.some((source) => source.status === "read")) {
        state.status = "failed";
        state.error_code = "NO_READABLE_SOURCES";
        state.stage = "Доступных страниц с подходящими фрагментами не найдено";
      } else if (!state.model_requested) {
        state.status = "completed";
        state.stage = "Выдержки готовы. Для модельного ответа запустите синтез";
      } else {
        state.status = "synthesizing";
        state.stage = "Подготовка модельного синтеза";
      }
    });
    if (!run || run.status !== "synthesizing" || outer.aborted) return;
    if (!this.synthesis) {
      this.activeUpdate(id, owner, ["synthesizing"], (state) => {
        state.status = "paused";
        state.error_code = "MODEL_UNAVAILABLE";
        state.stage = "Модель или общий учёт расходов не подключены. Вызова не было";
      });
      return;
    }
    const modelRunId = randomUUID();
    run = this.activeUpdate(id, owner, ["synthesizing"], (state) => {
      state.model = {
        phase: "dispatching",
        run_id: modelRunId,
        usage_state: "none",
        error_code: null,
        revision: (state.model?.revision ?? 0) + 1
      };
      state.stage = "Проверка маршрута и резерва расхода";
    });
    if (!run || run.status !== "synthesizing" || outer.aborted) return;
    try {
      const result = await this.synthesis.run(run, modelRunId, timed, (stage, usage) => {
        const state = this.activeUpdate(id, owner, ["synthesizing"], (value) => {
          value.stage = stage;
          if (value.model) value.model.usage_state = usage;
        });
        if (!state || state.status !== "synthesizing") this.active.get(id)?.abort();
      });
      if (timed.aborted) return;
      this.activeUpdate(id, owner, ["synthesizing"], (state) => {
        if (state.model?.run_id !== modelRunId) return;
        state.answer = result.answer;
        state.status = "completed";
        state.stage =
          result.usage === "uncertain"
            ? "Ответ сохранён; расход удерживается до сверки"
            : "Отчёт готов: цитаты сверены с источниками";
        state.error_code = null;
        state.model.phase = result.usage === "uncertain" ? "uncertain" : "settled";
        state.model.usage_state = result.usage;
      });
    } catch (error) {
      this.activeUpdate(id, owner, ["synthesizing"], (state) => {
        state.status = "failed";
        const code =
          error instanceof Error &&
          /^(SYNTHESIS_|NO_READABLE_|OWNER_BUDGET_|PROJECT_|RESEARCH_)/.test(error.message)
            ? error.message
            : "MODEL_UNAVAILABLE";
        state.error_code = code;
        state.stage = `Модельный ответ не сохранён (${code}). Источники доступны`;
        if (state.model) {
          state.model.phase =
            state.model.usage_state === "reserved" || state.model.usage_state === "uncertain"
              ? "uncertain"
              : "failed";
          state.model.error_code = code;
          if (state.model.phase === "uncertain") state.model.usage_state = "uncertain";
        }
      });
    }
  }
}
