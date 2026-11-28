/* eslint-disable @typescript-eslint/require-await -- Fixture transports resolve synchronously by design. */
import type { ConnectorTransport } from "./connector-registry.js";

/**
 * Deterministic TEST-CONTOUR adapters for Calendar and Mail. They are not live
 * OAuth/production connectors: no token, endpoint or external account is used.
 * The transports enforce the same lifecycle the real connectors must follow:
 * connect (bindTransport) → capabilities (descriptor) → read → prepare/write →
 * operation journal → disconnect/revoke (revoke()).
 */
type JournalEntry = { operationId: string; actorId: string; kind: string; at: string };
type State = {
  connected: boolean;
  revoked: Set<string>;
  journal: JournalEntry[];
  events: Array<{ id: string; title: string; starts_at: string }>;
  messages: Array<{ id: string; subject: string; body: string }>;
};

export function createFixtureServiceAdapters() {
  const calendar: State = {
    connected: false,
    revoked: new Set(),
    journal: [],
    events: [{ id: "event-1", title: "Проверка", starts_at: "2026-11-28T10:00:00.000Z" }],
    messages: []
  };
  const mail: State = {
    connected: false,
    revoked: new Set(),
    journal: [],
    events: [],
    messages: [{ id: "message-1", subject: "Смета", body: "Итог 19700" }]
  };
  const ensure = (state: State, actorId: string) => {
    if (!state.connected) throw new Error("SERVICE_NOT_CONNECTED");
    if (state.revoked.has(actorId)) throw new Error("SERVICE_ACCESS_REVOKED");
  };
  const record = (state: State, actorId: string, operationId: string, kind: string) => {
    state.journal.push({ operationId, actorId, kind, at: new Date().toISOString() });
  };
  const readTransport = (state: State, kind: string): ConnectorTransport => ({
    async execute(_input, context) {
      ensure(state, context.actorId);
      record(state, context.actorId, context.operationId, kind);
      return state.events.length ? { events: state.events } : { messages: state.messages };
    }
  });
  const prepareTransport = (state: State, kind: string): ConnectorTransport => ({
    async execute(input, context) {
      ensure(state, context.actorId);
      if (!input || typeof input !== "object") throw new Error("INVALID_SERVICE_INPUT");
      record(state, context.actorId, context.operationId, kind);
      // No external side effect: only a bounded, versioned preparation receipt.
      return {
        prepared: true,
        operation_id: context.operationId,
        kind,
        requires_confirmation: true,
        version: 1
      };
    }
  });
  return {
    connect(service: "calendar-fixture" | "mail-fixture") {
      (service === "calendar-fixture" ? calendar : mail).connected = true;
    },
    revoke(service: "calendar-fixture" | "mail-fixture", actorId: string) {
      (service === "calendar-fixture" ? calendar : mail).revoked.add(actorId);
    },
    journal(service: "calendar-fixture" | "mail-fixture") {
      return [...(service === "calendar-fixture" ? calendar : mail).journal];
    },
    transports: {
      "integration.calendar-fixture.read_events": readTransport(calendar, "calendar.read"),
      "integration.calendar-fixture.prepare_change": prepareTransport(calendar, "calendar.prepare"),
      "integration.mail-fixture.read_messages": readTransport(mail, "mail.read"),
      "integration.mail-fixture.prepare_send": prepareTransport(mail, "mail.prepare")
    } satisfies Record<string, ConnectorTransport>
  };
}
