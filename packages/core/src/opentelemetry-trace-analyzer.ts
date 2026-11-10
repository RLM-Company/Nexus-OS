/**
 * Kosmora / Nexus-OS W3C OpenTelemetry Distributed Trace & Critical-Path Waterfall Analyzer (Wave 23)
 *
 * Implements W3C TraceContext (`00-<32-hex-traceId>-<16-hex-spanId>-01`) propagation,
 * hierarchical span trees across Desktop IPC, Fastify API, SQLite, and Model Gateway turns,
 * and automatic Critical Path / Bottleneck identification.
 */

import { randomBytes } from "node:crypto";

export interface OtelSpanRecord {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  serviceName: string;
  startTimeMs: number;
  endTimeMs: number;
  durationMs: number;
  status: "OK" | "ERROR";
  attributes: Record<string, string | number | boolean>;
}

export interface CriticalPathAnalysisReport {
  traceId: string;
  rootSpanId: string;
  totalTraceDurationMs: number;
  spanCount: number;
  errorSpanCount: number;
  criticalPathSpanIds: string[];
  bottleneckSpan: {
    spanId: string;
    name: string;
    selfTimeMs: number;
    percentOfTotalTrace: number;
  };
  serviceBreakdownMs: Record<string, number>;
}

export function formatW3cTraceparent(traceId: string, spanId: string, sampled = true): string {
  const t = traceId.padStart(32, "0").slice(0, 32).toLowerCase();
  const s = spanId.padStart(16, "0").slice(0, 16).toLowerCase();
  const flags = sampled ? "01" : "00";
  return `00-${t}-${s}-${flags}`;
}

export function parseW3cTraceparent(header: string): {
  version: string;
  traceId: string;
  parentSpanId: string;
  sampled: boolean;
} | null {
  const m = String(header ?? "")
    .trim()
    .match(/^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i);
  if (!m) return null;
  if (m[2] === "00000000000000000000000000000000" || m[3] === "0000000000000000") {
    return null;
  }
  return {
    version: m[1].toLowerCase(),
    traceId: m[2].toLowerCase(),
    parentSpanId: m[3].toLowerCase(),
    sampled: (Number.parseInt(m[4], 16) & 1) === 1
  };
}

export class OpenTelemetryTraceAnalyzer {
  private readonly spansByTrace = new Map<string, Map<string, OtelSpanRecord>>();

  public createTraceId(): string {
    return randomBytes(16).toString("hex");
  }

  public createSpanId(): string {
    return randomBytes(8).toString("hex");
  }

  public recordSpan(span: Omit<OtelSpanRecord, "durationMs">): OtelSpanRecord {
    const durationMs = Math.max(0, Number((span.endTimeMs - span.startTimeMs).toFixed(3)));
    const full: OtelSpanRecord = {
      ...span,
      durationMs
    };

    let traceMap = this.spansByTrace.get(span.traceId);
    if (!traceMap) {
      traceMap = new Map<string, OtelSpanRecord>();
      this.spansByTrace.set(span.traceId, traceMap);
    }
    traceMap.set(span.spanId, full);
    return full;
  }

  /**
   * Analyzes a completed trace to compute self-times, critical path, and the top latency bottleneck.
   */
  public analyzeTraceWaterfall(traceId: string): CriticalPathAnalysisReport {
    const traceMap = this.spansByTrace.get(traceId);
    if (!traceMap || traceMap.size === 0) {
      throw new Error(`OTEL_TRACE_NOT_FOUND: No spans recorded for traceId '${traceId}'`);
    }

    const spans = Array.from(traceMap.values());
    const childrenMap = new Map<string, OtelSpanRecord[]>();
    let rootSpan = spans[0];

    for (const sp of spans) {
      if (!sp.parentSpanId || !traceMap.has(sp.parentSpanId)) {
        if (sp.startTimeMs <= rootSpan.startTimeMs) {
          rootSpan = sp;
        }
      } else {
        const list = childrenMap.get(sp.parentSpanId) ?? [];
        list.push(sp);
        childrenMap.set(sp.parentSpanId, list);
      }
    }

    const minStart = Math.min(...spans.map((s) => s.startTimeMs));
    const maxEnd = Math.max(...spans.map((s) => s.endTimeMs));
    const totalTraceDurationMs = Math.max(0.001, Number((maxEnd - minStart).toFixed(3)));

    // Compute self-time for each span (duration minus sum of non-overlapping child durations)
    let bottleneckSpan = {
      spanId: rootSpan.spanId,
      name: rootSpan.name,
      selfTimeMs: 0,
      percentOfTotalTrace: 0
    };

    const serviceBreakdownMs: Record<string, number> = {};
    let errorSpanCount = 0;

    for (const sp of spans) {
      if (sp.status === "ERROR") errorSpanCount += 1;
      const children = childrenMap.get(sp.spanId) ?? [];
      const childTotal = children.reduce((acc, c) => acc + c.durationMs, 0);
      const selfTime = Math.max(0, Number((sp.durationMs - childTotal).toFixed(3)));

      serviceBreakdownMs[sp.serviceName] = Number(
        ((serviceBreakdownMs[sp.serviceName] ?? 0) + selfTime).toFixed(3)
      );

      if (selfTime >= bottleneckSpan.selfTimeMs) {
        bottleneckSpan = {
          spanId: sp.spanId,
          name: sp.name,
          selfTimeMs: selfTime,
          percentOfTotalTrace: Number(((selfTime / totalTraceDurationMs) * 100).toFixed(2))
        };
      }
    }

    // Reconstruct critical path from root down the longest-duration child chain
    const criticalPathSpanIds: string[] = [];
    let cursor: OtelSpanRecord | undefined = rootSpan;
    while (cursor) {
      criticalPathSpanIds.push(cursor.spanId);
      const kids = childrenMap.get(cursor.spanId) ?? [];
      if (kids.length === 0) break;
      kids.sort((a, b) => b.durationMs - a.durationMs);
      cursor = kids[0];
    }

    return {
      traceId,
      rootSpanId: rootSpan.spanId,
      totalTraceDurationMs,
      spanCount: spans.length,
      errorSpanCount,
      criticalPathSpanIds,
      bottleneckSpan,
      serviceBreakdownMs
    };
  }
}
