import type { Request } from "@playwright/test";

/** Empty legacy-pin bootstrap is independent of the read-only action under test.
 * Keep non-empty imports and every other mutation observable by the caller. */
export function isWorkspaceWrite(request: Request): boolean {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) return false;
  if (
    request.method() === "POST" &&
    new URL(request.url()).pathname === "/api/v1/chat-navigation/import-pins"
  ) {
    const body = request.postDataJSON();
    if (JSON.stringify(body) === JSON.stringify({ chats: [], projects: [] })) return false;
  }
  return true;
}
