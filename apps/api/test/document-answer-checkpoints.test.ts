import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { loadServerConfig } from "@cosmora/config";
import { ChatService } from "@cosmora/core";
import {
  openDatabase,
  runMigrations,
  ProjectStore,
  DocumentLibraryStore,
  DocumentAnswerStore
} from "@cosmora/db";
import { buildApp } from "../src/app.js";
import {
  DocumentAnswerService,
  type DocumentAnswerTransport
} from "../src/document-answer-service.js";

function pdf(texts: string[]) {
  const count = texts.length;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Count ${count} /Kids [${texts.map((_, i) => `${i * 2 + 4} 0 R`).join(" ")}] >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  for (const text of texts) {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${objects.length + 2} 0 R >>`
    );
    const stream =
      "BT /F1 10 Tf 42 740 Td " +
      text
        .split("\n")
        .map((line) => `(${line}) Tj 0 -14 Td`)
        .join(" ") +
      " ET";
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  let data = "%PDF-1.4\n";
  const offsets = [0];
  for (const [i, object] of objects.entries()) {
    offsets.push(data.length);
    data += `${i + 1} 0 obj\n${object}\nendobj\n`;
  }
  return Buffer.from(
    data +
      `xref\n0 ${offsets.length}\n0000000000 65535 f \n` +
      offsets
        .slice(1)
        .map((n) => String(n).padStart(10, "0") + " 00000 n \n")
        .join("") +
      `trailer\n<< /Root 1 0 R /Size ${offsets.length} >>\nstartxref\n${data.length}\n%%EOF\n`
  );
}

const route = {
  attempt: 0,
  registry_version: "fixture",
  provider_id: "fixture",
  model_id: "fixture",
  estimated_input_tokens: 200,
  max_output_tokens: 300,
  estimated_cost: null
};

it("continues a multi-format package after restart and exports the exact retained batches", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "nexus-answer-batches-"));
  const dbPath = join(tmp, "fixture.db");
  const owner = "local-owner";
  let db = openDatabase(dbPath);
  let connection = true;
  let app: ReturnType<typeof buildApp> | undefined;
  let firstPass = true;
  let readers = 0;
  let inFlight = 0;
  let peak = 0;
  let releasePaused: (() => void) | undefined;
  const gateway: DocumentAnswerTransport = {
    assertRoute: () => undefined,
    async *stream(request) {
      const system = request.messages[0]!.content;
      const input = request.messages[1]!.content;
      yield { type: "route.selected", route };
      const reading = system.includes("Разбери только эту часть");
      let delta: string;
      if (reading) {
        readers++;
        inFlight++;
        peak = Math.max(peak, inFlight);
        if (input.includes("Проверка паузы") && input.includes("Line a-1 item")) {
          await new Promise<void>((resolve) => {
            releasePaused = resolve;
          });
        } else await new Promise<void>((resolve) => setImmediate(resolve));
        inFlight--;
        const hit = /\[(S\d+)\] [^\n]+\n([^\n]+)/u.exec(input)!;
        delta =
          firstPass && input.includes("FAIL_BATCH_ONLY")
            ? "«несуществующий текст» [S999999]"
            : `«${hit[2]!.slice(0, 75)}» [${hit[1]}]`;
      } else {
        delta = /«[^»]+» \[S\d+\]/u.exec(input)![0];
      }
      yield { type: "text.delta", delta };
      yield {
        type: "response.completed",
        usage: { inputTokens: 40, outputTokens: 5 },
        provider: "fixture",
        model: "fixture",
        finishReason: "stop",
        route,
        calculatedCost: null
      };
    }
  };
  function build() {
    const library = new DocumentLibraryStore(db.sqlite);
    const store = new DocumentAnswerStore(db.sqlite);
    app = buildApp({
      config: loadServerConfig({ NODE_ENV: "test" }),
      database: db,
      projectStore: new ProjectStore(db.sqlite),
      documentLibrary: library,
      documentAnswerService: new DocumentAnswerService(
        library,
        store,
        gateway,
        new ChatService({
          preferredProvider: "fixture",
          preferredModelAlias: "fixture",
          fallbackAllowed: false
        }),
        { reserve: () => true, reconcile: () => undefined, uncertain: () => undefined }
      )
    });
    return app;
  }
  try {
    await runMigrations(db);
    const project = new ProjectStore(db.sqlite).createProject("Package", "source-pack", owner)
      .project.id;
    const base = `/api/v1/projects/${project}/document-library`;
    const original = build();
    const fileIds: string[] = [];
    let size = 0;
    for (const part of ["a", "b", "c", "d"]) {
      const texts = Array.from({ length: 128 }, (_, index) =>
        [
          `Line ${part}-${index + 1} item 00123 amount 19 700`,
          ...(part === "b" && index === 62 ? ["FAIL_BATCH_ONLY"] : []),
          ...Array.from(
            { length: 14 },
            (_, line) => `Row ${line + 1} ${"documented terms ".repeat(3)}`
          )
        ].join("\n")
      );
      const bytes = pdf(texts);
      const added = await original.inject({
        method: "POST",
        url: base,
        headers: {
          "content-type": "application/octet-stream",
          "x-kosmora-file-name": `supplier-${part}.pdf`
        },
        payload: bytes
      });
      expect(added.statusCode).toBe(201);
      const { id } = added.json<{ id: string }>();
      const indexed = await original.inject({
        method: "PUT",
        url: `${base}/${id}/index`,
        payload: { pages: texts.map((text, i) => ({ page: i + 1, text })) }
      });
      expect(indexed.statusCode, indexed.body).toBe(200);
      size += bytes.length;
      fileIds.push(id);
    }
    for (const [name, text] of [
      ["proposal.csv", "Артикул,Сумма\n00123,19 700"],
      ["conditions.txt", "Итог 19 700, кроме доставки."]
    ] as const) {
      const bytes = Buffer.from(text);
      const added = await original.inject({
        method: "POST",
        url: base,
        headers: {
          "content-type": "application/octet-stream",
          "x-kosmora-file-name": name
        },
        payload: bytes
      });
      expect(added.statusCode, added.body).toBe(201);
      const { id } = added.json<{ id: string }>();
      expect(
        (
          await original.inject({
            method: "PUT",
            url: `${base}/${id}/index`,
            payload: { pages: [{ page: null, text }] }
          })
        ).statusCode
      ).toBe(200);
      size += bytes.length;
      fileIds.push(id);
    }
    const created = await original.inject({
      method: "POST",
      url: base + "/answers",
      payload: {
        mode: "deep",
        question: "Сверь суммы и условия.",
        file_ids: fileIds
      }
    });
    expect(created.statusCode).toBe(202);
    const { id: firstId } = created.json<{ id: string }>();
    const history = new DocumentAnswerStore(db.sqlite);
    const first = await vi.waitFor(
      () => {
        const item = history.get(project, owner, firstId)!;
        expect(item.status).toBe("done");
        return item;
      },
      { timeout: 7000 }
    );
    expect(first.coverage!.failed_chunks).toBeGreaterThan(0);
    expect(first.coverage!.total_chunks).toBe(514);
    expect(first.coverage!.files.reduce((n, f) => n + (f.bytes ?? 0), 0)).toBe(size);
    expect(size).toBeGreaterThan(500_000);
    expect(peak).toBe(3);
    const incomplete = await original.inject(`${base}/answers/${firstId}/analysis.ndjson`);
    expect(incomplete.body).toContain('"type":"failed_batch"');
    expect(incomplete.body).toContain('"error":"INVALID_EVIDENCE"');
    expect(incomplete.body).toContain('"page":63');
    const firstReaders = readers;
    await original.close();
    db.close();
    connection = false;

    db = openDatabase(dbPath);
    connection = true;
    await runMigrations(db);
    firstPass = false;
    const restarted = build();
    const retryUrl = `${base}/answers/${firstId}/retry`;
    const kick = () =>
      restarted.inject({
        method: "POST",
        url: retryUrl,
        payload: { retry_request_id: "recovery-demo" }
      });
    const result = await kick();
    expect(result.statusCode, result.body).toBe(202);
    const { id: newId } = result.json<{ id: string }>();
    expect((await kick()).json<{ id: string }>().id).toBe(newId);
    const reloaded = new DocumentAnswerStore(db.sqlite);
    const last = await vi.waitFor(
      () => {
        const item = reloaded.get(project, owner, newId)!;
        expect(item.status, item.error_code ?? "").toBe("done");
        return item;
      },
      { timeout: 7000 }
    );
    expect(reloaded.get(project, owner, firstId)).toEqual(first);
    expect(last.coverage).toMatchObject({
      failed_chunks: 0,
      analyzed_chunks: 514,
      reused_chunks: first.coverage!.analyzed_chunks
    });
    expect(last.coverage!.files.reduce((n, f) => n + (f.analyzed_pages ?? 0), 0)).toBe(512);
    expect(readers - firstReaders).toBe(1);
    expect(last.answer).toContain("00123 amount 19 700");
    const exported = await restarted.inject(`${base}/answers/${newId}/analysis.ndjson`);
    expect(exported.statusCode).toBe(200);
    const lines = exported.body.trim().split("\n");
    expect(lines).toHaveLength(firstReaders + 1);
    expect(lines.at(-1)).toContain("кроме доставки");
    const { result: artifact } = JSON.parse(lines[1]!) as {
      result: { fragments: Array<{ page: number; current_fragment_url: string }> };
    };
    const sourceUrl = artifact.fragments[0]!.current_fragment_url;
    const originalSource = await restarted.inject(sourceUrl);
    expect(originalSource.statusCode, originalSource.body).toBe(200);
    const location = originalSource.json<{ page: number; content: string }>();
    expect(location.page).toBe(1);
    expect(location.content).toContain("00123");
    expect(
      (await restarted.inject(sourceUrl.replace(/sha256=[a-f0-9]+/u, "sha256=" + "b".repeat(64))))
        .statusCode
    ).toBe(410);
    expect((await restarted.inject(sourceUrl.replace(project, "another-project"))).statusCode).toBe(
      404
    );
    expect(lines[0]).toContain('"analyzed_pages":128');
    expect([...reloaded.batches({ ...last, owner_id: "other-owner" })]).toEqual([]);
    process.stdout.write(
      `Large document fixture: ${size} bytes, 512 PDF pages, 514 chunks, ${firstReaders} analysis batches, 1 replay dispatch\n`
    );
    const pauseRun = await restarted.inject({
      method: "POST",
      url: base + "/answers",
      payload: {
        mode: "deep",
        question: "Проверка паузы.",
        file_ids: [fileIds[0]!]
      }
    });
    expect(pauseRun.statusCode).toBe(202);
    const { id: pausedId } = pauseRun.json<{ id: string }>();
    await vi.waitFor(() => {
      expect(releasePaused).toBeTypeOf("function");
      expect(reloaded.get(project, owner, pausedId)!.coverage!.analyzed_chunks).toBeGreaterThan(0);
    });
    const pausePath = `${base}/answers/${pausedId}/pause`;
    expect((await restarted.inject({ method: "POST", url: pausePath })).json()).toEqual({
      status: "paused"
    });
    const confirmed = reloaded.get(project, owner, pausedId)!;
    expect(confirmed.error_code).toBe("PAUSED");
    releasePaused?.();
    await vi.waitFor(() => expect(inFlight).toBe(0));
    expect(reloaded.get(project, owner, pausedId)).toEqual(confirmed);
    releasePaused = undefined;
  } finally {
    await app?.close();
    if (connection) db.close();
    rmSync(tmp, { recursive: true, force: true });
  }
});
