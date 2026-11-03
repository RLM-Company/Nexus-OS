import type { GoogleDriveConnectStart } from "@cosmora/contracts";
export const DRIVE_PROOF_KEY = "kosmora.drive.connection.v1";
const nonce = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{43}$/.test(v);
export function rememberDriveFlow(
  storage: Pick<Storage, "setItem">,
  start: GoogleDriveConnectStart
): string {
  const url = new URL(start.authorization_url);
  if (
    url.origin !== "https://accounts.google.com" ||
    url.pathname !== "/o/oauth2/v2/auth" ||
    !nonce(start.state) ||
    !nonce(start.proof) ||
    url.searchParams.get("state") !== start.state
  )
    throw Error("DRIVE_INVALID_RESPONSE");
  storage.setItem(DRIVE_PROOF_KEY, JSON.stringify({ state: start.state, proof: start.proof }));
  return url.href;
}
export function consumeDriveFlow(
  storage: Pick<Storage, "getItem" | "removeItem">,
  fragment: string
) {
  const params = new URLSearchParams(fragment.replace(/^#/, ""));
  if (!["drive_state", "drive_code", "drive_error", "drive_result"].some((k) => params.has(k)))
    return null;
  const raw = storage.getItem(DRIVE_PROOF_KEY);
  storage.removeItem(DRIVE_PROOF_KEY);
  if (params.has("drive_result")) throw Error("DRIVE_AUTH_FAILED");
  const value: unknown = raw ? JSON.parse(raw) : null;
  if (
    !value ||
    typeof value !== "object" ||
    !("state" in value) ||
    !("proof" in value) ||
    !nonce(value.state) ||
    !nonce(value.proof) ||
    value.state !== params.get("drive_state") ||
    params.getAll("drive_state").length !== 1 ||
    params.getAll("drive_code").length > 1 ||
    params.getAll("drive_error").length > 1
  )
    throw Error("DRIVE_AUTH_FAILED");
  if (params.get("drive_error") === "denied")
    return { state: value.state, proof: value.proof, denied: true };
  const code = params.get("drive_code");
  if (!code || code.length > 2048) throw Error("DRIVE_AUTH_FAILED");
  return { state: value.state, proof: value.proof, code };
}
