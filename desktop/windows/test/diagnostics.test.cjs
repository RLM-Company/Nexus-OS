"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");

const { buildDiagnostics, formatDiagnosticsText } = require("../diagnostics.cjs");

const FIXED_NOW = () => "2026-11-10T10:00:00.000Z";
const fullInput = {
  app: {
    version: "0.26.0",
    electron: "44.5.1",
    node: "26.13.0",
    platform: "win32",
    arch: "x64",
    packaged: true,
    hasSingleInstanceLock: true,
    secureStorage: true
  },
  profile: {
    ok: true,
    writable: true,
    redirected: false,
    profileDirectory: "C:\\Users\\demo\\AppData\\Roaming\\Kosmora",
    reason: ""
  },
  origin: "https://kosmora.example",
  ownerVerified: true,
  identityEpoch: 3,
  downloads: { active: 2 },
  updates: { pinnedKey: true },
  faults: []
};

test("диагностика собирает стабильный текст из известных сечений", () => {
  const first = buildDiagnostics(fullInput, { now: FIXED_NOW });
  const second = buildDiagnostics(fullInput, { now: FIXED_NOW });
  const firstText = formatDiagnosticsText(first);
  assert.equal(firstText, formatDiagnosticsText(second));
  for (const expected of [
    "Kosmora 0.26.0, Electron 44.5.1 — win32 / x64 / Node 26.13.0",
    "упакованная сборка",
    "Подключение: сервер https://kosmora.example; владелец подтверждён; сгенерация идентичности 3.",
    "Каталог профиля: C:\\Users\\demo\\AppData\\Roaming\\Kosmora",
    "запись возможна",
    "активных загрузок 2",
    "закреплённый ключ релизов есть",
    "Проблемы: не зафиксировано.",
    "Отчёт сформирован: 2026-11-10T10:00:00.000Z."
  ])
    assert.ok(firstText.includes(expected), `нет строки: ${expected}`);
});

test("диагностика не включает владельца, секреты, пути загрузок и неизвестные ключи входа", () => {
  // Вход намеренно «испачкан»: чувствительные значения переданы под
  // несуществующими ключами и в непригодном origin — известные сечения
  // принимают только свои форматы и не пропускают лишнее.
  const dirty = buildDiagnostics(
    {
      ...fullInput,
      origin: "https://host.invalid/?access_token=SECRET&id_token=XYZ",
      // Не существует ни одного поля, принимающего эти значения:
      ownerId: "owner-SECRET-123",
      cookie: "cosmora_session=SECRET",
      token: "Bearer SECRET",
      savePath: "C:\\Users\\demo\\Downloads\\contract-final.pdf",
      itemName: "Зарплатная ведомость.xlsx",
      password: "SECRET"
    },
    { now: FIXED_NOW }
  );
  const text = formatDiagnosticsText(dirty);
  for (const forbidden of [
    "SECRET",
    "owner-SECRET-123",
    "cosmora_session",
    "Bearer",
    ".pdf",
    "Ведомость",
    "password"
  ])
    assert.ok(!text.includes(forbidden), `утечка: ${forbidden}`);
  assert.ok(text.includes("Подключение: сервер https://host.invalid"));
});

test("неисправности обрезаются: управляющие символы, длина и количество", () => {
  const noisyFault = "Сбой:\t" + "о".repeat(500) + "\nвторая строка";
  const manyFaults = Array.from({ length: 14 }, (_, i) => `Проблема ${i}`);
  const text = formatDiagnosticsText(
    buildDiagnostics({ faults: [noisyFault, ...manyFaults] }, { now: FIXED_NOW })
  );
  const faultsLine = text.split("\n").find((line) => line.startsWith("Проблемы:"));
  assert.ok(faultsLine);
  const entries = faultsLine.slice("Проблемы: ".length).replace(/\.$/, "").split(" | ");
  assert.equal(entries.length, 8);
  for (const entry of entries) {
    assert.ok(!entry.includes("\n"));
    assert.ok(!entry.includes("\t"));
    assert.ok(entry.length <= 240);
  }
  assert.ok(entries[0].startsWith("Сбой: оо"));
  assert.ok(text.includes("Проблема 6"));
  assert.ok(!text.includes("Проблема 7"));
});

test("кривые входы не ломают отчёт и не выдают выдуманных значений", () => {
  const text = formatDiagnosticsText(
    buildDiagnostics(
      {
        app: null,
        profile: "broken",
        origin: 123,
        ownerVerified: "yes",
        identityEpoch: -4,
        downloads: 5,
        updates: "no",
        faults: 7
      },
      { now: FIXED_NOW }
    )
  );
  assert.ok(text.includes("Подключение: активный сервер не выбран."));
  assert.ok(text.includes("Проблемы: не зафиксировано."));
  assert.ok(text.includes("Каталог профиля: неизвестен"));
});

test("без подтверждённого владельца отчёт говорит это прямо", () => {
  const text = formatDiagnosticsText(
    buildDiagnostics(
      {
        ...fullInput,
        ownerVerified: false,
        profile: {
          ...fullInput.profile,
          ok: false,
          writable: false,
          reason: "Каталог профиля не позволяет запись."
        }
      },
      { now: FIXED_NOW }
    )
  );
  assert.ok(text.includes("Подключение: сервер https://kosmora.example"));
  assert.ok(text.includes("вход не подтверждён в этой сгенерации"));
  assert.ok(text.includes("Каталог профиля не позволяет запись."));
  assert.ok(!text.includes("владелец подтверждён"));
});
