"use strict";
const { createHash } = require("node:crypto");
function safeUrl(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 4096 ||
    /[\u0000-\u0020\u007f]/u.test(value)
  )
    return null;
  try {
    const u = new URL(value);
    return ["https:", "http:"].includes(u.protocol) && !u.username && !u.password ? u.href : null;
  } catch {
    return null;
  }
}
function address(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 2000)
    throw Error("BROWSER_URL_INVALID");
  value = value.trim();
  const direct = safeUrl(value);
  if (direct) return direct;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) throw Error("BROWSER_URL_INVALID");
  if (!/\s/u.test(value) && /^(?:localhost|[\w-]+(?:\.[\w-]+)+)(?::\d+)?(?:\/|$)/u.test(value))
    return safeUrl("https://" + value);
  return "https://duckduckgo.com/?q=" + encodeURIComponent(value);
}
function profileKey(context) {
  if (
    !context ||
    typeof context.owner !== "string" ||
    !context.owner ||
    context.owner.length > 160 ||
    !safeUrl(context.origin) ||
    new URL(context.origin).origin !== context.origin
  )
    throw Error("COMPUTER_OWNER_UNVERIFIED");
  return createHash("sha256")
    .update(context.origin + "\0" + context.owner)
    .digest("hex");
}
function createTaskGate() {
  let occupied = false;
  return {
    claim() {
      if (occupied) throw Error("COMPUTER_BUSY");
      occupied = true;
      let live = true;
      return () => {
        if (live) {
          live = false;
          occupied = false;
        }
      };
    },
    get busy() {
      return occupied;
    }
  };
}
function agentUrl(value) {
  if (value === "about:blank") return value;
  try {
    const u = new URL(value);
    u.hash = "";
    for (const key of [...u.searchParams.keys()])
      if (
        /(?:token|password|secret|credential|signature|api[_-]?key|^(?:code|state|sig|auth|session)$)/i.test(
          key
        )
      )
        u.searchParams.set(key, "[redacted]");
    return u.href;
  } catch {
    return "";
  }
}
module.exports = { safeUrl, address, profileKey, createTaskGate, agentUrl };
