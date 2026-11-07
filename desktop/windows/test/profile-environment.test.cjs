"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  evaluateProfile,
  isRedirectedDirectory,
  profileStatusText
} = require("../profile-environment.cjs");

test("an ordinary writable profile passes with no faults", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kosmora-profile-ok-"));
  const status = evaluateProfile(dir);
  assert.equal(status.ok, true);
  assert.equal(status.writable, true);
  assert.equal(status.redirected, false);
  assert.equal(status.reason, "");
  assert.equal(fs.existsSync(path.join(dir, `profile-write-probe-${process.pid}`)), false);
});

test("a redirected MSIX-style LocalCache profile is reported, never moved", () => {
  const redirectedPath = path.join(
    "C:",
    "Users",
    "dev",
    "AppData",
    "Local",
    "Packages",
    "Some.Publisher_8wekyb3d8bbwe",
    "LocalCache",
    "Roaming",
    "cosmora-windows-desktop"
  );
  const status = evaluateProfile(redirectedPath);
  // The launch under MSIX puts the profile into LocalCache; evaluation keeps
  // the redirection flag (which surfaces in status text) but it never
  // migrates or relocates data, and a refused directory stays a hard fault.
  assert.equal(isRedirectedDirectory(redirectedPath), true);
  assert.equal(isRedirectedDirectory(redirectedPath.toLowerCase()), true);
  assert.equal(isRedirectedDirectory("C:\\Users\\dev\\AppData\\Roaming\\cosmora"), false);
  assert.equal(status.redirected, true, "evaluation keeps the flag even when mkdir fails");
  // On a writable sandbox profile the explanatory text, not a relocation,
  // accompanies the redirected flag.
  const writable = fs.mkdtempSync(path.join(os.tmpdir(), "kosmora-profile-redirect-"));
  assert.equal(isRedirectedDirectory(writable), false, "ordinary temp dirs are not LocalCache");
  assert.notEqual(status.reason, "");
});

test("an unwritable profile is rejected with an understandable reason", () => {
  // A path that is actually a file can never become a profile directory: the
  // evaluation must turn this into a human-readable verdict, not a crash.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kosmora-profile-file-"));
  const log = path.join(dir, "profile-location.txt");
  fs.writeFileSync(log, "used to verify the guard");
  const status = evaluateProfile(log);
  assert.equal(status.ok, false);
  assert.equal(status.writable, false);
  assert.match(status.reason, /недоступен|нельзя запись|профиля/);
});

test("profile status text lists directory, redirection and faults", () => {
  const text = profileStatusText({
    profileDirectory: "C:\\Profiles\\Kosmora",
    redirected: false,
    ok: false,
    reason: "Каталог профиля приложения недоступен.",
    faults: ["Локальное хранилище Koswork недоступно: VAULT_REFUSED."]
  });
  assert.match(text, /C:\\Profiles\\Kosmora/);
  assert.match(text, /недоступен/);
  assert.match(text, /VAULT_REFUSED/);
  // A redirected-but-working profile stays explanatory and non-blocking.
  const redirected = profileStatusText({
    profileDirectory: "C:\\X",
    redirected: true,
    ok: true,
    reason: ""
  });
  assert.doesNotMatch(redirected, /проблема/i);
  assert.match(redirected, /профиль/i);
});
