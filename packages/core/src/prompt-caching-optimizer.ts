import { createHash } from "node:crypto";
import { estimateTextBpeTokens } from "./bpe-context-estimator-and-audit.ts";

export const ANTHROPIC_CACHE_BLOCK_TOKENS = 1024;
export const MAX_CACHE_CHECKPOINTS = 4;

export interface PromptBlockInput {
  id: string;
  role: "system" | "tools" | "pinned_memory" | "project_context" | "conversation_history" | "active_turn";
  content: string;
  isImmutablePrefix: boolean;
}

export interface OptimizedPromptBlock {
  id: string;
  role: PromptBlockInput["role"];
  content: string;
  tokenCount: number;
  cumulativeTokens: number;
  hasCacheCheckpoint: boolean;
  checkpointIndex?: number;
  prefixHash: string;
}

export interface PromptCachingOptimizationReport {
  totalTokens: number;
  immutablePrefixTokens: number;
  dynamicTailTokens: number;
  assignedCheckpoints: number;
  estimatedCacheHitRate: number;
  estimatedInputCostSavingsPercent: number;
  blocks: OptimizedPromptBlock[];
}

/**
 * Arranges prompt blocks in strict stability order:
 * System instructions -> Tool schemas -> Pinned memory -> Project context -> History -> Active turn.
 */
const ROLE_STABILITY_PRIORITY: Record<PromptBlockInput["role"], number> = {
  system: 1,
  tools: 2,
  pinned_memory: 3,
  project_context: 4,
  conversation_history: 5,
  active_turn: 6
};

/**
 * Model-Aware Prompt Caching Optimizer (for Claude Fable 5 & CheapVibeCode Sol).
 *
 * Optimizes prompts to maximize prompt cache hits (>90%) across consecutive turns:
 * 1. Orders context blocks from most static to least static to guarantee stable prefix prefixes.
 * 2. Identifies Anthropic 1024-token caching boundaries and assigns up to 4 `cache_control: { type: "ephemeral" }`
 *    checkpoints at the most stable immutable block transitions.
 * 3. Computes cumulative SHA-256 prefix hashes so cache hits can be verified deterministically offline.
 */
export function optimizePromptCachingLayout(
  blocks: PromptBlockInput[],
  options?: {
    cacheBlockSize?: number;
    maxCheckpoints?: number;
  }
): PromptCachingOptimizationReport {
  const cacheBlockSize = options?.cacheBlockSize ?? ANTHROPIC_CACHE_BLOCK_TOKENS;
  const maxCheckpoints = Math.min(options?.maxCheckpoints ?? MAX_CACHE_CHECKPOINTS, MAX_CACHE_CHECKPOINTS);

  // 1. Sort by stability priority, then preserve stable order within identical roles
  const sorted = [...blocks].sort(
    (a, b) => ROLE_STABILITY_PRIORITY[a.role] - ROLE_STABILITY_PRIORITY[b.role]
  );

  let cumulativeTokens = 0;
  let immutableTokens = 0;
  let dynamicTokens = 0;
  let hashAccumulator = "";

  const analyzedBlocks: Array<{
    input: PromptBlockInput;
    tokens: number;
    cumTokens: number;
    prefixHash: string;
  }> = [];

  for (const b of sorted) {
    const tokens = estimateTextBpeTokens(b.content);
    cumulativeTokens += tokens;
    if (b.isImmutablePrefix) {
      immutableTokens += tokens;
    } else {
      dynamicTokens += tokens;
    }

    hashAccumulator = createHash("sha256")
      .update(`${hashAccumulator}:${b.id}:${b.content}`, "utf8")
      .digest("hex");

    analyzedBlocks.push({
      input: b,
      tokens,
      cumTokens: cumulativeTokens,
      prefixHash: hashAccumulator
    });
  }

  // 2. Identify optimal cache checkpoints:
  // We want checkpoints placed on immutable blocks that cross or come closest to 1024-token boundaries,
  // with at least cacheBlockSize tokens between consecutive checkpoints.
  const checkpointBlockIndices = new Set<number>();
  let lastCheckpointToken = 0;
  let checkpointCounter = 0;

  for (let i = 0; i < analyzedBlocks.length; i++) {
    if (checkpointCounter >= maxCheckpoints) break;
    const b = analyzedBlocks[i];

    // Checkpoint should only be placed on immutable prefix blocks or stable history, not on the active turn
    if (b.input.role === "active_turn") continue;

    const tokensSinceLast = b.cumTokens - lastCheckpointToken;
    const isLastImmutable =
      b.input.isImmutablePrefix &&
      (i === analyzedBlocks.length - 1 || !analyzedBlocks[i + 1].input.isImmutablePrefix);

    if (tokensSinceLast >= cacheBlockSize || isLastImmutable) {
      checkpointBlockIndices.add(i);
      lastCheckpointToken = b.cumTokens;
      checkpointCounter++;
    }
  }

  let assignedCheckpointIdx = 0;
  const finalBlocks: OptimizedPromptBlock[] = analyzedBlocks.map((b, idx) => {
    const isCp = checkpointBlockIndices.has(idx);
    const cpNum = isCp ? ++assignedCheckpointIdx : undefined;
    return {
      id: b.input.id,
      role: b.input.role,
      content: b.input.content,
      tokenCount: b.tokens,
      cumulativeTokens: b.cumTokens,
      hasCacheCheckpoint: isCp,
      checkpointIndex: cpNum,
      prefixHash: b.prefixHash
    };
  });

  // Calculate estimated cache hit rate and projected cost savings
  const cachedTokens = finalBlocks
    .filter((b) => b.hasCacheCheckpoint)
    .reduce((max, b) => Math.max(max, b.cumulativeTokens), 0);

  const estimatedCacheHitRate =
    cumulativeTokens > 0 ? Number((cachedTokens / cumulativeTokens).toFixed(4)) : 0;

  // Cached prompt tokens typically cost 90% less on Claude Fable / OpenAI
  const estimatedInputCostSavingsPercent = Number(
    (estimatedCacheHitRate * 90.0).toFixed(2)
  );

  return {
    totalTokens: cumulativeTokens,
    immutablePrefixTokens: immutableTokens,
    dynamicTailTokens: dynamicTokens,
    assignedCheckpoints: assignedCheckpointIdx,
    estimatedCacheHitRate,
    estimatedInputCostSavingsPercent,
    blocks: finalBlocks
  };
}
