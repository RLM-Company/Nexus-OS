import { createHash } from "node:crypto";

export interface ImageAttachmentEstimateInput {
  width: number;
  height: number;
  detail?: "low" | "high" | "auto";
}

export interface CalibratedMessageInput {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  images?: ImageAttachmentEstimateInput[];
}

export interface CalibratedTokenEstimate {
  textTokens: number;
  imageTokens: number;
  messageOverheadTokens: number;
  safetyMarginTokens: number;
  totalEstimatedTokens: number;
  fitsContextWindow: boolean;
  availableOutputTokens: number;
  contextWindowTokens: number;
  maxOutputTokens: number;
}

/**
 * Calibrated BPE token estimator for multilingual (Cyrillic + Latin + Code/JSON) messages
 * and vision image tiles (`o200k_base` / `cl100k_base` / `CheapVibeCode Sol 1,050,000` profile from PR #422).
 *
 * Replaces the coarse byte upper bound noted in `KOSMORA_MODEL_CONTEXT_2026-10-31_RU.md`
 * with script-aware subword estimation while maintaining a deterministic 3% safety cushion.
 */
export function estimateTextBpeTokens(text: string): number {
  if (!text) return 0;
  const norm = text.normalize("NFKC");

  let asciiAlnum = 0;
  let cyrillic = 0;
  let cjkOrOther = 0;
  let punctuationAndCode = 0;
  let whitespaceRuns = 0;

  for (let i = 0; i < norm.length; i++) {
    const code = norm.charCodeAt(i);
    if (
      (code >= 0x30 && code <= 0x39) ||
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x61 && code <= 0x7a)
    ) {
      asciiAlnum++;
    } else if (code >= 0x0400 && code <= 0x04ff) {
      cyrillic++;
    } else if (code <= 0x20) {
      if (i === 0 || norm.charCodeAt(i - 1) > 0x20) {
        whitespaceRuns++;
      }
    } else if (code < 0x7f) {
      punctuationAndCode++;
    } else {
      cjkOrOther++;
    }
  }

  // Empirical o200k_base / cl100k_base subword densities:
  // - ASCII letters/digits: ~1 token per 4.0 chars
  // - Cyrillic letters: ~1 token per 2.2 chars in modern BPE
  // - Code/JSON punctuation: ~1 token per 1.6 symbols
  // - CJK/other Unicode: ~1.1 tokens per char
  const rawEstimate =
    asciiAlnum / 4.0 +
    cyrillic / 2.2 +
    punctuationAndCode / 1.6 +
    cjkOrOther * 1.1 +
    whitespaceRuns * 0.15;

  return Math.max(1, Math.ceil(rawEstimate));
}

export function estimateImageTileTokens(img: ImageAttachmentEstimateInput): number {
  const width = Math.max(1, Math.floor(img.width || 512));
  const height = Math.max(1, Math.floor(img.height || 512));
  if (img.detail === "low") {
    return 85;
  }

  // Standard high-res vision tiling: scale within 2048x2048, shortest side to 768, then 512x512 tiles
  let scaledW = width;
  let scaledH = height;
  if (scaledW > 2048 || scaledH > 2048) {
    const ratio = 2048 / Math.max(scaledW, scaledH);
    scaledW = Math.floor(scaledW * ratio);
    scaledH = Math.floor(scaledH * ratio);
  }
  const shortest = Math.min(scaledW, scaledH);
  if (shortest > 768) {
    const ratio = 768 / shortest;
    scaledW = Math.floor(scaledW * ratio);
    scaledH = Math.floor(scaledH * ratio);
  }

  const tilesX = Math.max(1, Math.ceil(scaledW / 512));
  const tilesY = Math.max(1, Math.ceil(scaledH / 512));
  return 85 + 170 * (tilesX * tilesY);
}

export function estimateConversationWindowUsage(options: {
  messages: CalibratedMessageInput[];
  contextWindowTokens?: number;
  maxOutputTokens?: number;
  reservedOutputTokens?: number;
}): CalibratedTokenEstimate {
  const contextWindowTokens = options.contextWindowTokens ?? 1_050_000; // CheapVibeCode Sol default in PR #422
  const maxOutputTokens = options.maxOutputTokens ?? 128_000;
  const reservedOutput = Math.min(options.reservedOutputTokens ?? 4096, maxOutputTokens);

  let textTokens = 0;
  let imageTokens = 0;
  let messageOverheadTokens = 3; // reply priming

  for (const m of options.messages) {
    messageOverheadTokens += 4; // per-message role/framing overhead
    textTokens += estimateTextBpeTokens(m.content);
    if (Array.isArray(m.images)) {
      for (const img of m.images) {
        imageTokens += estimateImageTileTokens(img);
      }
    }
  }

  const subtotal = textTokens + imageTokens + messageOverheadTokens;
  const safetyMarginTokens = Math.ceil(subtotal * 0.03);
  const totalEstimatedTokens = subtotal + safetyMarginTokens;
  const availableForOutput = contextWindowTokens - totalEstimatedTokens;
  const fitsContextWindow = availableForOutput >= reservedOutput;

  return {
    textTokens,
    imageTokens,
    messageOverheadTokens,
    safetyMarginTokens,
    totalEstimatedTokens,
    fitsContextWindow,
    availableOutputTokens: Math.max(0, Math.min(maxOutputTokens, availableForOutput)),
    contextWindowTokens,
    maxOutputTokens
  };
}

export interface ProviderAttestationRecord {
  runId: string;
  providerId: string;
  modelRequested: string;
  modelResolved: string;
  contextWindowTested: number;
  needleTokenHash: string;
  needleRecoveredVerbatim: boolean;
  latencyMs: number;
  transportErrorCode: string | null;
  requestSha256: string;
  responseSha256: string;
  recordedAt: string;
}

/**
 * Deterministic Provider Authenticity & Large-Context (>32K / 1.05M) Attestation Recorder
 * (addresses the provider authenticity audit note in PR #422 `KOSMORA_MODEL_CONTEXT_2026-10-31_RU.md`).
 */
export class ProviderAuthenticityAuditor {
  private readonly records: ProviderAttestationRecord[] = [];

  recordAttestationProbe(input: {
    runId: string;
    providerId: string;
    modelRequested: string;
    modelResolved: string;
    contextWindowTested: number;
    expectedNeedle: string;
    requestPayload: string;
    responsePayload: string;
    latencyMs: number;
    transportErrorCode?: string | null;
  }): ProviderAttestationRecord {
    const needleTokenHash = createHash("sha256").update(input.expectedNeedle, "utf8").digest("hex");
    const needleRecoveredVerbatim =
      !input.transportErrorCode &&
      input.responsePayload.normalize("NFKC").includes(input.expectedNeedle.normalize("NFKC"));

    const rec: ProviderAttestationRecord = {
      runId: input.runId,
      providerId: input.providerId,
      modelRequested: input.modelRequested,
      modelResolved: input.modelResolved,
      contextWindowTested: input.contextWindowTested,
      needleTokenHash,
      needleRecoveredVerbatim,
      latencyMs: input.latencyMs,
      transportErrorCode: input.transportErrorCode ?? null,
      requestSha256: createHash("sha256").update(input.requestPayload, "utf8").digest("hex"),
      responseSha256: createHash("sha256").update(input.responsePayload, "utf8").digest("hex"),
      recordedAt: new Date().toISOString()
    };

    this.records.push(rec);
    return rec;
  }

  summarizeAudit(): {
    totalRuns: number;
    passedRuns: number;
    transportFailures: number;
    maxVerifiedContextTokens: number;
    passRate: number;
  } {
    let passedRuns = 0;
    let transportFailures = 0;
    let maxVerifiedContextTokens = 0;

    for (const r of this.records) {
      if (r.transportErrorCode) {
        transportFailures++;
      } else if (r.needleRecoveredVerbatim) {
        passedRuns++;
        if (r.contextWindowTested > maxVerifiedContextTokens) {
          maxVerifiedContextTokens = r.contextWindowTested;
        }
      }
    }

    return {
      totalRuns: this.records.length,
      passedRuns,
      transportFailures,
      maxVerifiedContextTokens,
      passRate:
        this.records.length > 0 ? Number((passedRuns / this.records.length).toFixed(4)) : 1
    };
  }
}
