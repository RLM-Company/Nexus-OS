"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { goalExcerpt, scrubPlan, matchesProhibition } = require("../work-reference-scrub.cjs");

test("prohibition classes match the seven bench candidate categories", () => {
  const flagged = [
    ["path_separator_token", "Открыть C:\\Reports\\file.xlsx"],
    ["path_separator_token", "папка /srv/data готова"],
    ["email_or_handle", "Отправить на ivanov@example.com"],
    ["email_or_handle", "спросить @curator"],
    ["credential_assignment", "password: значение"],
    ["credential_assignment", "token=abc"],
    ["credential_assignment", "пароль: значение"],
    ["credential_assignment", "Введи пароль: x"],
    ["credential_assignment", "ключ: 1234-ABCD"],
    // Owner-approved divergence (2026-11-12): letter/digit lookaround replaces
    // the broken ASCII-\b, Cyrillic keyword alternatives fire after spaces;
    // embedded-word false positives stay blocked (выключатель:, аппароль:).
    ["credential_token", "ключ ABC-12345-XYZ9"],
    ["credential_token", "cccccccc-cccc-4ccc-8ccc-cccccccccccc"],
    ["credential_token", "проверить чат:cccccccc-cccc-4ccc-8ccc-cccccccccccc"],
    ["coordinate_pair", "клик по 55.751, 37.629"],
    ["date_or_old_ref", "отчёт за 2026-11-01"],
    ["date_or_old_ref", "задание #12345"],
    ["date_or_old_ref", "см. задачу"],
    ["date_or_old_ref", "Введи см. документ"],
    ["date_or_old_ref", "смотри задание #12345"],
    ["date_or_old_ref", "третья ревизия"],
    ["approval_or_checked", "проверено владельцем"],
    ["approval_or_checked", "согласована бухгалтерия"],
    ["approval_or_checked", "одобрено куратором"],
    ["approval_or_checked", "принято заказчиком"]
  ];
  for (const [rule, text] of flagged) assert.equal(matchesProhibition(text), rule, text);
});

test("plausible goal and step texts stay unmatched", () => {
  for (const text of [
    "Исходная задача",
    "Проверить источники",
    "Файл проверен",
    "Обработать отчёт за квартал",
    "Отправь сводку до 09:00",
    // The lookaround boundary must not fire inside embedded words.
    "выключатель: проверить",
    "аппароль: x",
    "ID2026-11-01",
    // Inherited bench trailing-\s on см./смотри: a bare sentence-final "См."
    // (the splitter already consumed its space) stays unmatched; the marker
    // still fires mid-sentence ("Введи см. документ", "смотри задачу").
    "См."
  ])
    assert.equal(matchesProhibition(text), null, text);
});

test("goal excerpt stops before the first stale sentence and stays an exact prefix", () => {
  const { excerpt, truncated } = goalExcerpt(
    "Собери сводку. Отправь её на ivanov@example.com. Дождись ответа."
  );
  assert.equal(excerpt, "Собери сводку.");
  assert.equal(truncated, true);
  assert.ok("Собери сводку. Отправь её на ivanov@example.com. Дождись ответа.".startsWith(excerpt));
});

test("clean goals keep the shipped 500-unit cap and well-formed cut", () => {
  const short = goalExcerpt("Обработать отчёт за квартал");
  assert.equal(short.excerpt, "Обработать отчёт за квартал");
  assert.equal(short.truncated, false);
  // 499 clean units then the moon emoji: the cap boundary lands on its high
  // surrogate and the shipped well-formed fix retreats one unit.
  const long = goalExcerpt("слово-слово ".repeat(41) + "слово-с" + "🌙" + "хвост");
  assert.equal(long.excerpt.length, 499);
  assert.equal(long.excerpt.isWellFormed(), true);
  assert.equal(long.truncated, true);
});

test("a goal that begins with a stale sentence is refused, not weakened", () => {
  assert.throws(() => goalExcerpt("Отчёт за 2026-11-01 приложить к письму"), /UNAVAILABLE/);
  assert.throws(() => goalExcerpt("token=abc передать дальше"), /UNAVAILABLE/);
});

test("plan steps with any prohibition fragment are dropped as a whole", () => {
  const plan = [
    { title: "Собрать данные", criteria: "Таблица заполнена" },
    { title: "Открыть файл C:\\Reports\\file.xlsx", criteria: "Файл открыт" },
    { title: "Отправить письмо", criteria: "Адресат @curator получил" },
    { title: "Сверить итоги", criteria: "Расхождений нет" }
  ];
  assert.deepEqual(scrubPlan(plan), [
    { title: "Собрать данные", criteria: "Таблица заполнена" },
    { title: "Сверить итоги", criteria: "Расхождений нет" }
  ]);
});

test("a plan whose every step is stale is refused instead of emptied", () => {
  assert.throws(
    () =>
      scrubPlan([
        { title: "Открыть C:\\данные", criteria: "Готово" },
        { title: "Написать", criteria: "адрес: ivanov@example.com" }
      ]),
    /UNAVAILABLE/
  );
});
