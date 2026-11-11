"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { containsCredentialText } = require("../checkpoint-text.cjs");

test("credential filter flags tokens, passwords, keys and PIN-style codes", () => {
  const flagged = [
    "Bearer abc.def.ghi",
    "authorization: Bearer xyz",
    "password: hunter2",
    "passwd=hunter2",
    "PASSWORD: hunter2",
    "api_key = ABCDEF123",
    "api-key: ABCDEF123",
    "access_token: abc123",
    "access-token = abc123",
    "secret: rot13value",
    "пароль: qwerty123",
    "ПАРОЛЬ qwerty123",
    "код 1234",
    "код:5678",
    "pin = 9012",
    "code—3456",
    "ghp_0123456789abcdef",
    "gho_abcdefgh12345",
    "github_pat_11AAAA0123456789",
    "sk-proj-abcdef012345",
    "-----BEGIN RSA PRIVATE KEY-----",
    "-----BEGIN OPENSSH PRIVATE KEY-----"
  ];
  for (const text of flagged) assert.equal(containsCredentialText(text), true, text);
});

test("plausible goals, labels and counts stay permitted", () => {
  const allowed = [
    "",
    "Обработать отчёт за квартал",
    "шаг 3 из 5",
    "номер заказа 12345",
    "deadline 2026-11-11",
    "версия 1.2.3 собрана",
    "кодировка файла изменена на utf-8",
    "run code review",
    "проверить чат:cccccccc-cccc-4ccc-8ccc-cccccccccccc"
  ];
  for (const text of allowed) assert.equal(containsCredentialText(text), false, text);
});
