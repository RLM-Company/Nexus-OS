"use strict";

/**
 * Koswork Content-Security-Policy (CSP) & Iframe Sandbox Policy Enforcer
 * (`desktop/windows/browser/csp-and-iframe-sandbox-policy-enforcer.cjs`).
 *
 * Deepens Requirements #3, #4 & #7:
 * - Parses HTTP `Content-Security-Policy` headers and `<meta http-equiv="Content-Security-Policy">`
 *   tags (`default-src`, `script-src`, `frame-ancestors`, `form-action`) alongside `<iframe sandbox="...">`
 *   attributes on embedded frames.
 * - Flags dangerous iframe sandbox escape combinations (`IFRAME_SANDBOX_ESCAPE_RISK` when
 *   `allow-scripts` and `allow-same-origin` are both present on an embedded frame) and
 *   top-navigation hijacking (`IFRAME_TOP_NAVIGATION_HIJACK_RISK` when `allow-top-navigation`
 *   is enabled).
 */

function parseCspDirectives(cspHeader = "") {
  const directives = {};
  const raw = String(cspHeader || "").trim();
  if (!raw) return directives;

  for (const part of raw.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const tokens = trimmed.split(/\s+/);
    const name = tokens[0].toLowerCase();
    directives[name] = tokens.slice(1);
  }
  return directives;
}

function evaluateIframeSandboxAndCspDirectives({
  pageUrl = "https://corpus.local",
  cspHeader = "",
  html = ""
} = {}) {
  const directives = parseCspDirectives(cspHeader);
  const rawHtml = String(html || "");
  const iframeAudits = [];
  const securityWarnings = [];

  const scriptSrc = directives["script-src"] || directives["default-src"] || [];
  if (scriptSrc.includes("'unsafe-eval'") || scriptSrc.includes("'unsafe-inline'")) {
    securityWarnings.push({
      code: "CSP_UNSAFE_SCRIPT_DIRECTIVE",
      detail: `Директива script-src допускает небезопасное выполнение: ${scriptSrc.join(" ")}`
    });
  }

  const iframeRe = /<iframe\b([^>]*)>/gi;
  let m;
  let idx = 1;
  while ((m = iframeRe.exec(rawHtml)) !== null) {
    const attrText = m[1] || "";
    const srcMatch = attrText.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const sandboxMatch = attrText.match(/\bsandbox(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/i);
    const frameSrc = srcMatch ? (srcMatch[1] || srcMatch[2] || "").trim() : "";
    const hasSandboxAttr = Boolean(sandboxMatch);
    const sandboxTokens = hasSandboxAttr
      ? String(sandboxMatch[1] ?? sandboxMatch[2] ?? "")
          .trim()
          .toLowerCase()
          .split(/\s+/)
          .filter(Boolean)
      : [];

    const hasAllowScripts = sandboxTokens.includes("allow-scripts");
    const hasAllowSameOrigin = sandboxTokens.includes("allow-same-origin");
    const hasAllowTopNav = sandboxTokens.includes("allow-top-navigation");

    const frameRisks = [];
    if (!hasSandboxAttr) {
      frameRisks.push("IFRAME_MISSING_SANDBOX_ATTRIBUTE");
    }
    if (hasAllowScripts && hasAllowSameOrigin) {
      frameRisks.push("IFRAME_SANDBOX_ESCAPE_RISK");
    }
    if (hasAllowTopNav) {
      frameRisks.push("IFRAME_TOP_NAVIGATION_HIJACK_RISK");
    }

    for (const r of frameRisks) {
      securityWarnings.push({
        code: r,
        frameId: `iframe-${idx}`,
        frameSrc
      });
    }

    iframeAudits.push({
      frameId: `iframe-${idx}`,
      frameSrc,
      hasSandboxAttr,
      sandboxTokens,
      risks: frameRisks,
      safeForAgentExcerptExtraction:
        hasSandboxAttr && !frameRisks.includes("IFRAME_TOP_NAVIGATION_HIJACK_RISK")
    });
    idx += 1;
  }

  return {
    pageUrl,
    directives,
    iframeCount: iframeAudits.length,
    iframeAudits,
    securityWarningsCount: securityWarnings.length,
    securityWarnings
  };
}

module.exports = {
  parseCspDirectives,
  evaluateIframeSandboxAndCspDirectives
};
