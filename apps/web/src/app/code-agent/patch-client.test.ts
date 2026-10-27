import { afterEach, describe, expect, it, vi } from "vitest";
import { codePatchRequest } from "./patch-client";
afterEach(() => vi.unstubAllGlobals());
describe("same-origin Code adapter", () => {
  it("encodes project scope and sends a single proposal/import request without following redirects", async () => {
    const request = vi.fn(() => Promise.resolve(Response.json({ id: "run" })));
    vi.stubGlobal("fetch", request);
    await codePatchRequest("owner/project", "/import-diff", {
      diff: "patch",
      base_sha: "a".repeat(40)
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]).toEqual([
      "/api/v1/projects/owner%2Fproject/code-agent/import-diff",
      expect.objectContaining({ method: "POST", redirect: "error" })
    ]);
  });
  it("shows exact refusal path/line and does not retry a corrupt patch", async () => {
    const request = vi.fn(() =>
      Promise.resolve(
        Response.json(
          { error: { code: "PATCH_CONTEXT", diagnostic: { path: "src/a.js", line: 4 } } },
          { status: 400 }
        )
      )
    );
    vi.stubGlobal("fetch", request);
    await expect(codePatchRequest("project", "/run/preview-diff", {})).rejects.toThrow(
      "Файл: src/a.js, строка diff 4."
    );
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("keeps transport uncertainty visible without retrying an import", async () => {
    const request = vi.fn(() => Promise.reject(new TypeError("failed to fetch")));
    vi.stubGlobal("fetch", request);
    await expect(codePatchRequest("project", "/import-diff", {})).rejects.toThrow(
      "Обновите состояние"
    );
    expect(request).toHaveBeenCalledTimes(1);
  });
});
