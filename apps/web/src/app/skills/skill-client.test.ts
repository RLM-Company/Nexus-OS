import { expect, it } from "vitest";
import { SkillApiError, writeSkillVersion, type skillApi } from "./skill-client";
import type { Detail } from "./skill-model";
const draft = { name: "Skill", summary: "Summary", instructions: "Text" };
const detail: Detail = {
  skill: { id: "a", name: "Skill", summary: "Summary", current_version: 2, updated_at: "" },
  versions: [{ ...draft, version: 2, created_at: "" }]
};
it.each([undefined, 1])(
  "reconciles an interrupted save/restore with one GET and no repeated mutation (%s)",
  async (source) => {
    const calls: { path: string; method: string; body: unknown }[] = [];
    const request: typeof skillApi = async <T>(
      path: string,
      method = "GET",
      body?: unknown
    ): Promise<T> => {
      await Promise.resolve();
      calls.push({ path, method, body });
      if (method !== "GET") throw Error("lost response");
      return detail as T;
    };
    expect(await writeSkillVersion("a", 1, draft, source, request)).toBe(detail);
    expect(calls.map((call) => call.method)).toEqual([
      source === undefined ? "PUT" : "POST",
      "GET"
    ]);
    expect(calls[0]!.body).toEqual(
      source === undefined
        ? { ...draft, expected_version: 1 }
        : { expected_version: 1, source_version: 1 }
    );
  }
);
it("preserves original failure when the readback differs or fails", async () => {
  const original = Error("network");
  for (const fails of [false, true]) {
    const request: typeof skillApi = async <T>(_path: string, method = "GET"): Promise<T> => {
      await Promise.resolve();
      if (method !== "GET") throw original;
      if (fails) throw Error("offline");
      return { ...detail, skill: { ...detail.skill, current_version: 3 } } as T;
    };
    await expect(writeSkillVersion("a", 1, draft, undefined, request)).rejects.toBe(original);
  }
});
it("does not turn lifecycle, authorization or size errors into success", async () => {
  for (const status of [401, 403, 413, 423]) {
    const calls: string[] = [];
    const error = new SkillApiError(status, "OWNER_DATA_FENCED");
    const request: typeof skillApi = async <T>(_path: string, method = "GET"): Promise<T> => {
      await Promise.resolve();
      calls.push(method);
      throw error;
    };
    await expect(writeSkillVersion("a", 1, draft, undefined, request)).rejects.toBe(error);
    expect(calls).toEqual(["PUT"]);
  }
});
it("successful writes still refuse a newer competing version instead of replacing the local draft", async () => {
  const request: typeof skillApi = async <T>(_path: string, method = "GET"): Promise<T> => {
    await Promise.resolve();
    return (
      method === "GET"
        ? { ...detail, skill: { ...detail.skill, current_version: 3 } }
        : detail.skill
    ) as T;
  };
  await expect(writeSkillVersion("a", 1, draft, undefined, request)).rejects.toMatchObject({
    code: "VERSION_CONFLICT"
  });
});

it("recovers a lost creation response via receipt, without repeating POST or guessing from the list", async () => {
  const { createSkillOnce } = await import("./skill-client");
  const calls: { path: string; method: string; key: string | undefined }[] = [];
  const request: typeof skillApi = async <T>(
    path: string,
    method = "GET",
    _body?: unknown,
    key?: string
  ): Promise<T> => {
    await Promise.resolve();
    calls.push({ path, method, key });
    if (method === "POST") throw Error("lost response");
    return (path.startsWith("/creations/") ? detail.skill : detail) as T;
  };
  expect(await createSkillOnce(draft, "request", "", draft, request)).toBe(detail);
  expect(calls).toEqual([
    { path: "", method: "POST", key: "request" },
    { path: "/creations/request", method: "GET", key: undefined },
    { path: "/a", method: "GET", key: undefined }
  ]);
});
it("receipt checks never write; an explicit retry reuses the original request key", async () => {
  const { createSkillOnce, readSkillCreation } = await import("./skill-client");
  const calls: { method: string; key: string | undefined }[] = [];
  const request: typeof skillApi = async <T>(
    path: string,
    method = "GET",
    _body?: unknown,
    key?: string
  ): Promise<T> => {
    await Promise.resolve();
    calls.push({ method, key });
    return (path === "/a" ? detail : detail.skill) as T;
  };
  await readSkillCreation("original", request);
  expect(calls.map((v) => v.method)).toEqual(["GET", "GET"]);
  await createSkillOnce(draft, "original", "", draft, request);
  expect(calls[2]).toEqual({ method: "POST", key: "original" });
});
it.each([400, 401, 403, 409, 410, 413, 423])(
  "does not mask definitive creation rejection (%s)",
  async (status) => {
    const { createSkillOnce } = await import("./skill-client");
    let calls = 0;
    const original = new SkillApiError(status, "CREATION_DELETED");
    const request: typeof skillApi = async <T>(): Promise<T> => {
      await Promise.resolve();
      calls++;
      throw original;
    };
    await expect(createSkillOnce(draft, "original", "", draft, request)).rejects.toBe(original);
    expect(calls).toBe(1);
  }
);
it("retains an unknown creation error when its receipt cannot be read", async () => {
  const { createSkillOnce } = await import("./skill-client");
  const original = Error("lost response"),
    methods: string[] = [];
  const request: typeof skillApi = async <T>(_path: string, method = "GET"): Promise<T> => {
    await Promise.resolve();
    methods.push(method);
    if (method === "POST") throw original;
    throw new SkillApiError(404, "NOT_FOUND");
  };
  await expect(createSkillOnce(draft, "original", "", draft, request)).rejects.toBe(original);
  expect(methods).toEqual(["POST", "GET"]);
});
