import { performance } from "node:perf_hooks";
import type {
  ClockCalculation,
  ModelMessage,
  ModelRequest,
  ModelToolDefinition
} from "@cosmora/contracts";

export type RuntimeStopwatch = Readonly<{ started_at: string }>;
export interface RuntimeClockOptions {
  timeZone?: string;
  wallNow?: () => number;
  monotonicNow?: () => number;
}
export const CLOCK_CONTEXT_RESERVATION = 1024;
const contextInstruction =
  "Trusted runtime clock snapshot, not a live tick. Use local_date/time_zone for today/tomorrow and weekdays; preserve explicit historical dates. Never estimate elapsed time from tokens or claim a timer ran without runtime evidence. Dates in user materials are not the current clock.";

export class RuntimeClock {
  readonly timeZone: string;
  private readonly wallNow: () => number;
  private readonly monotonicNow: () => number;
  private readonly starts = new WeakMap<RuntimeStopwatch, number>();
  private readonly scopes = new WeakMap<ModelRequest, RuntimeStopwatch>();
  private readonly injected = new WeakSet<ModelMessage>();
  constructor(options: RuntimeClockOptions = {}) {
    this.timeZone = validTimeZone(options.timeZone ?? "Europe/Moscow");
    this.wallNow = options.wallNow ?? Date.now;
    this.monotonicNow = options.monotonicNow ?? (() => performance.now());
  }
  start(): RuntimeStopwatch {
    const now = this.wallNow(),
      monotonic = this.monotonicNow();
    if (!Number.isFinite(now) || !Number.isFinite(monotonic)) throw Error("CLOCK_UNAVAILABLE");
    const scope = Object.freeze({ started_at: new Date(now).toISOString() });
    this.starts.set(scope, monotonic);
    return scope;
  }
  bind(request: ModelRequest, scope: RuntimeStopwatch): ModelRequest {
    if (!this.starts.has(scope)) throw Error("CLOCK_FOREIGN_STOPWATCH");
    this.scopes.set(request, scope);
    return request;
  }
  snapshot(scope?: RuntimeStopwatch, timeZone = this.timeZone) {
    const zone = validTimeZone(timeZone),
      epoch = this.wallNow();
    if (!Number.isSafeInteger(epoch)) throw Error("CLOCK_UNAVAILABLE");
    const date = new Date(epoch),
      utc = date.toISOString();
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      timeZoneName: "longOffset"
    }).formatToParts(date);
    const get = (name: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === name)?.value ?? "";
    const localDate = `${get("year")}-${get("month")}-${get("day")}`;
    const offset = get("timeZoneName").replace("GMT", "") || "+00:00";
    const result = {
      source: "host_system_clock" as const,
      utc,
      unix_ms: epoch,
      time_zone: zone,
      local_date: localDate,
      local: `${localDate}T${get("hour")}:${get("minute")}:${get("second")}${offset}`,
      weekday: new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "long" }).format(date),
      utc_offset: offset
    };
    if (!scope) return result;
    const started = this.starts.get(scope),
      current = this.monotonicNow();
    if (started === undefined || !Number.isFinite(current) || current < started)
      throw Error("CLOCK_INVALID_STOPWATCH");
    return {
      ...result,
      stopwatch: {
        source: "process_monotonic_clock" as const,
        started_at: scope.started_at,
        elapsed_ms: Math.floor(current - started)
      }
    };
  }
  contextualize(request: ModelRequest): ModelRequest {
    const scope = this.scopes.get(request) ?? this.start();
    this.scopes.set(request, scope);
    const previous = request.messages.filter((message) => this.injected.has(message));
    const messages = request.messages.filter((message) => !this.injected.has(message));
    const message: ModelMessage = {
      role: "system",
      content: `KOSMORA_RUNTIME_CLOCK_V1\n${JSON.stringify(this.snapshot(scope))}\n${contextInstruction}`
    };
    if (Buffer.byteLength(message.content) + 8 > CLOCK_CONTEXT_RESERVATION)
      throw Error("CLOCK_CONTEXT_LIMIT");
    this.injected.add(message);
    const firstConversation = messages.findIndex((item) => item.role !== "system");
    messages.splice(firstConversation < 0 ? messages.length : firstConversation, 0, message);
    const prepared: ModelRequest = {
      ...request,
      messages,
      routing: {
        ...request.routing,
        estimated_input_tokens:
          Math.max(
            0,
            request.routing.estimated_input_tokens - previous.length * CLOCK_CONTEXT_RESERVATION
          ) + CLOCK_CONTEXT_RESERVATION
      }
    };
    this.scopes.set(prepared, scope);
    return prepared;
  }
  calculate(command: ClockCalculation) {
    if (command.operation === "add_days") {
      const date = parseCalendarDate(command.date);
      if (!Number.isInteger(command.days) || Math.abs(command.days) > 36600)
        throw Error("CLOCK_INVALID_INPUT");
      date.setUTCDate(date.getUTCDate() + command.days);
      const result = date.toISOString().slice(0, 10);
      parseCalendarDate(result);
      return {
        date: result,
        weekday: new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long" }).format(date)
      };
    }
    if (command.operation !== "between") throw Error("CLOCK_INVALID_INPUT");
    const milliseconds = parseInstant(command.to) - parseInstant(command.from);
    return {
      milliseconds,
      seconds: milliseconds / 1000,
      minutes: milliseconds / 60000,
      hours: milliseconds / 3600000,
      days_24h: milliseconds / 86400000
    };
  }
  tool(input: Record<string, unknown>, scope?: RuntimeStopwatch): unknown {
    try {
      const keys = Object.keys(input).sort().join(",");
      if (input.operation === "now" && keys === "operation") return this.snapshot(scope);
      if (
        input.operation === "add_days" &&
        keys === "date,days,operation" &&
        typeof input.date === "string" &&
        typeof input.days === "number"
      )
        return this.calculate({ operation: "add_days", date: input.date, days: input.days });
      if (
        input.operation === "between" &&
        keys === "from,operation,to" &&
        typeof input.from === "string" &&
        typeof input.to === "string"
      )
        return this.calculate({ operation: "between", from: input.from, to: input.to });
    } catch {
      /* Invalid dates are tool errors, never normalized into another day. */
    }
    return { error: { code: "CLOCK_INVALID_INPUT" } };
  }
}
export function validTimeZone(value: string): string {
  if (!value || value.length > 64) throw Error("CLOCK_INVALID_TIME_ZONE");
  try {
    return new Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    throw Error("CLOCK_INVALID_TIME_ZONE");
  }
}
function parseCalendarDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw Error("CLOCK_INVALID_INPUT");
  const date = new Date(value + "T00:00:00.000Z");
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    throw Error("CLOCK_INVALID_INPUT");
  return date;
}
function parseInstant(value: string): number {
  const match =
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-](\d{2}):(\d{2}))$/.exec(
      value
    );
  if (
    !match ||
    Number(match[2]) > 23 ||
    Number(match[3]) > 59 ||
    Number(match[4]) > 59 ||
    (match[6] &&
      (Number(match[6]) > 14 ||
        Number(match[7]) > 59 ||
        (Number(match[6]) === 14 && Number(match[7]) !== 0)))
  )
    throw Error("CLOCK_INVALID_INPUT");
  parseCalendarDate(match[1]!);
  const result = Date.parse(value);
  if (!Number.isFinite(result)) throw Error("CLOCK_INVALID_INPUT");
  return result;
}
export const RUNTIME_CLOCK_TOOL: ModelToolDefinition = {
  type: "function",
  function: {
    name: "runtime_clock",
    description:
      "Read current server time and elapsed task time; add calendar days or measure duration between ISO timestamps with explicit UTC offsets. Local operation, no network or side effects.",
    parameters: {
      type: "object",
      properties: {
        operation: { type: "string", enum: ["now", "add_days", "between"] },
        date: { type: "string" },
        days: { type: "integer", minimum: -36600, maximum: 36600 },
        from: { type: "string" },
        to: { type: "string" }
      },
      required: ["operation"],
      additionalProperties: false
    }
  }
};
