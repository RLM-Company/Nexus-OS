"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { createComputerHistory } = require("../computer-history.cjs");
const context = { owner: "owner", origin: "https://example.test" },
  project = "project";
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "koswork-reference-"));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("koswork-reference-"));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const key = crypto.randomBytes(32),
    codec = {
      seal(text) {
        const iv = crypto.randomBytes(12),
          c = crypto.createCipheriv("aes-256-gcm", key, iv);
        return Buffer.concat([iv, c.update(text, "utf8"), c.final(), c.getAuthTag()]).toString(
          "base64"
        );
      },
      open(text) {
        const b = Buffer.from(text, "base64"),
          d = crypto.createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
        d.setAuthTag(b.subarray(-16));
        return Buffer.concat([d.update(b.subarray(12, -16)), d.final()]).toString("utf8");
      }
    };
  let now = 1000;
  const history = createComputerHistory(root, { codec, now: () => now++, namespace: "work" });
  function source({
    goal = "Исходная задача",
    state = "checked",
    criteria = "Файл проверен",
    accept = true,
    status = "completed",
    observed = true
  } = {}) {
    const journal = history.start(context, { project, goal, executionMode: "work" });
    journal.plan([{ title: "Проверить источники", criteria, state }]);
    journal.proposal(
      1,
      { kind: "type_text", text: "raw typed private value not retained" },
      { run_id: crypto.randomUUID(), mode: "provider" }
    );
    for (const phase of ["dispatching", "requested", ...(observed ? ["observed"] : [])])
      journal.mark(1, phase);
    journal.state(status);
    if (accept && status === "completed") history.accept(context, journal.id);
    return journal.id;
  }
  return {
    history,
    source,
    root,
    advance: (n) => {
      now += n;
    }
  };
}
test("only owner-accepted completed Work plans become bounded data examples", (t) => {
  const f = fixture(t);
  for (const opts of [
    { accept: false },
    { observed: false },
    { state: "pending" },
    { status: "failed" },
    { goal: "password=do-not-transfer" },
    { criteria: "Ввести пароль" },
    { criteria: "PIN: 1234" },
    { goal: "код: 123456" }
  ]) {
    const id = f.source(opts);
    assert.equal(f.history.list(context).find((r) => r.id === id).reusable, false);
    assert.throws(() => f.history.reference(context, project, id));
  }
  const id = f.source(),
    r = f.history.reference(context, project, id);
  assert.equal(r.outcome, "owner_accepted");
  assert.deepEqual(r.plan, [{ title: "Проверить источники", criteria: "Файл проверен" }]);
  assert.deepEqual(r.tool_observations, [{ kind: "type_text", count: 1 }]);
  assert.ok(Buffer.byteLength(JSON.stringify(r)) <= 14000);
  assert.ok(!JSON.stringify(r).includes("raw typed private value"));
  assert.ok(!JSON.stringify(r).includes('"state"'));
  assert.equal(f.history.list(context).find((r) => r.id === id).reusable, true);
  const disk = fs.readFileSync(
    path.join(f.root, "work-tasks-v1", fs.readdirSync(path.join(f.root, "work-tasks-v1"))[0]),
    "utf8"
  );
  assert.ok(!disk.includes("Исходная задача"));
});
test("reference scope, revision, expiry and deletion are checked against the current encrypted history", (t) => {
  const f = fixture(t),
    id = f.source(),
    r = f.history.reference(context, project, id);
  assert.throws(() => f.history.reference(context, "other-project", id));
  for (const c of [
    { ...context, owner: "foreign" },
    { ...context, origin: "https://other.test" }
  ])
    assert.throws(() => f.history.reference(c, project, id));
  assert.throws(
    () => f.history.reference(context, project, id, "0".repeat(64)),
    /COMPUTER_REFERENCE_CHANGED/
  );
  f.history.accept(context, id);
  assert.throws(
    () => f.history.reference(context, project, id, r.revision),
    /COMPUTER_REFERENCE_CHANGED/
  );
  f.advance(31 * 86400000);
  assert.throws(() => f.history.reference(context, project, id));
  const second = f.source();
  f.history.clear(context);
  assert.throws(() => f.history.reference(context, project, second));
});
test("starting a referenced task retains source lineage and cannot evict its chosen example", (t) => {
  const f = fixture(t),
    id = f.source(),
    r = f.history.reference(context, project, id);
  for (let n = 0; n < 19; n++) f.source({ goal: "Other " + n });
  const next = f.history.start(context, {
    project,
    goal: "New task",
    executionMode: "work",
    reference: { taskId: id, revision: r.revision }
  });
  assert.equal(f.history.list(context).length, 20);
  assert.equal(f.history.reference(context, project, id).revision, r.revision);
  const saved = f.history.list(context).find((x) => x.id === next.id);
  assert.deepEqual(saved.referenceSource, { taskId: id, revision: r.revision });
  next.state("interrupted");
  assert.deepEqual(f.history.recovery(context, next.id).reference, saved.referenceSource);
});
test("a shortened source goal remains well-formed and is explicitly labelled", (t) => {
  // Variant A note: a 24+ ASCII token run in the goal now classifies as a
  // credential_token prohibition and refuses the reference; this case keeps
  // exercising the well-formed cap cut with a plain-word filler instead.
  const f = fixture(t),
    id = f.source({
      goal: "слово-слово ".repeat(41) + "слово-с" + "🌙" + "хвост".repeat(150)
    }),
    r = f.history.reference(context, project, id);
  assert.equal(r.source_goal.length, 499);
  assert.equal(r.source_goal.isWellFormed(), true);
  assert.equal(r.goal_excerpt_only, true);
});

test("variant A scrubs stale plan steps and refuses exhausted goals at reference time", (t) => {
  const f = fixture(t);
  const complete = (journal, steps) => {
    journal.plan(steps);
    journal.proposal(
      1,
      { kind: "type_text", text: "raw typed private value not retained" },
      { run_id: crypto.randomUUID(), mode: "provider" }
    );
    for (const phase of ["dispatching", "requested", "observed"]) journal.mark(1, phase);
    journal.state("completed");
    f.history.accept(context, journal.id);
  };
  const mixed = f.history.start(context, {
    project,
    goal: "Собери сводку. Отправь её.",
    executionMode: "work"
  });
  complete(mixed, [
    { title: "Собрать данные", criteria: "Таблица заполнена", state: "checked" },
    { title: "Открыть файл C:\\Reports\\file.xlsx", criteria: "Файл открыт", state: "checked" },
    { title: "Сверить итоги", criteria: "Расхождений нет", state: "checked" }
  ]);
  const r = f.history.reference(context, project, mixed.id);
  assert.deepEqual(r.plan, [
    { title: "Собрать данные", criteria: "Таблица заполнена" },
    { title: "Сверить итоги", criteria: "Расхождений нет" }
  ]);
  const stop = f.history.start(context, {
    project,
    goal: "Собери сводку. Отправь на ivanov@example.com.",
    executionMode: "work"
  });
  complete(stop, [{ title: "Собрать данные", criteria: "Таблица заполнена", state: "checked" }]);
  const rs = f.history.reference(context, project, stop.id);
  assert.equal(rs.source_goal, "Собери сводку.");
  assert.equal(rs.goal_excerpt_only, true);
  const dirty = f.history.start(context, {
    project,
    goal: "Собери сводку",
    executionMode: "work"
  });
  complete(dirty, [
    { title: "Открыть C:\\данные", criteria: "Готово", state: "checked" },
    { title: "Написать", criteria: "адрес: ivanov@example.com", state: "checked" }
  ]);
  assert.equal(f.history.list(context).find((x) => x.id === dirty.id).reusable, false);
  assert.throws(() => f.history.reference(context, project, dirty.id), /UNAVAILABLE/);
  const stale = f.history.start(context, {
    project,
    goal: "Отчёт за 2026-11-01 приложить",
    executionMode: "work"
  });
  complete(stale, [{ title: "Собрать данные", criteria: "Таблица заполнена", state: "checked" }]);
  assert.equal(f.history.list(context).find((x) => x.id === stale.id).reusable, false);
  assert.throws(() => f.history.reference(context, project, stale.id), /UNAVAILABLE/);
});

test("Cyrillic keyword alternatives scrub steps and goals after the 2026-11-12 fix", (t) => {
  const f = fixture(t);
  const complete = (journal, steps) => {
    journal.plan(steps);
    journal.proposal(
      1,
      { kind: "type_text", text: "raw typed private value not retained" },
      { run_id: crypto.randomUUID(), mode: "provider" }
    );
    for (const phase of ["dispatching", "requested", "observed"]) journal.mark(1, phase);
    journal.state("completed");
    f.history.accept(context, journal.id);
  };
  // The "ключ:" step passes the upstream start/checkpoint gates (not on their
  // lists) and is dropped only by the reference scrub's Cyrillic alternative.
  const journal = f.history.start(context, {
    project,
    goal: "Собери сводку. Смотри задачу #123.",
    executionMode: "work"
  });
  complete(journal, [
    { title: "Собрать данные", criteria: "Таблица заполнена", state: "checked" },
    { title: "Внести ключ: 1234-ABCD в журнал", criteria: "Запись сделана", state: "checked" },
    { title: "Сверить итоги", criteria: "Расхождений нет", state: "checked" }
  ]);
  const r = f.history.reference(context, project, journal.id);
  assert.equal(r.source_goal, "Собери сводку.");
  assert.deepEqual(r.plan, [
    { title: "Собрать данные", criteria: "Таблица заполнена" },
    { title: "Сверить итоги", criteria: "Расхождений нет" }
  ]);
  // A goal whose first sentence is Cyrillic-stale is refused end to end.
  const refuse = f.history.start(context, {
    project,
    goal: "Третья ревизия. Продолжи сбор.",
    executionMode: "work"
  });
  complete(refuse, [{ title: "Собрать данные", criteria: "Таблица заполнена", state: "checked" }]);
  assert.equal(f.history.list(context).find((x) => x.id === refuse.id).reusable, false);
  assert.throws(() => f.history.reference(context, project, refuse.id), /UNAVAILABLE/);
});

const correction = {
  issue: "CSV потерял ведущие нули",
  guidance: "Сохраняй идентификатор 00123 как текст, цену и исключения переноси дословно.",
  applies_when: "CSV отчёт по цене и идентификаторам"
};
test("owner-confirmed corrections are versioned project data, not successful outcomes", (t) => {
  const f = fixture(t),
    id = f.source({ goal: "Подготовь CSV отчёт по цене", status: "failed", accept: false });
  const draft = f.history.correction(context, id);
  const saved = f.history.saveCorrection(context, id, draft.revision, correction);
  const reference = f.history.reference(context, project, id, saved.revision);
  assert.equal(reference.format, "koswork.confirmed-correction.v1");
  assert.equal(reference.source_outcome, "failed");
  assert.equal(reference.source_requires_review, true);
  assert.equal(reference.guidance, correction.guidance);
  assert.equal(reference.plan, undefined);
  assert.equal(f.history.list(context)[0].acceptedAt, null);
  assert.ok(!JSON.stringify(reference).includes("raw typed private"));
  const edit = f.history.saveCorrection(context, id, saved.revision, {
    ...correction,
    guidance: "Проверь тип идентификатора до экспорта CSV."
  });
  assert.notEqual(edit.revision, saved.revision);
  for (const fn of [
    () => f.history.reference(context, project, id, saved.revision),
    () => f.history.saveCorrection(context, id, saved.revision, correction),
    () => f.history.removeCorrection(context, id, saved.revision)
  ])
    assert.throws(fn, /REFERENCE_CHANGED/);
  assert.throws(() => f.history.reference(context, "other-project", id), /REFERENCE_UNAVAILABLE/);
  const matches = f.history.suggestCorrections(context, project, "Новый CSV отчёт по цене");
  assert.equal(matches[0].revision, edit.revision);
  assert.ok(matches[0].matched_terms.includes("csv"));
  assert.deepEqual(f.history.suggestCorrections(context, "other-project", "CSV отчёт"), []);
  assert.deepEqual(
    f.history.suggestCorrections({ ...context, owner: "other" }, project, "CSV отчёт"),
    []
  );
  f.history.removeCorrection(context, id, edit.revision);
  assert.equal(f.history.list(context).length, 1);
  assert.equal(f.history.list(context)[0].correction, undefined);
  assert.deepEqual(f.history.suggestCorrections(context, project, "CSV отчёт"), []);
  assert.throws(
    () => f.history.reference(context, project, id, edit.revision),
    /REFERENCE_CHANGED/
  );
});
test("corrections reject unsafe text and ineligible sources and share history expiry/clear", (t) => {
  const f = fixture(t);
  for (const opts of [
    { status: "running", accept: false },
    { status: "paused", accept: false },
    { goal: "password=fixture-value" }
  ]) {
    const id = f.source(opts);
    assert.throws(() => f.history.correction(context, id), /REFERENCE_UNAVAILABLE/);
  }
  const id = f.source({ goal: "CSV отчёт" }),
    draft = f.history.correction(context, id);
  for (const invalid of [
    { ...correction, issue: "" },
    { ...correction, guidance: "password=fixture-value" },
    { ...correction, guidance: "x".repeat(801) },
    { ...correction, applies_when: String.fromCharCode(0xd800) },
    { ...correction, extra: "injected" }
  ])
    assert.throws(() => f.history.saveCorrection(context, id, draft.revision, invalid));
  const saved = f.history.saveCorrection(context, id, draft.revision, correction);
  const files = fs.readdirSync(path.join(f.root, "work-tasks-v1"));
  assert.ok(
    files.every(
      (file) =>
        !fs
          .readFileSync(path.join(f.root, "work-tasks-v1", file), "utf8")
          .includes(correction.guidance)
    )
  );
  f.advance(31 * 86400_000);
  assert.throws(
    () => f.history.reference(context, project, id, saved.revision),
    /REFERENCE_CHANGED/
  );
  assert.deepEqual(f.history.suggestCorrections(context, project, "CSV отчёт"), []);
});
