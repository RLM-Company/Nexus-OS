"use strict";

/**
 * Koswork Page Security Posture, CSP & Mixed-Content Form Inspector
 * (`desktop/windows/browser/page-security-posture-inspector.cjs`).
 *
 * Deepens Requirement #4:
 * - Inspects an open page's transport security (`https:` vs `http:`), `<meta http-equiv="Content-Security-Policy">`,
 *   Subresource Integrity (`integrity="sha256-..."` / `sha384-...`) on downloadable links/scripts,
 *   and `<form action="http://...">` mixed-content form submission downgrades on HTTPS pages.
 * - Blocks form submission on an HTTPS page if the form's `action` downgrades transport
 *   to plaintext `http://` on a non-loopback host (`MIXED_CONTENT_FORM_ACTION_BLOCKED`).
 */

function inspectPageSecurityPosture({ pageUrl = "", rawHtml = "" } = {}) {
  let parsedPageUrl = null;
  try {
    parsedPageUrl = new URL(String(pageUrl));
  } catch {
    parsedPageUrl = null;
  }

  const isHttpsPage = parsedPageUrl ? parsedPageUrl.protocol === "https:" : false;
  const html = String(rawHtml || "");

  // 1. Extract CSP meta directives if present
  const cspMatch = html.match(
    /<meta\b[^>]+http-equiv=["']Content-Security-Policy["'][^>]+content=["']([^"']+)["']/i
  );
  const cspPolicy = cspMatch ? cspMatch[1].trim() : null;

  // 2. Check `<form action="...">` for HTTPS -> HTTP mixed-content downgrade
  const mixedContentFormActions = [];
  const formRegex = /<form\b([^>]*)>/gi;
  let fm;
  while ((fm = formRegex.exec(html)) !== null) {
    const attrs = fm[1] || "";
    const actMatch = attrs.match(/\baction=["']([^"']+)["']/i);
    if (!actMatch) continue;
    try {
      const resolvedAction = new URL(actMatch[1].trim(), pageUrl);
      const isLoopback =
        resolvedAction.hostname === "127.0.0.1" || resolvedAction.hostname === "localhost";
      if (isHttpsPage && resolvedAction.protocol === "http:" && !isLoopback) {
        mixedContentFormActions.push(resolvedAction.toString());
      }
    } catch {
      // ignore invalid URLs
    }
  }

  // 3. Extract Subresource Integrity (SRI) attributes (`integrity="sha256-..."`)
  const sriProtectedResources = [];
  const sriRegex = /<(a|script|link)\b([^>]*\bintegrity=["']([^"']+)["'][^>]*)>/gi;
  let sm;
  while ((sm = sriRegex.exec(html)) !== null) {
    const tag = sm[1].toLowerCase();
    const attrs = sm[2] || "";
    const integrity = sm[3].trim();
    const refMatch = attrs.match(/\b(?:href|src)=["']([^"']+)["']/i);
    sriProtectedResources.push({
      tag,
      resourceUrl: refMatch ? refMatch[1].trim() : null,
      integrity
    });
  }

  return {
    pageUrl,
    isHttpsPage,
    hasCspMeta: Boolean(cspPolicy),
    cspPolicy,
    safeForFormSubmit: mixedContentFormActions.length === 0,
    mixedContentFormActions,
    sriProtectedCount: sriProtectedResources.length,
    sriProtectedResources
  };
}

module.exports = {
  inspectPageSecurityPosture
};
