/* eslint-disable @typescript-eslint/require-await -- Deterministic fixtures implement asynchronous provider interfaces without artificial scheduling. */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MediaService } from "../src/media/media-service.js";
import { MediaFileStore } from "../src/media/media-store.js";
import type { OwnerMediaBudget } from "../src/media/media-budget.js";
import { OpenAIMediaAdapter, MediaCapabilityRegistry } from "@cosmora/model-gateway";

const tempDirectories: string[] = [];
const temp = () => {
  const path = mkdtempSync(join(tmpdir(), "kosmora-media-test-"));
  tempDirectories.push(path);
  return path;
};
afterEach(() => {
  for (const directory of tempDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
const tick = async (service: MediaService, id: string, owner = "owner") => {
  for (let i = 0; i < 50; i++) {
    const job = service.get(id, owner);
    if (job && ["done", "failed", "cancelled"].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Job did not settle");
};
const fakeBudget = (): OwnerMediaBudget => ({
  reserve: async () => {},
  reconcile: async () => {},
  uncertain: async () => {}
});
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/5d8AAAAASUVORK5CYII=",
  "base64"
);

describe("media gateway without paid network", () => {
  it("never substitutes a fake asset when no credentials are configured", () => {
    const service = new MediaService({ directory: temp(), paidEnabled: true });
    expect(service.capabilities().image_generation).toMatchObject({
      ready: false,
      reason: "CREDENTIAL_UNAVAILABLE"
    });
    expect(() => service.enqueue("owner", "image", "test", true)).toThrow("MEDIA_UNAVAILABLE");
  });
  it("rejects absent explicit consent and disabled registry capabilities", () => {
    const service = new MediaService({
      directory: temp(),
      adapter: {
        generateImage: async () => ({ bytes: png, mime: "image/png", extension: "png" }),
        speak: async () => {
          throw Error();
        },
        transcribe: async () => ""
      },
      paidEnabled: true,
      ownerBudget: fakeBudget(),
      registry: new MediaCapabilityRegistry(["image_generation"])
    });
    expect(() => service.enqueue("owner", "image", "test", false)).toThrow("CONSENT_REQUIRED");
    expect(service.capabilities().speech.ready).toBe(false);
  });
  it("stores genuine fixture bytes and preserves owner boundary across restart", async () => {
    const directory = temp();
    const service = new MediaService({
      directory,
      paidEnabled: true,
      ownerBudget: fakeBudget(),
      adapter: {
        generateImage: async () => ({ bytes: png, mime: "image/png", extension: "png" }),
        speak: async () => {
          throw Error();
        },
        transcribe: async () => ""
      }
    });
    const job = service.enqueue("ownerA", "image", "a moon", true);
    expect((await tick(service, job.id, "ownerA")).status).toBe("done");
    expect(service.get(job.id, "ownerB")).toBeNull();
    expect(service.asset(job.id, "ownerB")).toBeNull();
    expect(new MediaFileStore(directory).get(job.id, "ownerA")?.status).toBe("done");
    expect(readFileSync(join(directory, `${job.id}.png`))).toEqual(png);
  });
  it("cancels running work and never stores a late binary", async () => {
    const directory = temp();
    let finish:
      ((bytes: { bytes: Uint8Array; mime: "image/png"; extension: "png" }) => void) | undefined;
    const service = new MediaService({
      directory,
      paidEnabled: true,
      ownerBudget: fakeBudget(),
      adapter: {
        generateImage: async () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
        speak: async () => {
          throw Error();
        },
        transcribe: async () => ""
      }
    });
    const job = service.enqueue("owner", "image", "x", true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(service.cancel(job.id, "owner")?.status).toBe("cancelled");
    finish?.({ bytes: png, mime: "image/png", extension: "png" });
    expect((await tick(service, job.id)).status).toBe("cancelled");
    expect(service.asset(job.id, "owner")).toBeNull();
  });
  it("marks abandoned queued/running jobs interrupted on restart", () => {
    const dir = temp();
    const store = new MediaFileStore(dir);
    const job = store.create("owner", "image");
    expect(new MediaFileStore(dir).get(job.id, "owner")).toMatchObject({
      status: "failed",
      error_code: "INTERRUPTED"
    });
  });
  it("never follows remote redirects or returns prompt text as an image", async () => {
    const calls: string[] = [];
    const adapter = new OpenAIMediaAdapter("fixture-only", async (url, options) => {
      const destination = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
      calls.push(`${destination} ${options?.redirect ?? ""}`);
      return new Response(JSON.stringify({ data: [{ revised_prompt: "not an asset" }] }), {
        status: 200
      });
    });
    await expect(
      adapter.generateImage("prompt", "gpt-image-1", new AbortController().signal)
    ).rejects.toMatchObject({ code: "INVALID_ASSET" });
    expect(calls).toEqual(["https://api.openai.com/v1/images/generations error"]);
  });
  it("enforces process stop and audio magic-byte checks", async () => {
    let stopped = true;
    const service = new MediaService({
      directory: temp(),
      paidEnabled: true,
      ownerBudget: fakeBudget(),
      emergencyStopped: () => stopped,
      adapter: {
        generateImage: async () => ({ bytes: png, mime: "image/png", extension: "png" }),
        speak: async () => {
          throw Error();
        },
        transcribe: async () => "speech fixture"
      }
    });
    expect(service.capabilities().image_generation.reason).toBe("EMERGENCY_STOP");
    stopped = false;
    expect(() =>
      service.enqueueTranscription("owner", Buffer.from("wrong"), "audio/webm", true)
    ).toThrow("AUDIO_FORMAT_INVALID");
  });
});
