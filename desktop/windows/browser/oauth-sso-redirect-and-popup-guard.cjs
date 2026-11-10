"use strict";

const { KosworkBrowserPolicyError } = require("./policy.cjs");

/**
 * Koswork OAuth 2.0 / OIDC / SAML SSO Redirect & Popup Guard
 * (`desktop/windows/browser/oauth-sso-redirect-and-popup-guard.cjs`).
 *
 * Deepens Requirements #4 & #7:
 * - Detects interactive OAuth 2.0 / OIDC (`/oauth/authorize`, `response_type=code`,
 *   `client_id=`) and SAML 2.0 (`/saml/sso`, `SAMLRequest=`) authentication redirects
 *   and transitions the tab cleanly into `status: "paused_for_user"`
 *   (`code: "BROWSER_PAUSED_FOR_SSO_LOGIN"`) without attempting to bypass authentication.
 * - Blocks open-redirect attacks where `redirect_uri` points to an untrusted external
 *   origin (`OAUTH_OPEN_REDIRECT_BLOCKED`).
 * - Supports explicit user SSO completion handback (`completeUserSsoHandback`) that
 *   resumes the tab on the post-login callback URL and refreshes observation state.
 */

const SSO_PATH_PATTERNS = [
  /\/oauth2?\/authorize/i,
  /\/oidc\/authorize/i,
  /\/saml2?\/(?:sso|login)/i,
  /\/login\/oauth/i
];

class KosworkOAuthSsoPopupAndRedirectGuard {
  constructor({ engine, trustedCallbackOrigins = [] } = {}) {
    this.engine = engine || null;
    this.trustedCallbackOrigins = new Set(
      (trustedCallbackOrigins || []).map((o) => String(o).toLowerCase())
    );
    this.pendingSsoByTab = new Map();
  }

  inspectRedirectOrPopup({
    tabId = "tab-1",
    currentOriginUrl,
    targetUrl,
    isPopupWindow = false
  } = {}) {
    const parsedTarget = new URL(String(targetUrl || ""));
    const currentOrigin = currentOriginUrl
      ? new URL(String(currentOriginUrl)).origin.toLowerCase()
      : parsedTarget.origin.toLowerCase();

    const searchParams = parsedTarget.searchParams;
    const isOAuthOrSaml =
      SSO_PATH_PATTERNS.some((re) => re.test(parsedTarget.pathname)) ||
      (searchParams.has("client_id") && searchParams.has("response_type")) ||
      searchParams.has("SAMLRequest");

    if (!isOAuthOrSaml) {
      return {
        isSsoFlow: false,
        status: "allowed_normal_navigation",
        targetUrl: parsedTarget.toString()
      };
    }

    const redirectUriRaw =
      searchParams.get("redirect_uri") || searchParams.get("RelayState") || "";
    if (redirectUriRaw && /^https?:\/\//i.test(redirectUriRaw)) {
      const callbackOrigin = new URL(redirectUriRaw).origin.toLowerCase();
      const isTrusted =
        callbackOrigin === currentOrigin ||
        this.trustedCallbackOrigins.has(callbackOrigin);

      if (!isTrusted) {
        throw new KosworkBrowserPolicyError(
          "OAUTH_OPEN_REDIRECT_BLOCKED",
          `Заблокирован OAuth/SSO редирект с недоверенным redirect_uri (${callbackOrigin}).`,
          {
            tabId,
            targetUrl: parsedTarget.toString(),
            redirectUri: redirectUriRaw,
            callbackOrigin
          }
        );
      }
    }

    const pauseRecord = {
      tabId: String(tabId),
      isSsoFlow: true,
      isPopupWindow: Boolean(isPopupWindow),
      status: "paused_for_user",
      code: "BROWSER_PAUSED_FOR_SSO_LOGIN",
      ssoProviderOrigin: parsedTarget.origin,
      authorizeUrl: parsedTarget.toString(),
      redirectUri: redirectUriRaw || null,
      pkceChallengeMethod: searchParams.get("code_challenge_method") || null,
      hasStateParam: searchParams.has("state"),
      pausedAt: new Date().toISOString(),
      reason:
        "Обнаружен переход на страницу входа OAuth 2.0 / SAML SSO. Автоматический обход запрещён; ожидание ручного входа пользователя."
    };

    this.pendingSsoByTab.set(String(tabId), pauseRecord);
    return pauseRecord;
  }

  async completeUserSsoHandback({ tabId, postLoginCallbackUrl, signal = null } = {}) {
    const id = String(tabId || "");
    const pending = this.pendingSsoByTab.get(id);
    if (!pending) {
      const err = new Error(`No pending SSO login pause found for tab ${id}`);
      err.code = "NO_PENDING_SSO_PAUSE";
      throw err;
    }

    this.pendingSsoByTab.delete(id);
    if (this.engine && postLoginCallbackUrl) {
      const nav = await this.engine.navigate({
        tabId: id,
        url: postLoginCallbackUrl,
        actor: "user_handback",
        signal
      });
      return {
        status: "resumed_after_user_sso",
        tabId: id,
        postLoginUrl: nav.url,
        pageVersion: nav.pageVersion,
        snapshot: nav.snapshot
      };
    }

    return {
      status: "resumed_after_user_sso",
      tabId: id,
      postLoginUrl: postLoginCallbackUrl || pending.redirectUri
    };
  }
}

module.exports = {
  KosworkOAuthSsoPopupAndRedirectGuard
};
