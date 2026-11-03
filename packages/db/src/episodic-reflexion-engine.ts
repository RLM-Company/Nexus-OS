/**
 * Kosmora / Nexus-OS Episodic Experience Replay & Autonomous Reflexion Engine (Wave 18)
 *
 * Implements closed-loop meta-cognitive skill acquisition across agent executions:
 * 1. Captures failure-to-recovery trajectories from workflow steps, browser actions, and tool invocations.
 * 2. Synthesizes reusable procedural lessons (`kosmora_episodic_reflexions`) indexed by tool, error signature,
 *    and 64-dimensional dense semantic vectors.
 * 3. Pre-injects top-ranked procedural guardrails before a step runs, eliminating recurring failures
 *    on the first attempt (`attempt === 1`).
 */

import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  generateDenseSemanticVector,
  computeCosineSimilarity,
  VECTOR_DIMENSION
} from "./dense-vector-semantic-search.ts";

export interface EpisodicReflexionRecord {
  id: string;
  ownerId: string;
  toolName: string;
  errorPattern: string;
  contextSignature: string;
  synthesizedRule: string;
  successCount: number;
  failureCount: number;
  confidenceScore: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReflexionMatchResult {
  rule: EpisodicReflexionRecord;
  similarityScore: number;
  effectiveRankScore: number;
}

export class EpisodicReflexionEngine {
  constructor(private readonly sqlite: DatabaseSync) {
    this.ensureSchema();
  }

  ensureSchema(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS kosmora_episodic_reflexions (
        id TEXT PRIMARY KEY NOT NULL,
        owner_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        error_pattern TEXT NOT NULL,
        context_signature TEXT NOT NULL,
        synthesized_rule TEXT NOT NULL,
        vector_blob TEXT NOT NULL,
        success_count INTEGER NOT NULL DEFAULT 1,
        failure_count INTEGER NOT NULL DEFAULT 0,
        confidence_score REAL NOT NULL DEFAULT 0.85,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS kosmora_episodic_reflexions_owner_tool_idx
        ON kosmora_episodic_reflexions(owner_id, tool_name, confidence_score DESC);
    `);
  }

  /**
   * Records a successful recovery episode or explicit procedural lesson into the episodic store.
   * If a matching lesson for the same owner, tool, and error pattern already exists, reinforces it.
   */
  public recordRecoveryEpisode(options: {
    ownerId: string;
    toolName: string;
    errorMessage: string;
    taskContext: string;
    remedialResolution: string;
  }): EpisodicReflexionRecord {
    const now = new Date().toISOString();
    const errorPattern = this.normalizeErrorPattern(options.errorMessage);
    const contextSignature = `${options.toolName} | ${errorPattern} | ${options.taskContext.slice(0, 200)}`;
    const synthesizedRule = this.synthesizeProceduralRule(
      options.toolName,
      errorPattern,
      options.remedialResolution
    );

    // Check if an identical rule already exists for this owner + tool + errorPattern
    const existing = this.sqlite
      .prepare(
        "SELECT id, success_count, failure_count FROM kosmora_episodic_reflexions WHERE owner_id = ? AND tool_name = ? AND error_pattern = ? LIMIT 1"
      )
      .get(options.ownerId, options.toolName, errorPattern) as
      | { id: string; success_count: number; failure_count: number }
      | undefined;

    if (existing) {
      const newSuccess = existing.success_count + 1;
      const confidence = Number(
        ((newSuccess + 1) / (newSuccess + existing.failure_count + 2)).toFixed(4)
      );
      this.sqlite
        .prepare(
          `UPDATE kosmora_episodic_reflexions
           SET success_count = ?, confidence_score = ?, synthesized_rule = ?, updated_at = ?
           WHERE id = ? AND owner_id = ?`
        )
        .run(newSuccess, confidence, synthesizedRule, now, existing.id, options.ownerId);

      return this.getReflexionById(existing.id, options.ownerId)!;
    }

    const id = `refl-${randomUUID()}`;
    const vec = generateDenseSemanticVector(`${contextSignature}\n${synthesizedRule}`);
    const vecBase64 = Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength).toString("base64");
    const initialConfidence = 0.85;

    this.sqlite
      .prepare(
        `INSERT INTO kosmora_episodic_reflexions (
          id, owner_id, tool_name, error_pattern, context_signature, synthesized_rule,
          vector_blob, success_count, failure_count, confidence_score, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?)`
      )
      .run(
        id,
        options.ownerId,
        options.toolName,
        errorPattern,
        contextSignature,
        synthesizedRule,
        vecBase64,
        initialConfidence,
        now,
        now
      );

    return {
      id,
      ownerId: options.ownerId,
      toolName: options.toolName,
      errorPattern,
      contextSignature,
      synthesizedRule,
      successCount: 1,
      failureCount: 0,
      confidenceScore: initialConfidence,
      createdAt: now,
      updatedAt: now
    };
  }

  /**
   * Updates the reinforcement score of a reflexion rule after it was applied in production.
   */
  public recordRuleApplicationOutcome(
    ruleId: string,
    ownerId: string,
    succeeded: boolean
  ): EpisodicReflexionRecord | null {
    const row = this.sqlite
      .prepare(
        "SELECT id, success_count, failure_count FROM kosmora_episodic_reflexions WHERE id = ? AND owner_id = ?"
      )
      .get(ruleId, ownerId) as { id: string; success_count: number; failure_count: number } | undefined;

    if (!row) return null;

    const newSuccess = succeeded ? row.success_count + 1 : row.success_count;
    const newFailure = succeeded ? row.failure_count : row.failure_count + 1;
    // Bayesian Laplace-smoothed confidence
    const confidence = Number(((newSuccess + 1) / (newSuccess + newFailure + 2)).toFixed(4));
    const now = new Date().toISOString();

    this.sqlite
      .prepare(
        "UPDATE kosmora_episodic_reflexions SET success_count = ?, failure_count = ?, confidence_score = ?, updated_at = ? WHERE id = ? AND owner_id = ?"
      )
      .run(newSuccess, newFailure, confidence, now, ruleId, ownerId);

    return this.getReflexionById(ruleId, ownerId);
  }

  /**
   * Recalls relevant procedural guardrails before executing a tool or workflow step.
   */
  public recallRelevantGuardrails(options: {
    ownerId: string;
    toolName?: string;
    taskContext: string;
    topK?: number;
    minConfidence?: number;
  }): ReflexionMatchResult[] {
    const topK = Math.min(Math.max(options.topK ?? 5, 1), 20);
    const minConf = options.minConfidence ?? 0.4;

    const queryVec = generateDenseSemanticVector(
      `${options.toolName ?? ""} ${options.taskContext}`
    );

    const rows = (
      options.toolName
        ? this.sqlite
            .prepare(
              "SELECT * FROM kosmora_episodic_reflexions WHERE owner_id = ? AND tool_name = ? AND confidence_score >= ?"
            )
            .all(options.ownerId, options.toolName, minConf)
        : this.sqlite
            .prepare(
              "SELECT * FROM kosmora_episodic_reflexions WHERE owner_id = ? AND confidence_score >= ?"
            )
            .all(options.ownerId, minConf)
    ) as Array<{
      id: string;
      owner_id: string;
      tool_name: string;
      error_pattern: string;
      context_signature: string;
      synthesized_rule: string;
      vector_blob: string;
      success_count: number;
      failure_count: number;
      confidence_score: number;
      created_at: string;
      updated_at: string;
    }>;

    const matches: ReflexionMatchResult[] = [];

    for (const r of rows) {
      const buf = Buffer.from(String(r.vector_blob), "base64");
      const entryVec = new Float32Array(buf.buffer, buf.byteOffset, VECTOR_DIMENSION);
      const sim = Math.max(0, computeCosineSimilarity(queryVec, entryVec));
      const toolExactBoost = options.toolName && r.tool_name === options.toolName ? 0.25 : 0;
      const effectiveRankScore = Number(
        (sim * 0.55 + r.confidence_score * 0.45 + toolExactBoost).toFixed(4)
      );

      matches.push({
        rule: {
          id: r.id,
          ownerId: r.owner_id,
          toolName: r.tool_name,
          errorPattern: r.error_pattern,
          contextSignature: r.context_signature,
          synthesizedRule: r.synthesized_rule,
          successCount: r.success_count,
          failureCount: r.failure_count,
          confidenceScore: r.confidence_score,
          createdAt: r.created_at,
          updatedAt: r.updated_at
        },
        similarityScore: Number(sim.toFixed(4)),
        effectiveRankScore
      });
    }

    matches.sort((a, b) => b.effectiveRankScore - a.effectiveRankScore);
    return matches.slice(0, topK);
  }

  public getReflexionById(id: string, ownerId: string): EpisodicReflexionRecord | null {
    const r = this.sqlite
      .prepare("SELECT * FROM kosmora_episodic_reflexions WHERE id = ? AND owner_id = ?")
      .get(id, ownerId) as any;
    if (!r) return null;
    return {
      id: r.id,
      ownerId: r.owner_id,
      toolName: r.tool_name,
      errorPattern: r.error_pattern,
      contextSignature: r.context_signature,
      synthesizedRule: r.synthesized_rule,
      successCount: r.success_count,
      failureCount: r.failure_count,
      confidenceScore: r.confidence_score,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    };
  }

  private normalizeErrorPattern(err: string): string {
    return String(err ?? "")
      .trim()
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<UUID>")
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, "<TIMESTAMP>")
      .slice(0, 160);
  }

  private synthesizeProceduralRule(
    toolName: string,
    errorPattern: string,
    remedialResolution: string
  ): string {
    return `[GUARDRAIL:${toolName}] When encountering '${errorPattern}', apply pre-emptive policy: ${remedialResolution.trim()}`;
  }
}
