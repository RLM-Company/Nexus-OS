"use strict";

// Store *only* minimal first-party UI state; never persist arbitrary query params.
const ID = "[a-f0-9-]{8,64}";
const VALID_ID = new RegExp(`^${ID}$`, "i");
const VIEWS = new Set(["chat", "plan", "project", "context"]);
const SURFACES = new Set(["manager", "code", "work", "studio", "files", "skills", "images", "video", "sound", "multi-agent", "apps", "features", "settings"]);

function safeWorkspaceRoute(raw) {
  if (typeof raw !== "string" || raw.length > 260 || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("#") || raw.includes("\\")) return null;
  try {
    const u = new URL(raw, "https://kosmora.invalid");
    if (u.origin !== "https://kosmora.invalid") return null;
    if (raw.split("?")[0].includes("%") || /\.\./.test(raw.split("?")[0])) return null;
    const path = u.pathname;
    const staticPaths = new Set(["/", "/github", "/github/preview", "/control-center", "/agent-studio", "/model-status", "/skills"]);
    if (!staticPaths.has(path)) return null;
    if (!u.search) return path;
    const keys = [...u.searchParams.keys()];
    if (new Set(keys).size !== keys.length) return null;
    const allowed = path === "/" ? new Set(["project", "chat", "view", "surface"]) :
      path === "/control-center" || path === "/agent-studio" ? new Set(["project"]) : new Set();
    if (!keys.every((k) => allowed.has(k))) return null;
    const project = u.searchParams.get("project");
    const chat = u.searchParams.get("chat");
    const view = u.searchParams.get("view");
    const surface = u.searchParams.get("surface");
    if (project !== null && !VALID_ID.test(project)) return null;
    if (chat !== null && !VALID_ID.test(chat)) return null;
    if (project && chat || view && (!project || !VIEWS.has(view)) || surface && (path !== "/" || !SURFACES.has(surface))) return null;
    const query = new URLSearchParams();
    for (const k of ["project", "chat", "view", "surface"]) if (u.searchParams.has(k)) query.set(k, u.searchParams.get(k));
    const suffix = query.toString();
    return path + (suffix ? "?" + suffix : "");
  } catch { return null; }
}

function isLoginOrLogout(raw, origin) {
  try {
    const u = new URL(raw);
    return u.origin === origin && (/^\/(?:login|logout|signin|signout)\/?$/.test(u.pathname));
  } catch { return false; }
}

module.exports = { safeWorkspaceRoute, isLoginOrLogout };
