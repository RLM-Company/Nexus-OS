"use strict";
const fs = require("node:fs"),
  path = require("node:path");
const { writeAtomicJson } = require("../desktop-state.cjs");
const { profileKey } = require("./policy.cjs");
function createBrowserProfiles({ userData, session }) {
  const root = path.resolve(userData, "koswork-browser-profiles"),
    marker = path.join(userData, "koswork-browser-clear.json");
  let barrier = Promise.resolve();
  function folder(key) {
    if (!/^[a-f0-9]{64}$/.test(key)) throw Error("BROWSER_PROFILE_UNAVAILABLE");
    fs.mkdirSync(root, { recursive: true });
    for (const dir of [root, path.join(root, key)]) {
      try {
        const s = fs.lstatSync(dir);
        if (!s.isDirectory() || s.isSymbolicLink()) throw Error("BROWSER_PROFILE_UNAVAILABLE");
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
        fs.mkdirSync(dir, { mode: 0o700 });
      }
    }
    return path.join(root, key);
  }
  function keys() {
    try {
      const stat = fs.lstatSync(root);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error("BROWSER_PROFILE_UNAVAILABLE");
      const list = fs.readdirSync(root).filter((k) => /^[a-f0-9]{64}$/.test(k));
      if (list.length > 128) throw Error("BROWSER_PROFILE_UNAVAILABLE");
      return list;
    } catch (e) {
      if (e.code === "ENOENT") return [];
      throw e;
    }
  }
  async function drain() {
    let pending;
    try {
      const s = fs.lstatSync(marker);
      if (!s.isFile() || s.isSymbolicLink() || s.size > 20000)
        throw Error("BROWSER_PROFILE_UNAVAILABLE");
      pending = JSON.parse(fs.readFileSync(marker, "utf8"));
    } catch (e) {
      if (e.code === "ENOENT") return;
      throw e;
    }
    if (
      !Array.isArray(pending) ||
      pending.length > 128 ||
      pending.some((k) => typeof k !== "string" || !/^[a-f0-9]{64}$/.test(k))
    )
      throw Error("BROWSER_PROFILE_UNAVAILABLE");
    for (const key of pending) {
      const s = session.fromPath(folder(key));
      await s.clearStorageData();
      await s.clearCache();
      await s.clearAuthCache?.();
    }
    fs.unlinkSync(marker);
  }
  return {
    async get(context) {
      await barrier;
      await drain();
      const key = profileKey(context),
        existing = keys();
      if (!existing.includes(key) && existing.length >= 128)
        throw Error("BROWSER_PROFILE_UNAVAILABLE");
      return session.fromPath(folder(key));
    },
    clear() {
      writeAtomicJson(marker, keys());
      barrier = barrier.catch(() => {}).then(drain);
      return barrier;
    }
  };
}
module.exports = { createBrowserProfiles };
