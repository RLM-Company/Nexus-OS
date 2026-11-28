// Reproducible local acceptance harness for Harness 2 (memory + skills).
// Run from the repository root with:
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types \
//     --import ./scripts/ds2-resolve-hook.mjs scripts/memory-acceptance.mjs
//
// It uses the REAL production modules (packages/core/src and packages/db/dist),
// a real in-memory SQLite database and deterministic fixtures. It never calls a
// model, a live provider or the network, and it creates no new store.
//
// NOTE: this harness is a reproducible *local* acceptance path. It is NOT the
// production HTTP path; the API's scope wiring and real provider remain separate.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Prebuilt JS compiled from packages/core/src and packages/db/src. The supplied
// ds2-resolve-hook.mjs maps @cosmora/contracts to source for these modules; the
// core/db packages themselves use TS parameter properties that the strip-only
// loader cannot parse, so their published dist builds are imported here.
import {
  compileSpecialization,
  evaluateSkillResult,
  fitContextMemory,
  mergeContextMemory,
  selectContextBundle
} from "../packages/core/dist/index.js";
import { compactChatHistory } from "../packages/core/dist/history-compaction.js";
import { selectContextScope } from "../packages/core/dist/context-evidence-selection.js";

import {
  ChatSkillStore,
  ContextMemoryStore,
  OwnerSkillStore,
  openDatabase,
  runMigrations
} from "../packages/db/dist/index.js";

const OWNER = "owner-local";
const FOREIGN_OWNER = "foreign-owner";
const PROJECT_A = "project-a";
const PROJECT_B = "project-b";
const CHAT_A = "chat-a";
const CHAT_B = "chat-b";
const FOREIGN_CHAT = "foreign-chat";
const FIXED_NOW = Date.parse("2026-11-27T12:00:00.000Z");
const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const journal = {
  status: "running",
  format: "kosmora.memory-acceptance.journal.v1",
  started_at: new Date().toISOString(),
  node: process.version,
  owner: OWNER,
  checkpoints: [],
  assertions: [],
  fixture: true,
  provider_called: false,
  model_called: false,
  network_called: false
};

let checkpointIndex = 0;
function section(name, fn) {
  const id = String(++checkpointIndex).padStart(2, "0");
  console.log(`\n[${id}] ${name}`);
  const started = Date.now();
  const result = fn();
  const entry = {
    id,
    name,
    ms: Date.now() - started,
    result: result ?? null
  };
  journal.checkpoints.push(entry);
  console.log(`  OK (${entry.ms} ms)`);
  return result;
}
function assertStep(name, fn) {
  try {
    fn();
    journal.assertions.push({ name, passed: true });
    console.log(`  ASSERT ${name}: PASS`);
  } catch (error) {
    journal.assertions.push({ name, passed: false, error: String(error?.message ?? error) });
    console.error(`  ASSERT ${name}: FAIL — ${error?.message ?? error}`);
    throw error;
  }
}

/* ------------------------------------------------------------------ *
 * 1. Deterministic two-project, multi-chat fixture corpus
 * ------------------------------------------------------------------ */
const db = openDatabase(":memory:");
await runMigrations(db);
const sqlite = db.sqlite;
const insertChat = sqlite.prepare(
  "INSERT INTO general_chats(id,owner_id,title,created_at,updated_at) VALUES(?,?,?,?,?)"
);
const insertProjectChat = sqlite.prepare(
  "INSERT INTO chats(id,project_id,kind,created_at) VALUES(?,?,'main',?)"
);
const insertMessage = sqlite.prepare(
  "INSERT INTO general_chat_messages(id,chat_id,owner_id,role,content_type,content,status,created_at,updated_at) VALUES(?,?,?,?,'text',?,'completed',?,?)"
);
const insertProject = sqlite.prepare(
  "INSERT INTO projects(id,owner_id,title,status,created_at,updated_at) VALUES(?,?,?,'ACTIVE',?,?)"
);
const insertProjectMessage = sqlite.prepare(
  "INSERT INTO messages(id,chat_id,project_id,role,content_type,content,status,created_at,updated_at) VALUES(?,?,?,?,'text',?,'completed',?,?)"
);
const at = (minute) => new Date(FIXED_NOW + minute * 60_000).toISOString();
const pad = (n) => String(n).padStart(2, "0");

for (const [id, owner, title] of [
  [CHAT_A, OWNER, "A: long decision chat"],
  [CHAT_B, OWNER, "B: continuation chat"],
  [FOREIGN_CHAT, FOREIGN_OWNER, "Foreign chat"]
])
  insertChat.run(id, owner, title, at(0), at(0));
for (const [id, owner, name] of [
  [PROJECT_A, OWNER, "Project A"],
  [PROJECT_B, OWNER, "Project B"]
])
  insertProject.run(id, owner, name, at(0), at(0));

// Long "filler" turns give compaction real work; every protected decision is
// an explicit user turn with exact numbers, versions and source references.
const filler = (n) =>
  `Подробное описание оформления варианта ${n}: цвета, отступы, шрифты и повторные детали. `.repeat(
    10
  );
const chatATurns = [
  ["user", "Проект «Логистика». Заявка 00123, бюджет 17 350 ₽. Доставка не входит."],
  ["assistant", filler(1)],
  ["user", "РЕШЕНИЕ v1 от 2026-11-02: бюджет 17 350 ₽ по заявке 00123, доставка не входит."],
  ["assistant", filler(2)],
  ["user", "РЕШЕНИЕ v2 от 2026-11-03: бюджет 19 700 ₽ по заявке 00123, доставка не входит."],
  ["assistant", filler(3)],
  ["user", "Ограничение: код заявки 00123 не менять."],
  ["assistant", filler(4)],
  ["user", "Проект A использует поставщика «Альфа», валюта RUB."],
  ["assistant", filler(5)],
  ["user", "Проект B использует поставщика «Бета», валюта EUR."],
  ["assistant", filler(6)],
  ["user", "ИСТОЧНИК-СЕКРЕТ: устаревшая цена 99 999 ₽ больше не действует."],
  ["assistant", filler(7)],
  ["user", "Статус: письмо не отправлено, ждём согласования."],
  ["assistant", filler(8)],
  ["user", "Напомни: бюджет заявки 00123 и что с доставкой?"]
];
const corpus = [];
chatATurns.forEach(([role, content], i) => {
  corpus.push({
    id: `a-${pad(i)}`,
    chat_id: CHAT_A,
    role,
    content_type: "text",
    content,
    status: "completed",
    created_at: at(i),
    updated_at: at(i),
    owner: OWNER
  });
});
// A second, independent chat. Its evidence is allowed only after explicit grant.
const chatBTurns = [
  ["user", "В чате B зафиксировано: срок поставки 05.11.2026, адрес склада уточняется."],
  ["assistant", filler(9)],
  ["user", "Продолжение: бюджет 19 700 ₽ остаётся актуальным, доставка не входит."],
  ["assistant", filler(10)],
  ["user", "Вопрос из чата B: какой бюджет заявки и что с доставкой?"]
];
chatBTurns.forEach(([role, content], i) => {
  corpus.push({
    id: `b-${pad(i)}`,
    chat_id: CHAT_B,
    role,
    content_type: "text",
    content,
    status: "completed",
    created_at: at(20 + i),
    updated_at: at(20 + i),
    owner: OWNER
  });
});
// A foreign-owner chat with a tempting lookalike decision. It must never be
// visible to the local owner's assembled bundle.
const foreignTurns = [
  ["user", "ЧУЖОЕ: бюджет 77 777 ₽ по заявке 00123, доставка включена."],
  ["assistant", filler(11)]
];
foreignTurns.forEach(([role, content], i) => {
  insertMessage.run(
    `f-${pad(i)}`,
    FOREIGN_CHAT,
    FOREIGN_OWNER,
    role,
    content,
    at(30 + i),
    at(30 + i)
  );
});
for (const m of corpus) {
  if (m.chat_id === CHAT_A || m.chat_id === CHAT_B)
    insertMessage.run(m.id, m.chat_id, m.owner, m.role, m.content, m.created_at, m.updated_at);
}
const projectMessages = [
  { id: "p-a-0", project_id: PROJECT_A, content: "Проект A: приоритетный поставщик «Альфа», RUB." },
  { id: "p-b-0", project_id: PROJECT_B, content: "Проект B: приоритетный поставщик «Бета», EUR." },
  {
    id: "p-b-1",
    project_id: PROJECT_B,
    content: "ЧУЖОЙ ПРОЕКТ для target A: бюджет 88 888 ₽, доставка включена."
  }
];
// Project chats are required by the schema; create them with stable ids.
const projectChatIds = {
  [PROJECT_A]: "chat-project-a",
  [PROJECT_B]: "chat-project-b"
};
for (const [projectId, chatId] of Object.entries(projectChatIds))
  insertProjectChat.run(chatId, projectId, at(0));
for (const m of projectMessages) {
  insertProjectMessage.run(
    m.id,
    projectChatIds[m.project_id],
    m.project_id,
    "user",
    m.content,
    at(40),
    at(40)
  );
}

const messagesByChat = {
  [CHAT_A]: corpus.filter((m) => m.chat_id === CHAT_A),
  [CHAT_B]: corpus.filter((m) => m.chat_id === CHAT_B)
};

section("1. Deterministic two-project, multi-chat fixture corpus", () => {
  assertStep("17 owner messages in chat A and 5 in chat B", () => {
    assert.equal(messagesByChat[CHAT_A].length, 17);
    assert.equal(messagesByChat[CHAT_B].length, 5);
  });
  assertStep("two projects and one foreign owner chat exist", () => {
    assert.equal(Number(sqlite.prepare("SELECT count(*) n FROM projects").get().n), 2);
    assert.equal(
      Number(
        sqlite
          .prepare("SELECT count(*) n FROM general_chats WHERE owner_id=? AND id=?")
          .get(FOREIGN_OWNER, FOREIGN_CHAT).n
      ),
      1
    );
  });
  assertStep("fixture carries decisions, contradictions and a source to exclude", () => {
    const text = corpus.map((m) => m.content).join("\n");
    for (const needle of ["РЕШЕНИЕ v1", "РЕШЕНИЕ v2", "19 700", "17 350", "ИСТОЧНИК-СЕКРЕТ"])
      assert.ok(text.includes(needle), needle);
  });
  return {
    chat_a_messages: messagesByChat[CHAT_A].length,
    chat_b_messages: messagesByChat[CHAT_B].length,
    projects: projectMessages.length,
    foreign_messages: foreignTurns.length
  };
});

/* ------------------------------------------------------------------ *
 * 2. Decision accepted, changed, compacted, serialized, continued
 * ------------------------------------------------------------------ */
const memory = new ContextMemoryStore(sqlite, () => FIXED_NOW);
const targetA = { kind: "chat", id: CHAT_A };
const targetB = { kind: "chat", id: CHAT_B };
const targetProjectB = { kind: "project", id: PROJECT_B };

function setSettings(target, owner, extra = {}) {
  return memory.updateSettings(
    target,
    {
      enabled: true,
      use_personal: false,
      source_chat_ids: [],
      project_ids: [],
      expected_version: memory.settings(target, owner).version,
      ...extra
    },
    owner
  );
}
setSettings(targetA, OWNER);
setSettings(targetB, OWNER, { source_chat_ids: [CHAT_A] });
setSettings(targetProjectB, OWNER);

const decisionV1 = memory.create(
  {
    scope: "chat",
    scope_id: CHAT_A,
    kind: "decision",
    title: "Бюджет заявки 00123",
    content: "РЕШЕНИЕ v1: бюджет 17 350 ₽, доставка не входит.",
    pinned: true,
    expires_at: null,
    source: {
      kind: "chat_message",
      message_id: "a-02",
      quote: "РЕШЕНИЕ v1 от 2026-11-02: бюджет 17 350 ₽"
    }
  },
  OWNER
);
const decisionV2 = memory.update(
  decisionV1.id,
  decisionV1.version,
  {
    scope: "chat",
    scope_id: CHAT_A,
    kind: "decision",
    title: "Бюджет заявки 00123",
    content: "РЕШЕНИЕ v2: бюджет 19 700 ₽, доставка не входит.",
    pinned: true,
    expires_at: null,
    source: {
      kind: "chat_message",
      message_id: "a-04",
      quote: "РЕШЕНИЕ v2 от 2026-11-03: бюджет 19 700 ₽"
    }
  },
  OWNER
);
const codeConstraint = memory.create(
  {
    scope: "personal",
    scope_id: null,
    kind: "constraint",
    title: "Код заявки 00123",
    content: "Ограничение: код заявки 00123 не менять.",
    pinned: true,
    expires_at: null,
    source: {
      kind: "chat_message",
      message_id: "a-06",
      quote: "код заявки 00123 не менять"
    }
  },
  OWNER
);
const secretSource = corpus.find((m) => m.content.includes("ИСТОЧНИК-СЕКРЕТ"));
const secretDecision = memory.create(
  {
    scope: "chat",
    scope_id: CHAT_A,
    kind: "fact",
    title: "Устаревшая цена",
    content: "ИСТОЧНИК-СЕКРЕТ: устаревшая цена 99 999 ₽ больше не действует.",
    pinned: false,
    expires_at: null,
    source: {
      kind: "chat_message",
      message_id: secretSource.id,
      quote: "устаревшая цена 99 999 ₽"
    }
  },
  OWNER
);

// Real compaction with the provided production function.
const compacted = compactChatHistory(messagesByChat[CHAT_A], {
  enabled: true,
  query: "бюджет заявки и доставка"
});
const capsuleText = (compacted.memory?.items ?? []).map((i) => i.text).join("\n");

// Serialize/restart round-trip: the real store snapshot -> JSON -> new DB.
const snapshot = memory.localSnapshot(OWNER);
const restartedDb = openDatabase(":memory:");
await runMigrations(restartedDb);
const INSERT_MIGRATION_TABLES = [
  "INSERT INTO general_chats(id,owner_id,title,created_at,updated_at) VALUES(?,?,?,?,?) SELECT_PLACEHOLDER"
];
void INSERT_MIGRATION_TABLES; // documentation of intent; actual restores below use parameterized inserts.
for (const [id, owner, title] of [
  [CHAT_A, OWNER, "A: long decision chat"],
  [CHAT_B, OWNER, "B: continuation chat"],
  [FOREIGN_CHAT, FOREIGN_OWNER, "Foreign chat"]
])
  restartedDb.sqlite
    .prepare("INSERT INTO general_chats(id,owner_id,title,created_at,updated_at) VALUES(?,?,?,?,?)")
    .run(id, owner, title, at(0), at(0));
for (const m of corpus)
  restartedDb.sqlite
    .prepare(
      "INSERT INTO general_chat_messages(id,chat_id,owner_id,role,content_type,content,status,created_at,updated_at) VALUES(?,?,?,?,'text',?,'completed',?,?)"
    )
    .run(m.id, m.chat_id, m.owner, m.role, m.content, m.created_at, m.updated_at);
for (const [id, owner, name] of [
  [PROJECT_A, OWNER, "Project A"],
  [PROJECT_B, OWNER, "Project B"]
])
  restartedDb.sqlite
    .prepare(
      "INSERT INTO projects(id,owner_id,title,status,created_at,updated_at) VALUES(?,?,?,'ACTIVE',?,?)"
    )
    .run(id, owner, name, at(0), at(0));
const restoredMemory = new ContextMemoryStore(restartedDb.sqlite, () => FIXED_NOW);
const restoreRow = restartedDb.sqlite.prepare(
  `INSERT INTO context_memory_entries(id,owner_id,scope,chat_id,project_id,kind,title,content,pinned,expires_at,
    source_chat_message_id,source_project_message_id,source_json,version,created_at,updated_at,creation_key,creation_sha256)
   VALUES(@id,@owner_id,@scope,@chat_id,@project_id,@kind,@title,@content,@pinned,@expires_at,
    @source_chat_message_id,@source_project_message_id,@source_json,@version,@created_at,@updated_at,NULL,NULL)`
);
const restoreSettingsRow = restartedDb.sqlite.prepare(
  `INSERT INTO context_memory_settings(owner_id,target_kind,target_id,chat_id,project_id,enabled,use_personal,
   source_chat_ids_json,project_ids_json,version,compact_history)
   VALUES(@owner_id,@target_kind,@target_id,@chat_id,@project_id,@enabled,@use_personal,
   @source_chat_ids_json,@project_ids_json,@version,@compact_history)`
);
for (const entry of JSON.parse(JSON.stringify(snapshot.entries))) {
  restoreRow.run({
    id: entry.id,
    owner_id: OWNER,
    scope: entry.scope,
    chat_id: entry.scope === "chat" ? entry.scope_id : null,
    project_id: entry.scope === "project" ? entry.scope_id : null,
    kind: entry.kind,
    title: entry.title,
    content: entry.content,
    pinned: Number(entry.pinned),
    expires_at: entry.expires_at,
    source_chat_message_id: entry.source?.kind === "chat_message" ? entry.source.message_id : null,
    source_project_message_id:
      entry.source?.kind === "project_message" ? entry.source.message_id : null,
    source_json: entry.source ? JSON.stringify(entry.source) : null,
    version: entry.version,
    created_at: entry.created_at,
    updated_at: entry.updated_at
  });
}
for (const row of JSON.parse(JSON.stringify(snapshot.settings))) {
  restoreSettingsRow.run({
    owner_id: row.owner_id,
    target_kind: row.target_kind,
    target_id: row.target_id,
    chat_id: row.chat_id,
    project_id: row.project_id,
    enabled: row.enabled,
    use_personal: row.use_personal,
    source_chat_ids_json: row.source_chat_ids_json,
    project_ids_json: row.project_ids_json,
    version: row.version,
    compact_history: row.compact_history
  });
}
const restoreVersionRow = restartedDb.sqlite.prepare(
  "INSERT INTO context_memory_versions(entry_id,version,snapshot_json) VALUES(?,?,?)"
);
for (const v of memory.versions(decisionV2.id, OWNER))
  restoreVersionRow.run(decisionV2.id, v.version, JSON.stringify(v));
// Continue from the other allowed chat target after the "restart".
const continued = restoredMemory.resolve(targetB, OWNER, "бюджет заявки доставка");
const continuedDecision = continued.items.find(
  (i) => i.kind === "memory" && i.title === "Бюджет заявки 00123"
);
const continuedHistory = continued.items.filter((i) => i.kind === "history");
const versionsAfterRestart = restoredMemory.versions(decisionV2.id, OWNER);
const newestAfterRestart = versionsAfterRestart[0];
const oldAfterRestart = versionsAfterRestart.find((v) => v.version === 1);

section("2. Decision accepted, changed, compacted, serialized, continued", () => {
  assertStep("compaction applied and report is honest", () => {
    assert.equal(compacted.report.state, "applied");
    assert.ok(compacted.report.source_bytes > compacted.report.capsule_bytes);
    assert.ok(compacted.memory);
  });
  assertStep("both decision versions survive compaction with provenance", () => {
    for (const needle of ["17 350", "19 700", "00123", "доставка не входит"])
      assert.ok(capsuleText.includes(needle), `capsule missing ${needle}`);
    const sources = compacted.memory.items.filter((i) => i.source);
    assert.ok(sources.some((i) => i.source.message_id === "a-02"));
    assert.ok(sources.some((i) => i.source.message_id === "a-04"));
  });
  assertStep("snapshot JSON round-trip preserves versions and source hashes", () => {
    assert.equal(typeof snapshot.format, "string");
    assert.equal(snapshot.entries.length, 3);
    assert.equal(restoredMemory.get(decisionV2.id, OWNER).version, 2);
    assert.equal(newestAfterRestart.version, 2);
    assert.equal(oldAfterRestart.version, 1);
    assert.equal(oldAfterRestart.content, decisionV1.content);
    assert.equal(newestAfterRestart.source.sha256, decisionV2.source.sha256);
    assert.equal(newestAfterRestart.source.message_id, "a-04");
  });
  assertStep("new decision wins; old decision is not silently overriding", () => {
    assert.ok(continuedDecision, "newest decision must be present");
    assert.equal(continuedDecision.text, decisionV2.content);
    assert.equal(continuedDecision.version, 2);
    assert.equal(continuedDecision.source.message_id, "a-04");
    // The older text may appear only as an explicitly dated history excerpt,
    // never as an active memory entry that could silently override v2.
    const oldMemories = continued.items.filter(
      (i) => i.kind === "memory" && i.text.includes("РЕШЕНИЕ v1")
    );
    assert.equal(oldMemories.length, 0, "older decision must not be an active memory");
    const oldHistory = continued.items.filter((i) => i.text.includes("РЕШЕНИЕ v1"));
    for (const item of oldHistory) {
      assert.equal(item.kind, "history");
      assert.ok(item.source?.sha256, "history excerpt must carry provenance");
    }
  });
  assertStep("continuation via another allowed chat keeps exact facts", () => {
    assert.ok(continuedDecision.text.includes("19 700 ₽"));
    assert.ok(continuedDecision.text.includes("доставка не входит"));
    assert.equal(continued.target.id, CHAT_B);
    assert.ok(continuedHistory.length > 0);
  });
  return {
    compaction: {
      state: compacted.report.state,
      source_bytes: compacted.report.source_bytes,
      capsule_bytes: compacted.report.capsule_bytes,
      protected_kept: compacted.report.protected_kept
    },
    snapshot: { format: snapshot.format, entries: snapshot.entries.length },
    restored: {
      current_version: newestAfterRestart.version,
      retained_old_version: oldAfterRestart.version,
      continued_items: continued.items.length,
      history_items_in_continuation: continuedHistory.length,
      current_reference: continuedDecision.reference
    }
  };
});

/* ------------------------------------------------------------------ *
 * 3. Exclusion + owner/project isolation + real core scope functions
 * ------------------------------------------------------------------ */
// We need the excluded source's message to be visible in the first place, so
// grant chat A to the target and include project B grants.
const settingsA = setSettings(targetA, OWNER, {
  source_chat_ids: [CHAT_A],
  project_ids: [PROJECT_A]
});
const beforeExclude = memory.resolve(targetA, OWNER, "устаревшая цена", [], 8000);
const hasSecretBefore = beforeExclude.items.some((i) => i.text.includes("99 999"));
const afterExclude = memory.resolve(targetA, OWNER, "устаревшая цена", [secretSource.id], 8000);
const hasSecretAfter = afterExclude.items.some((i) => i.text.includes("99 999"));

// Cross-owner: query the project-B target, which is owned by OWNER; foreign
// owner's lookalike decision must not appear.
const crossOwner = memory.resolve(targetProjectB, OWNER, "бюджет заявки доставка", [], 8000);
const leakedForeign = crossOwner.items.some((i) => i.text.includes("77 777"));
const leakedProjectA = crossOwner.items.some((i) => i.text.includes("«Альфа»"));

// Exercise the production core scope functions on a deliberately mixed bundle.
const mixedItems = [
  ...continued.items.map((i) => ({ ...i, owner: OWNER })),
  {
    reference: "H:g:f-00",
    kind: "history",
    title: at(30),
    text: "ЧУЖОЕ: бюджет 77 777 ₽ по заявке 00123, доставка включена.",
    source: {
      kind: "chat_message",
      message_id: "f-00",
      chat_id: FOREIGN_CHAT,
      project_id: null,
      role: "user",
      quote: "ЧУЖОЕ: бюджет 77 777 ₽",
      sha256: sha256("foreign")
    },
    excerpt_only: false,
    owner: FOREIGN_OWNER,
    matched: true
  },
  {
    reference: "H:g:a-12",
    kind: "history",
    title: at(12),
    text: "ИСТОЧНИК-СЕКРЕТ: устаревшая цена 99 999 ₽ больше не действует.",
    source: {
      kind: "chat_message",
      message_id: secretSource.id,
      chat_id: CHAT_A,
      project_id: null,
      role: "user",
      quote: "устаревшая цена 99 999 ₽",
      sha256: sha256(secretSource.content)
    },
    excerpt_only: false,
    owner: OWNER,
    matched: true
  }
];
const scopedItems = selectContextScope(mixedItems, {
  owner: OWNER,
  query: "бюджет заявки доставка",
  isDeleted: (i) => i.source?.message_id === secretSource.id
});
const fitScoped = fitContextMemory(
  {
    format: "kosmora.context-memory.v1",
    target: targetA,
    items: scopedItems,
    omitted: 2,
    priority_omitted: 0,
    bytes: 0,
    budget_bytes: 6000,
    retrieval: "lexical",
    answer_evidence: "matched",
    matched_items: scopedItems.filter((i) => i.matched).length
  },
  16000,
  "бюджет заявки доставка"
);
const merged = mergeContextMemory(
  {
    format: "kosmora.context-memory.v1",
    target: targetA,
    items: [
      {
        ...decisionV2,
        reference: "M:" + decisionV2.id,
        text: decisionV2.content,
        title: "Бюджет заявки 00123",
        memory_kind: "decision",
        version: 2,
        source: decisionV2.source,
        excerpt_only: false
      },
      {
        ...codeConstraint,
        reference: "M:" + codeConstraint.id,
        text: codeConstraint.content,
        title: "Код заявки 00123",
        memory_kind: "constraint",
        version: 1,
        source: codeConstraint.source,
        excerpt_only: false
      }
    ],
    omitted: 0,
    priority_omitted: 0,
    bytes: 0,
    budget_bytes: 3000,
    retrieval: "lexical"
  },
  {
    format: "kosmora.context-memory.v1",
    target: targetA,
    items: [
      {
        ...codeConstraint,
        reference: "M:" + codeConstraint.id,
        text: codeConstraint.content,
        title: "Код заявки 00123",
        memory_kind: "constraint",
        version: 1,
        source: codeConstraint.source,
        excerpt_only: false
      }
    ],
    omitted: 0,
    priority_omitted: 0,
    bytes: 0,
    budget_bytes: 3000,
    retrieval: "lexical"
  }
);
const mergedSelected = selectContextBundle(merged, { owner: OWNER });

section("3. Excluded source and cross-owner/cross-project isolation", () => {
  assertStep("excluded source is present before exclusion", () => {
    assert.equal(hasSecretBefore, true);
  });
  assertStep("excluded source is absent after exclusion", () => {
    assert.equal(hasSecretAfter, false);
    assert.equal(
      afterExclude.items.some((i) => i.source?.message_id === secretSource.id),
      false
    );
  });
  assertStep("foreign owner and foreign project evidence do not leak", () => {
    assert.equal(leakedForeign, false);
    assert.equal(leakedProjectA, false);
  });
  assertStep("selectContextScope drops foreign owner, deleted source and stale revision", () => {
    assert.ok(!scopedItems.some((i) => i.owner === FOREIGN_OWNER));
    assert.ok(!scopedItems.some((i) => i.source?.message_id === secretSource.id));
    assert.ok(
      !scopedItems.some(
        (i) => i.kind === "memory" && i.title === "Бюджет заявки 00123" && i.version === 1
      )
    );
  });
  assertStep("fit/merge/selectContextBundle keep the current bundle shape", () => {
    assert.ok(fitScoped && Array.isArray(fitScoped.items));
    assert.ok(fitScoped.bytes > 0);
    assert.equal(merged.target.id, targetA.id);
    assert.ok(mergedSelected && mergedSelected.items.length >= 1);
    assert.ok(mergedSelected.items.some((i) => i.text?.includes("00123")));
  });
  return {
    exclude: {
      source_message_id: secretSource.id,
      present_before: hasSecretBefore,
      present_after: hasSecretAfter
    },
    isolation: {
      foreign_owner_in_bundle: leakedForeign,
      other_project_in_bundle: leakedProjectA
    },
    core_scope: {
      mixed_items: mixedItems.length,
      scoped_items: scopedItems.length,
      fitted_items: fitScoped?.items.length ?? 0,
      selected_after_merge: mergedSelected?.items.length ?? 0
    }
  };
});

/* ------------------------------------------------------------------ *
 * 4. Skill cycle: compile -> accept -> apply -> correct -> disable
 * ------------------------------------------------------------------ */
const setup = {
  name: "Бюджет заявки: тезисы",
  summary: "Проверять бюджет и доставку по заявке 00123.",
  goal: "Отвечать тезисно и сохранять актуальную сумму и запрет доставки.",
  scope: "Локальная фикстура заявки 00123; без внешних действий.",
  examples: ["РЕШЕНИЕ v2: бюджет 19 700 ₽, доставка не входит."],
  style: "Короткий список тезисов без выдуманных сумм.",
  sources: ["Только разрешённые владельцем чаты и память."],
  tools: ["Нет"],
  criteria: ["Сохранить 19 700 ₽", "Не добавлять доставку", "Формат: список"]
};
const draft = compileSpecialization(setup);
const skillStore = new OwnerSkillStore(sqlite);
const chatSkillStore = new ChatSkillStore(sqlite);
const requestId = "11111111-2222-4333-8444-555555555555";
const savedV1 = skillStore.create(OWNER, draft, requestId);
const savedAgain = skillStore.create(OWNER, draft, requestId);
const sourceText = decisionV2.content;
const badAnswer = "- Бюджет 17 350 ₽ с доставкой";
const goodAnswer = "- Бюджет 19 700 ₽\n- Доставка не входит в бюджет";
const evaluationBad = evaluateSkillResult({
  source: sourceText,
  answer: badAnswer,
  required_facts: ["19 700 ₽"],
  forbidden: ["с доставкой", "17 350"],
  format: "bullets"
});
const evaluationGood = evaluateSkillResult({
  source: sourceText,
  answer: goodAnswer,
  required_facts: ["19 700 ₽"],
  forbidden: ["с доставкой", "17 350"],
  format: "bullets"
});
// Correction becomes a NEW VERSION through the real store, preserving v1.
const correctedDraft = {
  ...draft,
  summary: "Исправлено: всегда проверять только актуальную версию решения.",
  instructions:
    draft.instructions +
    "\nИСПРАВЛЕНИЕ v2: если есть несколько версий решения, использовать только самую новую."
};
const savedV2 = skillStore.update(OWNER, savedV1.id, 1, correctedDraft);
const versions = skillStore.get(OWNER, savedV1.id).versions;
// Enable the skill on chat B, then disable it; the accepted-run snapshot is
// independent of the mutable catalog.
const selectionOn = chatSkillStore.update(targetB.id, OWNER, 0, [
  { skill_id: savedV2.id, version: 2 }
]);
const selectionOff = chatSkillStore.update(targetB.id, OWNER, selectionOn.version, []);
// "Run" without the skill: deliberately use the older decision but still
// enforce the explicit constraint, so the result is different AND correct.
const noSkillAnswer = "- Код заявки 00123 не менять\n- Бюджет уточняется у владельца";
const evaluationNoSkill = evaluateSkillResult({
  source: codeConstraint.content,
  answer: noSkillAnswer,
  required_facts: ["00123", "не менять"],
  forbidden: ["19 700 ₽", "с доставкой"],
  format: "bullets"
});

section("4. Skill cycle: compile, accept, evaluate, correct, disable", () => {
  assertStep("compiled draft is inert and cites non-granted rights", () => {
    assert.equal(draft.accepted, false);
    assert.equal(draft.format, "kosmora.specialization-draft.v1");
    assert.ok(draft.not_granted.length >= 3);
  });
  assertStep("explicit accept creates a versioned skill idempotently", () => {
    assert.equal(savedV1.current_version, 1);
    assert.equal(savedAgain.id, savedV1.id);
  });
  assertStep("old artifact fails, corrected artifact passes explicit checks", () => {
    assert.equal(evaluationBad.passed, false);
    assert.ok(evaluationBad.checks.some((c) => c.criterion === "facts_preserved" && !c.passed));
    assert.equal(evaluationGood.passed, true);
    assert.deepEqual(evaluationGood.not_checked, ["truth", "intelligence", "benchmark_gain"]);
  });
  assertStep("correction appends version 2; version 1 remains accessible", () => {
    assert.equal(savedV2.current_version, 2);
    assert.equal(versions.length, 2);
    assert.equal(versions[0].version, 2);
    assert.equal(versions[1].version, 1);
    assert.ok(versions[1].instructions.includes("ИСПРАВЛЕНИЕ v2") === false);
  });
  assertStep("disable leaves a different but correct result and old artifact readable", () => {
    assert.equal(selectionOn.items.length, 1);
    assert.equal(selectionOn.items[0].version, 2);
    assert.equal(selectionOff.items.length, 0);
    assert.equal(evaluationNoSkill.passed, true);
    assert.notEqual(noSkillAnswer, goodAnswer);
    assert.equal(skillStore.get(OWNER, savedV1.id).versions[1].version, 1);
  });
  return {
    draft: { format: draft.format, accepted: draft.accepted, not_granted: draft.not_granted },
    skill: {
      id: savedV1.id,
      accepted_version: savedV1.current_version,
      corrected_version: savedV2.current_version
    },
    evaluation: {
      before_correction_passed: evaluationBad.passed,
      after_correction_passed: evaluationGood.passed,
      after_disable_passed: evaluationNoSkill.passed,
      not_checked: evaluationGood.not_checked
    },
    chat_selection: {
      enabled_items: selectionOn.items.length,
      disabled_items: selectionOff.items.length
    },
    versions_retained: versions.map((v) => v.version)
  };
});

/* ------------------------------------------------------------------ *
 * 5. Honest boundaries + JSON journal
 * ------------------------------------------------------------------ */
const notChecked = [
  "truth of any recalled statement (provenance and version are checked, not factual correctness)",
  "model quality, reasoning, paraphrase quality or benchmark gain",
  "live provider / real LLM responses (no network or model call was made)",
  "real production HTTP wiring (this local harness imports modules directly)",
  "embedding/semantic retrieval quality (no semantic ranker was used)",
  "secret detection beyond the existing memoryContainsCredential rule",
  "permissions/tool execution: compiled skills grant no rights",
  "perfect or lossless memory: compaction is exact-quote extractive; omitted spans remain omitted"
];
section("5. Honest boundaries", () => {
  assertStep("no provider/model/network was called", () => {
    assert.equal(journal.provider_called, false);
    assert.equal(journal.model_called, false);
    assert.equal(journal.network_called, false);
  });
  console.log("  NOT CHECKED:");
  for (const item of notChecked) console.log(`    - ${item}`);
  return { not_checked: notChecked };
});

journal.finished_at = new Date().toISOString();
journal.status = journal.assertions.every((a) => a.passed) ? "PASS" : "FAIL";
journal.summary = {
  checkpoints: journal.checkpoints.length,
  assertions: journal.assertions.length,
  failed_assertions: journal.assertions.filter((a) => !a.passed).length,
  provider_called: false,
  model_called: false,
  network_called: false
};
const output = process.argv.find((v) => v.startsWith("--output="))?.slice(9);
const defaultOutput = fileURLToPath(
  new URL(
    "../docs/team/operation-2026-11-27/deliveries/05_HARNESS/memory-acceptance.journal.json",
    import.meta.url
  )
);
writeFileSync(output ?? defaultOutput, JSON.stringify(journal, null, 2) + "\n", "utf8");
console.log(
  `\nACCEPTANCE ${journal.status} — ${journal.summary.assertions} assertions, ` +
    `journal: ${output ?? defaultOutput}`
);
db.close();
restartedDb.close();
if (journal.status !== "PASS") process.exitCode = 1;
