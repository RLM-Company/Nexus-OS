import { describe, expect, it } from "vitest";
import { parseMediaJobListResponse } from "./media-job-response";

const job = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  kind: "image",
  status: "running",
  created_at: "2026-11-11T07:00:00.000Z",
  error_code: null,
  asset: null
};
describe("owner-scoped media history response validation", () => {
  it("accepts owned empty history and normal jobs", () => {
    expect(parseMediaJobListResponse({ items: [] })).toEqual([]);
    const items = [
      job,
      { ...job, kind: "video" },
      { ...job, kind: "sfx" },
      { ...job, kind: "music" }
    ];
    expect(parseMediaJobListResponse({ items })).toEqual(items);
  });

  it("rejects malformed HTTP 200 results rather than treating paid work as absent", () => {
    for (const response of [
      null,
      {},
      { items: null },
      { items: "not an array" },
      { items: [null] },
      { items: [{ ...job, id: "foreign-invalid-id" }] },
      { items: [job, { ...job, kind: "unsupported-kind" }] },
      { items: [{ ...job, status: "hidden" }] },
      { items: [{ ...job, client_request_id: 12 }] }
    ]) {
      expect(() => parseMediaJobListResponse(response)).toThrow();
    }
  });
});
