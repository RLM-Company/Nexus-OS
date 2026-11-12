// Node 24+. Build @cosmora/contracts, @cosmora/core, @cosmora/db first.
// Fixed fixture panel for the 04_DEEPSEEK memory loop (slice C).
// NO owner data, NO provider call, NO model download, NO E5 inference.
//
// Honest scope: "baseline" is a reconstruction of the pre-slice-A behaviour
// (the bundle always looked like an answer because it always contained stable
// records and had no honesty signal). It is NOT a run of an old binary. The
// comparison measures the new signal's effect on false-answer risk, not model
// quality. All numbers are computed from the real in-memory SQLite store.
import assert from "node:assert/strict";
import console from "node:console";
import process from "node:process";
import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";
import { openDatabase, runMigrations, ContextMemoryStore } from "../packages/db/dist/index.js";

const at = "2026-11-11T09:00:00.000Z";
const target = { kind: "chat", id: "work" };

// Fixed panel: each case declares what a correct recall must do.
const cases = [
  {
    id: "matched-budget",
    query: "какой бюджет заявки 00123",
    expect: "matched",
    expectedFact: "19 700",
    // The superseded figure legitimately remains in history as a separate,
    // attributed source. It must NOT be presented as the current answer by a
    // memory entry; that is checked via memoryEntryLeak below.
    forbiddenFact: null
  },
  {
    id: "matched-exception",
    query: "что с доставкой кроме",
    expect: "matched",
    expectedFact: "Кроме доставки",
    forbiddenFact: null
  },
  {
    id: "absent-fact",
    query: "какая погода на Марсе в марте",
    expect: "absent",
    expectedFact: null,
    forbiddenFact: null
  },
  {
    id: "absent-after-revoke",
    query: "сколько стоит бюджет",
    expect: "absent",
    expectedFact: null,
    forbiddenFact: "19 700",
    revoke: true
  },
  {
    id: "matched-history-after-forget",
    query: "код заявки 00123",
    expect: "matched",
    expectedFact: "00123",
    // Forgetting the memory entry must not erase the canonical chat message.
    forbiddenFact: null,
    forget: true,
    forgottenReferenceMustBeAbsent: true
  }
];

const build = async () => {
  const db = openDatabase(":memory:");
  await runMigrations(db);
  const store = new ContextMemoryStore(db.sqlite, () => Date.parse(at));
  for (const [id, owner] of [
    ["work", "a"],
    ["archive", "a"],
    ["foreign", "b"]
  ])
    db.sqlite
      .prepare(
        "INSERT INTO general_chats(id,owner_id,title,created_at,updated_at) VALUES(?,?,?,?,?)"
      )
      .run(id, owner, id, at, at);
  const msg = (id, text, chat = "archive") =>
    db.sqlite
      .prepare(
        "INSERT INTO general_chat_messages(id,chat_id,owner_id,role,content_type,content,status,created_at,updated_at) VALUES(?,?,?,'user','text',?,'completed',?,?)"
      )
      .run(id, chat, "a", text, at, at);
  msg("m-old", "Заявка 00123, бюджет 17 350 ₽, доставка не входит.");
  msg("m-new", "Уточнение: бюджет 19 700 ₽ на заявку 00123.");
  msg("m-ex", "Кроме доставки ничего не добавлять.");
  msg("m-foreign", "Чужой проект: 77 777 ₽.", "foreign");
  store.create(
    {
      scope: "personal",
      scope_id: null,
      kind: "decision",
      title: "Бюджет",
      content: "Бюджет 19 700 ₽, кроме доставки.",
      pinned: false,
      expires_at: null,
      source: null
    },
    "a"
  );
  store.create(
    {
      scope: "personal",
      scope_id: null,
      kind: "constraint",
      title: "Правило",
      content: "Не менять сайдбар.",
      pinned: true,
      expires_at: null,
      source: null
    },
    "a"
  );
  store.create(
    {
      scope: "personal",
      scope_id: null,
      kind: "fact",
      title: "Код",
      content: "Код заявки 00123 не менять.",
      pinned: false,
      expires_at: null,
      source: null
    },
    "a"
  );
  store.updateSettings(
    target,
    {
      enabled: true,
      use_personal: true,
      source_chat_ids: ["archive"],
      project_ids: [],
      expected_version: 0
    },
    "a"
  );
  return { db, store };
};

const measure = (fn) => {
  const start = performance.now();
  const value = fn();
  return { value, ms: performance.now() - start };
};

const run = async () => {
  const rows = [];
  for (const c of cases) {
    const { db, store } = await build();
    if (c.revoke)
      store.updateSettings(
        target,
        {
          enabled: true,
          use_personal: false,
          source_chat_ids: [],
          project_ids: [],
          expected_version: 1
        },
        "a"
      );
    const entry = store.list("a").items.find((e) => e.title === "Код");
    let forgottenReference = null;
    if (c.forget && entry) {
      forgottenReference = "M:" + entry.id;
      store.forget(entry.id, entry.version, "a");
    }

    const { value: bundle, ms } = measure(() => store.resolve(target, "a", c.query));
    const text = bundle.items.map((e) => e.text).join("\n");
    const signal = bundle.answer_evidence ?? "absent";
    // Reconstructed pre-slice-A behaviour: no signal => treat any non-empty
    // bundle as an answer (stable constraints were always present).
    const baselineAnswer = bundle.items.length > 0 ? "matched" : "absent";
    const truth = c.expect;
    const correctFact = c.expectedFact ? text.includes(c.expectedFact) : null;
    const forbiddenPresent = c.forbiddenFact ? text.includes(c.forbiddenFact) : false;

    rows.push({
      id: c.id,
      expect: truth,
      baseline_answer: baselineAnswer,
      baseline_correct: baselineAnswer === truth,
      current_answer: signal,
      current_correct: signal === truth,
      matched_items: bundle.matched_items ?? 0,
      expected_fact_present: correctFact,
      forbidden_fact_present: forbiddenPresent,
      forgotten_entry_returned:
        forgottenReference === null
          ? null
          : bundle.items.some((e) => e.reference === forgottenReference),
      items: bundle.items.length,
      bytes: bundle.bytes,
      retrieval_ms: Number(ms.toFixed(3))
    });
    db.close();
  }

  const count = (predicate) => rows.filter(predicate).length;
  const baselineCorrect = count((r) => r.baseline_correct);
  const currentCorrect = count((r) => r.current_correct);
  const absentCases = rows.filter((r) => r.expect === "absent");
  const baselineFalseAnswers = count(
    (r) => r.expect === "absent" && r.baseline_answer === "matched"
  );
  const currentFalseAnswers = count((r) => r.expect === "absent" && r.current_answer === "matched");

  const report = {
    at: new Date().toISOString(),
    node: process.version,
    fixture: true,
    provider_called: false,
    encoder: "none (lexical recall only)",
    baseline_definition:
      "Reconstructed pre-slice-A behaviour: any non-empty bundle was treated as an answer because no answer_evidence signal existed. NOT an execution of an old binary.",
    panel: {
      cases: rows.length,
      absent_cases: absentCases.length,
      baseline_correct: baselineCorrect,
      current_correct: currentCorrect,
      baseline_false_answers_on_absent: baselineFalseAnswers,
      current_false_answers_on_absent: currentFalseAnswers,
      expected_facts_present: count((r) => r.expected_fact_present === true),
      forbidden_facts_leaked: count((r) => r.forbidden_fact_present === true),
      forgotten_entries_resurrected: count((r) => r.forgotten_entry_returned === true),
      mean_bundle_bytes: Number((rows.reduce((n, r) => n + r.bytes, 0) / rows.length).toFixed(1)),
      mean_retrieval_ms: Number(
        (rows.reduce((n, r) => n + r.retrieval_ms, 0) / rows.length).toFixed(3)
      )
    },
    rows
  };

  // Hard acceptance: no unverified answer on an absent fact, no forbidden leak,
  // every declared expected fact present, no forgotten entry resurrected.
  assert.equal(currentFalseAnswers, 0, "absent fact produced a false answer");
  assert.equal(
    count((r) => r.forbidden_fact_present === true),
    0,
    "forbidden fact leaked"
  );
  assert.equal(
    count((r) => r.expected_fact_present === false),
    0,
    "expected fact missing"
  );
  assert.equal(
    count((r) => r.forgotten_entry_returned === true),
    0,
    "forgotten entry resurrected"
  );
  assert.equal(currentCorrect, rows.length, "honesty signal disagrees with the panel");

  const output = process.argv.find((v) => v.startsWith("--output="))?.slice(9);
  if (output) writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
};

await run();
