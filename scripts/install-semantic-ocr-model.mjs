// Explicit operator action only. Downloads the fixed PUBLIC weights listed in
// scripts/semantic-ocr-model-manifest.mjs and byte-verifies every file; never
// fetches private data, never runs unattended. Existing files with matching
// SHA256 are kept, so re-running is a cheap integrity check.
//
// Usage: node scripts/install-semantic-ocr-model.mjs <absolute root directory>
// Layout: <root>/trocr-base-handwritten/..., <root>/table-transformer-structure-recognition/...
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { TATR, TROCR } from "./semantic-ocr-model-manifest.mjs";

const root = process.argv[2];
if (!root || !isAbsolute(root)) throw Error("An absolute model root directory is required");
const maxSingleFileBytes = 300_000_000;

const hashFile = async (path) => {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path, { highWaterMark: 1024 * 1024 }), hash);
  return hash.digest("hex");
};

for (const model of [TROCR, TATR]) {
  let verified = 0,
    downloaded = 0;
  for (const [file, expected] of Object.entries(model.files)) {
    const target = resolve(root, model.directory, file);
    let matches = false;
    try {
      const info = await stat(target);
      if (info.size === expected.bytes) matches = (await hashFile(target)) === expected.sha256;
    } catch {
      /* missing: will download */
    }
    if (matches) {
      verified++;
      continue;
    }
    await mkdir(dirname(target), { recursive: true });
    const response = await fetch(
      `https://huggingface.co/${model.id}/resolve/${model.revision}/${file}`,
      { signal: AbortSignal.timeout(900_000) }
    );
    if (!response.ok) throw Error(`Model download failed (${response.status}): ${file}`);
    const digest = createHash("sha256");
    const temporary = target + ".partial-" + process.pid;
    try {
      await pipeline(
        Readable.fromWeb(response.body),
        async function* (chunks) {
          let size = 0;
          for await (const chunk of chunks) {
            size += chunk.byteLength;
            if (size > maxSingleFileBytes)
              throw Error(`Model download size limit exceeded: ${file}`);
            digest.update(chunk);
            yield chunk;
          }
        },
        createWriteStream(temporary, { mode: 0o600 })
      );
      if (digest.digest("hex") !== expected.sha256)
        throw Error(`Model integrity check failed: ${file}`);
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
    downloaded++;
    process.stdout.write(`Installed ${model.directory}/${file} (${expected.bytes} bytes)\n`);
  }
  process.stdout.write(`${model.id}: ${verified} verified, ${downloaded} downloaded\n`);
}
process.stdout.write("Semantic OCR models verified.\n");
