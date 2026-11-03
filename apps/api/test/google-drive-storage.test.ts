import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  GoogleDriveArchiveTransport,
  DRIVE_ARCHIVE_MAX_BYTES
} from "../src/cloud-storage/google-drive.js";

const bytes = Buffer.from("PK synthetic archive fixture");
const digest = createHash("sha256").update(bytes).digest("hex");
const binding = createHash("sha256").update("owner-a").digest("hex");
const receipt = {
  fileId: "archive_123",
  folderId: "folder_123",
  operationId: "op-1",
  bytes: bytes.length,
  sha256: digest
};
const metadata = () => ({
  id: receipt.fileId,
  parents: [receipt.folderId],
  size: String(bytes.length),
  mimeType: "application/zip",
  trashed: false,
  appProperties: {
    format: "kosmora-archive-v1",
    owner: binding,
    operation: receipt.operationId,
    sha256: digest
  }
});
const folder = () => ({
  id: receipt.folderId,
  mimeType: "application/vnd.google-apps.folder",
  trashed: false,
  appProperties: { format: "kosmora-archive-v1", owner: binding }
});
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const urlOf = (input: Parameters<typeof fetch>[0]) =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
const make = (request: typeof fetch) =>
  new GoogleDriveArchiveTransport("owner-a", () => Promise.resolve("fixture-token"), request);

describe("scoped Drive archive transport", () => {
  it("reconciles a preallocated folder ID without creating another folder", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(json(folder()));
    expect(await make(request).inspectFolder(receipt.folderId)).toBe("verified_metadata");
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]![1]?.method).toBeUndefined();
  });

  it.each([409, 429, 503])("does not retry an uncertain write after HTTP %s", async (status) => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("provider private error", { status }));
    await expect(make(request).createFolder(receipt.folderId)).rejects.toMatchObject({
      uncertain: true
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("does not treat an invalid success response as a confirmed upload", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(folder()))
      .mockResolvedValueOnce(json({ id: "other_123" }));
    await expect(
      make(request).uploadArchive({ ...receipt, name: "chat.zip" }, bytes)
    ).rejects.toMatchObject({ code: "DRIVE_INVALID_RESPONSE", uncertain: true });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does not turn receipt mutation during download into a request for another file", async () => {
    const input = { ...receipt };
    const request = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(() => {
        input.fileId = "other_123";
        return Promise.resolve(json(metadata()));
      })
      .mockResolvedValueOnce(new Response(new Uint8Array(bytes)));
    expect(await make(request).downloadArchive(input)).toEqual(bytes);
    expect(urlOf(request.mock.calls[1]![0])).toContain("/archive_123?alt=media");
  });

  it("bounds metadata responses", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(" ".repeat(100001)));
    await expect(make(request).inspectArchive(receipt)).rejects.toMatchObject({
      code: "DRIVE_INVALID_RESPONSE"
    });
  });
  it("allocates an ID before creating a folder and never creates sharing permissions", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ ids: ["folder_123"] }))
      .mockResolvedValueOnce(json({ id: "folder_123" }));
    const drive = make(request);
    const fileId = await drive.generateId();
    await drive.createFolder(fileId);
    expect(request).toHaveBeenCalledTimes(2);
    expect(urlOf(request.mock.calls[0]![0])).toContain("/files/generateIds?");
    const init = request.mock.calls[1]![1]!;
    expect(JSON.parse(init.body as string)).toMatchObject({
      id: fileId,
      name: "Kosmora",
      appProperties: { owner: binding }
    });
    expect(init.redirect).toBe("error");
    expect(
      request.mock.calls.every(([url]) => urlOf(url).startsWith("https://www.googleapis.com/"))
    ).toBe(true);
  });

  it("verifies the app folder and uploads a bounded immutable copy with preallocated ID", async () => {
    const payload = Buffer.from(bytes);
    const input = { ...receipt, name: "chat.zip" };
    const request = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(() => {
        payload.fill(0);
        input.fileId = "changed_123";
        return Promise.resolve(json(folder()));
      })
      .mockResolvedValueOnce(json({ id: receipt.fileId }));
    expect(await make(request).uploadArchive(input, payload)).toEqual(receipt);
    const body = Buffer.from(request.mock.calls[1]![1]!.body as Uint8Array);
    expect(body.includes(bytes)).toBe(true);
    expect(body.toString()).toContain(receipt.sha256);
    expect(body.toString()).toContain('"id":"archive_123"');
  });

  it.each(["owner", "mime", "trashed"])(
    "rejects an unexpected folder (%s) before a write",
    async (change) => {
      const f = folder();
      if (change === "owner") f.appProperties.owner = "other-owner";
      if (change === "mime") f.mimeType = "text/plain";
      if (change === "trashed") f.trashed = true;
      const request = vi.fn<typeof fetch>().mockResolvedValue(json(f));
      await expect(
        make(request).uploadArchive({ ...receipt, name: "chat.zip" }, bytes)
      ).rejects.toMatchObject({ code: "DRIVE_FOLDER_CHANGED" });
      expect(request).toHaveBeenCalledTimes(1);
    }
  );

  it("does not retry or claim failure is certain after an interrupted write", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(folder()))
      .mockRejectedValueOnce(new Error("private provider body fixture-token"));
    await expect(
      make(request).uploadArchive({ ...receipt, name: "chat.zip" }, bytes)
    ).rejects.toMatchObject({
      code: "DRIVE_TRANSPORT_FAILED",
      uncertain: true,
      message: "DRIVE_TRANSPORT_FAILED"
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("treats 404 reconciliation as unavailable, not proof that a timed-out upload never happened", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("private body", { status: 404 }));
    expect(await make(request).inspectArchive(receipt)).toBe("unavailable");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each(["owner", "folder", "digest", "size"])(
    "refuses changed archive metadata (%s) without reading its body",
    async (change) => {
      const m = metadata();
      if (change === "owner") m.appProperties.owner = "other";
      if (change === "folder") m.parents = ["other_folder"];
      if (change === "digest") m.appProperties.sha256 = "0".repeat(64);
      if (change === "size") m.size = "2";
      const request = vi.fn<typeof fetch>().mockResolvedValue(json(m));
      await expect(make(request).downloadArchive(receipt)).rejects.toMatchObject({
        code: "DRIVE_ARCHIVE_CHANGED"
      });
      expect(request).toHaveBeenCalledTimes(1);
    }
  );

  it("checks actual downloaded bytes, not only mutable Drive metadata", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(metadata()))
      .mockResolvedValueOnce(new Response(new Uint8Array(bytes)));
    expect(await make(request).downloadArchive(receipt)).toEqual(bytes);
    const bad = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(metadata()))
      .mockResolvedValueOnce(new Response(new Uint8Array(bytes.length).fill(1)));
    await expect(make(bad).downloadArchive(receipt)).rejects.toMatchObject({
      code: "DRIVE_ARCHIVE_CHANGED"
    });
  });

  it("bounds media even when Content-Length lies", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(metadata()))
      .mockResolvedValueOnce(
        new Response(new Uint8Array(bytes.length + 1), { headers: { "Content-Length": "1" } })
      );
    await expect(make(request).downloadArchive(receipt)).rejects.toMatchObject({
      code: "DRIVE_DOWNLOAD_FAILED"
    });
  });

  it("rejects invalid IDs and oversized data before obtaining credentials", async () => {
    const request = vi.fn<typeof fetch>();
    await expect(
      make(request).uploadArchive({ ...receipt, name: "chat.zip", fileId: "../token" }, bytes)
    ).rejects.toMatchObject({ code: "INVALID_DRIVE_ID" });
    await expect(
      make(request).uploadArchive(
        { ...receipt, name: "chat.zip" },
        new Uint8Array(DRIVE_ARCHIVE_MAX_BYTES + 1)
      )
    ).rejects.toMatchObject({ code: "INVALID_DRIVE_ARCHIVE" });
    expect(request).not.toHaveBeenCalled();
  });

  it("does not expose errors from token refresh", async () => {
    const request = vi.fn<typeof fetch>();
    const drive = new GoogleDriveArchiveTransport(
      "owner-a",
      () => Promise.reject(new Error("refresh-secret")),
      request
    );
    await expect(drive.generateId()).rejects.toMatchObject({
      code: "DRIVE_AUTH_REQUIRED",
      message: "DRIVE_AUTH_REQUIRED"
    });
    expect(request).not.toHaveBeenCalled();
  });
});
