/* eslint-disable @typescript-eslint/require-await -- Deterministic fixtures implement asynchronous provider interfaces without artificial scheduling. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MediaService } from "../src/media/media-service.js";
import { MediaFileStore } from "../src/media/media-store.js";
import { createMediaPrivacyAdapter } from "../src/media/media-privacy.js";
import type { OwnerMediaBudget } from "../src/media/media-budget.js";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/5d8AAAAASUVORK5CYII=",
  "base64"
);
const directories: string[] = [];
const directory = () => {
  const path = mkdtempSync(join(tmpdir(), "kosmora-durable-"));
  directories.push(path);
  return path;
};
afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});
function ledger() {
  const events: string[] = [];
  const ownerBudget: OwnerMediaBudget = {
    reserve: async ({ ownerId, operationId }) => {
      events.push(`reserve:${ownerId}:${operationId}`);
    },
    reconcile: async ({ operationId, usage }) => {
      events.push(`reconcile:${operationId}:${usage.total_tokens}`);
    },
    uncertain: async ({ operationId, reason }) => {
      events.push(`uncertain:${operationId}:${reason}`);
    }
  };
  return { events, ownerBudget };
}
async function settle(service: MediaService, id: string, owner = "alice") {
  for (let i = 0; i < 150; i++) {
    const job = service.get(id, owner);
    if (!job || ["done", "cancelled", "failed"].includes(job.status)) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("job did not settle");
}
const adapter = {
  generateImage: async () => ({
    bytes: png,
    mime: "image/png" as const,
    extension: "png" as const
  }),
  speak: async () => ({
    bytes: Buffer.from("ID3-example"),
    mime: "audio/mpeg" as const,
    extension: "mp3" as const
  }),
  transcribe: async () => "Распознанный текст"
};
const wav = Buffer.from("RIFFexample");

describe("durable media jobs, ownerBudget, privacy without provider spending", () => {
  it("refuses any provider dispatch without the shared budget", () => {
    let called = false;
    const service = new MediaService({
      directory: directory(),
      adapter: {
        ...adapter,
        generateImage: async () => {
          called = true;
          return adapter.generateImage();
        }
      },
      paidEnabled: true
    });
    expect(service.capabilities().image_generation.reason).toBe("BUDGET_UNAVAILABLE");
    expect(() => service.enqueue("alice", "image", "sample", true)).toThrow("MEDIA_UNAVAILABLE");
    expect(called).toBe(false);
  });
  it("reserves before dispatch; unknown provider usage holds, not silently cleared", async () => {
    const { events, ownerBudget } = ledger();
    const service = new MediaService({
      directory: directory(),
      paidEnabled: true,
      ownerBudget,
      adapter: {
        ...adapter,
        generateImage: async () => {
          events.push("dispatch");
          return adapter.generateImage();
        }
      }
    });
    const job = service.enqueue("alice", "image", "sample", true);
    expect((await settle(service, job.id))?.budget_state).toBe("uncertain");
    expect(events).toEqual([
      `reserve:alice:${job.id}`,
      "dispatch",
      `uncertain:${job.id}:NO_CANONICAL_USAGE`
    ]);
  });
  it("reconciles ONLY provider canonical usage and retains asset checksum", async () => {
    const { events, ownerBudget } = ledger();
    const dir = directory();
    const service = new MediaService({
      directory: dir,
      paidEnabled: true,
      ownerBudget,
      adapter: {
        ...adapter,
        generateImage: async () => ({
          ...(await adapter.generateImage()),
          usage: {
            source: "provider" as const,
            input_tokens: 8,
            output_tokens: 2,
            total_tokens: 10
          }
        })
      }
    });
    const job = service.enqueue("alice", "image", "sample", true);
    expect((await settle(service, job.id))?.budget_state).toBe("reconciled");
    expect(events[1]).toBe(`reconcile:${job.id}:10`);
    expect(service.exportOwner("alice").assets[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
    writeFileSync(join(dir, `${job.id}.png`), Buffer.alloc(png.length));
    expect(service.asset(job.id, "alice")).toBeNull();
  });
  it("cancelled late provider completion never creates a file, but keeps unknown hold", async () => {
    let resolve!: (value: Awaited<ReturnType<typeof adapter.generateImage>>) => void;
    const { events, ownerBudget } = ledger();
    const dir = directory();
    const service = new MediaService({
      directory: dir,
      paidEnabled: true,
      ownerBudget,
      adapter: {
        ...adapter,
        generateImage: async () =>
          new Promise((done) => {
            resolve = done;
          })
      }
    });
    const job = service.enqueue("alice", "image", "moon", true);
    for (let i = 0; i < 30 && service.get(job.id, "alice")?.status !== "running"; i++)
      await new Promise((done) => setTimeout(done, 5));
    expect(service.cancel(job.id, "alice")?.status).toBe("cancelled");
    resolve(await adapter.generateImage());
    await settle(service, job.id);
    expect(service.asset(job.id, "alice")).toBeNull();
    expect(existsSync(join(dir, `${job.id}.png`))).toBe(false);
    expect(events.some((e) => e.includes("DISPATCH_OUTCOME_UNKNOWN"))).toBe(true);
  });
  it("durable transcription history, delete + retry and owner isolation", async () => {
    const { ownerBudget } = ledger();
    const dir = directory();
    const service = new MediaService({ directory: dir, paidEnabled: true, ownerBudget, adapter });
    const job = service.enqueueTranscription("alice", wav, "audio/wav", true);
    expect((await settle(service, job.id))?.transcript).toBe("Распознанный текст");
    expect(service.get(job.id, "bob")).toBeNull();
    expect(service.exportOwner("bob").jobs).toEqual([]);
    expect(new MediaFileStore(dir).get(job.id, "alice")?.transcript).toBe("Распознанный текст");
    expect(await service.delete(job.id, "bob")).toBe(false);
    expect(await service.delete(job.id, "alice")).toBe(true);
    const next = service.enqueueTranscription("alice", wav, "audio/wav", true);
    expect(next.id).not.toBe(job.id);
    expect((await settle(service, next.id))?.status).toBe("done");
  });
  it("owner privacy quiesce fences late completions and never deletes another owner's bytes", async () => {
    let resolve!: (value: Awaited<ReturnType<typeof adapter.generateImage>>) => void;
    let providerReturned = false;
    const { events, ownerBudget } = ledger();
    const dir = directory();
    const service = new MediaService({
      directory: dir,
      paidEnabled: true,
      ownerBudget,
      adapter: {
        ...adapter,
        generateImage: async () =>
          new Promise<Awaited<ReturnType<typeof adapter.generateImage>>>((done) => {
            resolve = done;
          }).then((result) => {
            providerReturned = true;
            return result;
          })
      }
    });
    const bob = service.enqueue("bob", "speech", "hi", true);
    await settle(service, bob.id, "bob");
    const alice = service.enqueue("alice", "image", "moon", true);
    for (let i = 0; i < 30 && service.get(alice.id, "alice")?.status !== "running"; i++)
      await new Promise((done) => setTimeout(done, 5));
    const privacy = createMediaPrivacyAdapter(service);
    await privacy.quiesce("alice");
    expect(providerReturned).toBe(false);
    expect(service.get(alice.id, "alice")).toMatchObject({
      status: "cancelled",
      budget_state: "reserved"
    });
    expect((await privacy.delete("alice")).deleted_jobs).toBe(1);
    resolve(await adapter.generateImage());
    await vi.waitFor(() =>
      expect(events).toContain(`uncertain:${alice.id}:DISPATCH_OUTCOME_UNKNOWN`)
    );
    expect(providerReturned).toBe(true);
    expect(service.get(alice.id, "alice")).toBeNull();
    expect(service.asset(alice.id, "alice")).toBeNull();
    expect(service.asset(bob.id, "bob")?.mime).toBe("audio/mpeg");
    expect(() => service.enqueue("alice", "image", "moon", true)).toThrow("MEDIA_UNAVAILABLE");
  });
  it("restarts failed interrupted jobs and purges abandoned temp/asset files", () => {
    const dir = directory();
    const store = new MediaFileStore(dir);
    const job = store.create("alice", "image");
    const junk = join(dir, `${job.id}.png`);
    writeFileSync(junk, png);
    const tmp = join(dir, `${job.id}.aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.asset-tmp`);
    writeFileSync(tmp, png);
    const recovered = new MediaFileStore(dir);
    expect(recovered.get(job.id, "alice")?.status).toBe("failed");
    expect(recovered.get(job.id, "alice")?.error_code).toBe("INTERRUPTED");
    expect(existsSync(junk)).toBe(false);
    expect(existsSync(tmp)).toBe(false);
    expect(readdirSync(dir)).toContain(`${job.id}.json`);
    expect(readFileSync(join(dir, `${job.id}.json`), "utf8")).toContain("INTERRUPTED");
  });
});
