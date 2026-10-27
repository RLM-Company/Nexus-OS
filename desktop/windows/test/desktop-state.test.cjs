"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  cleanRoute,
  createPreferenceStore,
  deepLinkRoute,
  deepLinkFromArgv,
  restoredBounds,
  validatePreferences
} = require("../desktop-state.cjs");

test("strict deep links only select explicit Kosmora UI routes", () => {
  assert.equal(deepLinkRoute("kosmora://open?path=%2Fgithub"), "/github");
  assert.equal(deepLinkRoute("kosmora://open?path=%2Fcode-agent"), "/code-agent");
  assert.equal(deepLinkRoute("kosmora://open?path=%2F"), "/");
  assert.equal(
    deepLinkFromArgv(["Kosmora.exe", "kosmora://open?path=%2Fagent-studio"]),
    "/agent-studio"
  );
  for (const invalid of [
    "kosmora://evil?path=%2Fgithub",
    "kosmora://open?path=https%3A%2F%2Fevil.tld",
    "kosmora://open?path=%2F%252e%252e%2F",
    "kosmora://open?path=%2Flogin",
    "kosmora://open?path=%2Fgithub%3Ftoken%3Da",
    "kosmora://open?path=%2Fgithub&token=secret",
    "kosmora://open?path=%2Fgithub#h",
    "http://kosmora.example/github",
    "kosmora://open?path=%2F%2Fevil",
    "kosmora://open?path=%2Fgithub%5C.."
  ])
    assert.equal(deepLinkRoute(invalid), null, invalid);
  assert.equal(cleanRoute("/github/preview"), "/github/preview");
  assert.equal(cleanRoute("/logout"), null);
});

test("desktop preferences are schema-filtered and written across a restart", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kosmora-prefs-"));
  try {
    const store = createPreferenceStore(dir);
    assert.equal(store.get().trayEnabled, false);
    store.update({
      restorePage: false,
      trayEnabled: true,
      lastPath: "/github",
      downloadDirectory: path.join(dir, "files"),
      token: "should-not-be-stored"
    });
    const restored = createPreferenceStore(dir).get();
    assert.equal(restored.restorePage, false);
    assert.equal(restored.trayEnabled, true);
    assert.equal(restored.lastPath, "/github");
    assert.equal(restored.downloadDirectory, path.join(dir, "files"));
    assert.equal(
      fs.readFileSync(path.join(dir, "desktop-preferences.json"), "utf8").includes("token"),
      false
    );
    assert.equal(
      validatePreferences({
        bounds: { x: 1, y: 2, width: 100, height: 100 },
        lastPath: "/login?token=secret",
        notifyUpdates: "yes"
      }).lastPath,
      "/"
    );
    assert.equal(validatePreferences({ notifyUpdates: "yes" }).notifyUpdates, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("window bounds restore only on a visible monitor and are clamped to the work area", () => {
  const displays = [{ workArea: { x: 0, y: 0, width: 1600, height: 900 } }];
  assert.deepEqual(restoredBounds({ x: 1350, y: 700, width: 1200, height: 900 }, displays), {
    x: 400,
    y: 0,
    width: 1200,
    height: 900
  });
  assert.equal(restoredBounds({ x: 9000, y: 9000, width: 1200, height: 900 }, displays), null);
  assert.equal(restoredBounds({ x: 0, y: 0, width: -1, height: 900 }, displays), null);
});
