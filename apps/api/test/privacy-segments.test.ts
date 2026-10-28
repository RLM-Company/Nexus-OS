import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { loadServerConfig } from "@cosmora/config";
import {
  IdentityStore,
  ProjectStore,
  CanvasArtifactStore,
  openDatabase,
  runMigrations
} from "@cosmora/db";
import { canvasPrivacyAdapter } from "../src/canvas/canvas-privacy.js";
import { buildApp } from "../src/app.js";
import { AccountStore } from "../src/account-settings/account-store.js";
import { BearerSessionIdentityResolver } from "../src/identity.js";
import {
  OwnerPrivacyCoordinator,
  REQUIRED_PRIVACY_STORES,
  type PrivacyAdapter
} from "../src/account-settings/privacy/coordinator.js";
import type { PrivacySegmentPlan } from "../src/account-settings/privacy/segmented-export.js";

const close: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const fn of close.splice(0).reverse()) await fn();
});
const hash = (data: Buffer) => createHash("sha256").update(data).digest("hex");
type FixtureSegmentManifest = {
  plan_digest: string;
  sections: Record<string, { records: { items?: Array<{ id: number; payload: string }> } }>;
  archive_originals: Array<{ path: string; sha256: string }>;
};
const unzip = (archive: Buffer) => {
  const entries = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 30 < archive.length && archive.readUInt32LE(offset) === 0x04034b50) {
    const size = archive.readUInt32LE(offset + 18),
      nameLength = archive.readUInt16LE(offset + 26),
      extra = archive.readUInt16LE(offset + 28);
    const start = offset + 30 + nameLength + extra;
    entries.set(
      archive.subarray(offset + 30, offset + 30 + nameLength).toString(),
      archive.subarray(start, start + size)
    );
    offset = start + size;
  }
  return entries;
};
async function fixture() {
  const db = openDatabase(":memory:");
  close.push(() => {
    db.close();
    return Promise.resolve();
  });
  await runMigrations(db);
  db.sqlite.exec(
    "CREATE TABLE fixture_export_items(id INTEGER PRIMARY KEY,owner TEXT,payload TEXT)"
  );
  for (let id = 0; id < 30; id++)
    db.sqlite
      .prepare("INSERT INTO fixture_export_items VALUES(?,?,?)")
      .run(id, "owner-a", `Запись-${id}:` + "я".repeat(100));
  db.sqlite
    .prepare("INSERT INTO fixture_export_items VALUES(?,?,?)")
    .run(100, "owner-b", "FOREIGN-PRIVATE-CONTENT");
  const identities = new IdentityStore(db.sqlite);
  const tokens = new Map<string, string>();
  for (const owner of ["owner-a", "owner-b"]) {
    identities.registerActor(owner, owner, "owner");
    tokens.set(
      owner,
      identities.issueSession({
        ownerId: owner,
        actorId: owner,
        assurance: "single_factor",
        ttlMs: 60000
      }).token
    );
  }
  const originals = new Map([
    ["owner-a", Buffer.from("private original 🚀\n".repeat(20))],
    ["owner-b", Buffer.from("FOREIGN-BINARY")]
  ]);
  let corrupt = false;
  const adapter: PrivacyAdapter = {
    id: "account-core",
    quiesce: (_owner, epoch) => Promise.resolve({ drained: true, fence_epoch: epoch }),
    export: (owner) => {
      expect(
        db.sqlite
          .prepare("SELECT state FROM kosmora_owner_data_lifecycle WHERE owner_id=?")
          .get(owner)?.state
      ).toBe("quiescing");
      const data = originals.get(owner)!;
      return Promise.resolve({
        records: {
          items: db.sqlite
            .prepare("SELECT id,payload FROM fixture_export_items WHERE owner=? ORDER BY id")
            .all(owner),
          empty: []
        },
        originals: [
          {
            id: "original",
            filename: "файл.txt",
            content_type: "text/plain",
            size_bytes: data.length,
            sha256: hash(data)
          }
        ],
        complete: true
      });
    },
    readBinary: (owner, id) => {
      const data = originals.get(owner)!;
      return Promise.resolve(
        id !== "original"
          ? null
          : {
              stream: Readable.from([corrupt ? Buffer.from("corrupted") : data]),
              original: {
                id,
                filename: "файл.txt",
                content_type: "text/plain",
                size_bytes: data.length,
                sha256: hash(data)
              }
            }
      );
    },
    delete: () => Promise.resolve({ deleted_records: 0 })
  };
  const coordinator = new OwnerPrivacyCoordinator(db.sqlite, {
    required: ["account-core"],
    maxExportBytes: 4096
  });
  coordinator.register(adapter);
  const app = buildApp({
    config: loadServerConfig({ NODE_ENV: "test" }),
    database: db,
    accountStore: new AccountStore(db.sqlite),
    identityStore: identities,
    identityResolver: new BearerSessionIdentityResolver(identities),
    ownerPrivacy: coordinator
  });
  close.push(() => app.close());
  const get = (url: string, owner = "owner-a") =>
    app.inject({ method: "GET", url, headers: { authorization: `Bearer ${tokens.get(owner)}` } });
  return {
    db,
    coordinator,
    adapter,
    app,
    get,
    originals,
    setCorrupt: () => {
      corrupt = true;
    }
  };
}

describe("owner-scoped segmented privacy exports", () => {
  it("reassembles every record and verified original within the actual ZIP limit", async () => {
    const f = await fixture();
    expect((await f.get("/api/v1/personal-settings/export")).statusCode).toBe(413);
    const response = await f.get(
      "/api/v1/personal-settings/export/segments?max_segment_bytes=4096"
    );
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    const plan = response.json<PrivacySegmentPlan>();
    expect(plan.total_records).toBe(30);
    expect(plan.total_originals).toBe(1);
    expect(plan.total_segments).toBeGreaterThan(1);
    const rows: Array<{ id: number; payload: string }> = [];
    const binaries: Buffer[] = [];
    for (const part of plan.segments) {
      const download = await f.get(part.href);
      expect(download.statusCode, download.body).toBe(200);
      expect(download.headers["content-type"]).toBe("application/zip");
      expect(download.rawPayload.length).toBeLessThanOrEqual(4096);
      expect(download.rawPayload.length).toBeLessThanOrEqual(part.archive_bytes_upper_bound);
      expect(download.rawPayload.includes(Buffer.from("FOREIGN"))).toBe(false);
      const entries = unzip(download.rawPayload);
      const manifest = JSON.parse(
        entries.get("segment-manifest.json")!.toString()
      ) as FixtureSegmentManifest;
      expect(manifest.plan_digest).toBe(plan.plan_digest);
      rows.push(...(manifest.sections["account-core"]?.records.items ?? []));
      for (const original of manifest.archive_originals) {
        const data = entries.get(original.path)!;
        expect(hash(data)).toBe(original.sha256);
        binaries.push(data);
      }
    }
    expect(rows.map((row) => row.id).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 30 }, (_, i) => i)
    );
    expect(binaries).toEqual([f.originals.get("owner-a")]);
    expect(f.coordinator.overview("owner-a").lifecycle).toBe("active");
  });
  it("rejects anonymous/foreign/stale plans, missing digests and oversized single records", async () => {
    const f = await fixture();
    const base = "/api/v1/personal-settings/export/segments";
    expect((await f.app.inject({ method: "GET", url: base })).statusCode).toBe(401);
    const plan = (await f.get(`${base}?max_segment_bytes=4096`)).json<PrivacySegmentPlan>();
    expect((await f.get(plan.segments[0]!.href, "owner-b")).statusCode).toBe(409);
    expect((await f.get(`${base}/0?max_segment_bytes=4096`)).statusCode).toBe(400);
    const injectedOwner = await f.get(`${base}?owner_id=owner-b`);
    expect(injectedOwner.statusCode).toBe(200);
    expect(injectedOwner.json<PrivacySegmentPlan>().owner_scope).toBe("owner-a");
    f.db.sqlite.prepare("UPDATE fixture_export_items SET payload='changed' WHERE id=0").run();
    expect((await f.get(plan.segments[0]!.href)).statusCode).toBe(409);
    f.db.sqlite
      .prepare("UPDATE fixture_export_items SET payload=? WHERE id=0")
      .run("x".repeat(5000));
    expect((await f.get(`${base}?max_segment_bytes=4096`)).statusCode).toBe(413);
    f.db.sqlite.prepare("UPDATE fixture_export_items SET payload='small again' WHERE id=0").run();
    // Payload alone fits, but its descriptor, manifest and ZIP framing do not.
    f.originals.set("owner-a", Buffer.alloc(3500));
    expect((await f.get(`${base}?max_segment_bytes=4096`)).statusCode).toBe(413);
    expect(f.coordinator.overview("owner-a").lifecycle).toBe("active");
  });
  it("does not deliver a partial ZIP after original corruption", async () => {
    const f = await fixture();
    const plan = await f.coordinator.exportSegmentedPlan("owner-a", { maxSegmentBytes: 4096 });
    f.setCorrupt();
    const part = plan.segments.find((segment) => segment.original_count)!;
    const response = await f.get(part.href);
    expect(response.statusCode).not.toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(f.coordinator.overview("owner-a").lifecycle).toBe("active");
  });
  it("retains the current mandatory store manifest and does not auto-clear an old fence", async () => {
    const f = await fixture();
    const full = new OwnerPrivacyCoordinator(f.db.sqlite);
    full.register(f.adapter);
    for (const id of ["presentations", "notifications", "owner-skills", "email-change"])
      expect(full.overview("owner-a").missing).toContain(id);
    expect(REQUIRED_PRIVACY_STORES).toHaveLength(13);
    f.db.sqlite
      .prepare(
        "INSERT INTO kosmora_owner_data_lifecycle(owner_id,epoch,state,operation_id,started_at,updated_at) VALUES('old-owner',1,'quiescing','interrupted','now','now')"
      )
      .run();
    expect(new OwnerPrivacyCoordinator(f.db.sqlite).overview("old-owner").lifecycle).toBe(
      "quiescing"
    );
  });
  it("collects a real Canvas history larger than the normal 12 MiB limit without dropping revisions", async () => {
    const f = await fixture();
    const projects = new ProjectStore(f.db.sqlite);
    const project = projects.createProject("Canvas export", "canvas-segmented", "owner-a").project
      .id;
    const store = new CanvasArtifactStore(f.db.sqlite);
    for (let index = 0; index < 26; index++)
      store.create(project, "owner-a", {
        title: `Revision ${index}`,
        format: "text",
        content: String(index) + "x".repeat(500000)
      });
    const coordinator = new OwnerPrivacyCoordinator(f.db.sqlite, {
      required: ["account-core", "canvas"]
    });
    coordinator.register(f.adapter);
    coordinator.register(canvasPrivacyAdapter(store));
    await expect(coordinator.export("owner-a")).rejects.toThrow(
      "CANVAS_PRIVACY_SEGMENTED_EXPORT_REQUIRED"
    );
    const plan = await coordinator.exportSegmentedPlan("owner-a", {
      maxSegmentBytes: 2 * 1024 * 1024
    });
    expect(plan.total_records).toBe(56);
    expect(plan.total_segments).toBeGreaterThan(5);
    expect(plan.segments.reduce((sum, part) => sum + part.record_count, 0)).toBe(56);
    expect(coordinator.overview("owner-a").lifecycle).toBe("active");
  });
  it("waits for every drain before releasing a failed snapshot fence", async () => {
    const f = await fixture();
    const coordinator = new OwnerPrivacyCoordinator(f.db.sqlite, {
      required: ["account-core", "held", "broken"]
    });
    let observed!: () => void,
      release!: () => void,
      drained = false;
    const entered = new Promise<void>((done) => {
      observed = done;
    });
    const gate = new Promise<void>((done) => {
      release = done;
    });
    coordinator.register(f.adapter);
    coordinator.register({
      ...f.adapter,
      id: "held",
      quiesce: async (_owner, epoch) => {
        observed();
        await gate;
        drained = true;
        return { drained: true, fence_epoch: epoch };
      },
      resume: () => {
        expect(drained).toBe(true);
      }
    });
    coordinator.register({
      ...f.adapter,
      id: "broken",
      quiesce: () => Promise.reject(new Error("fixture drain failed"))
    });
    const exporting = coordinator.exportSegmentedPlan("owner-a");
    void exporting.catch(() => undefined);
    await entered;
    try {
      await Promise.resolve();
      expect(coordinator.overview("owner-a").lifecycle).toBe("quiescing");
      await expect(coordinator.exportSegmentedPlan("owner-a")).rejects.toThrow();
      expect(coordinator.overview("owner-a").lifecycle).toBe("quiescing");
    } finally {
      release();
    }
    await expect(exporting).rejects.toThrow("fixture drain failed");
    expect(coordinator.overview("owner-a").lifecycle).toBe("active");
  });
});
