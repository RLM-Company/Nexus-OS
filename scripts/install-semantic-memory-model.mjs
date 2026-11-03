import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { resolve, dirname, isAbsolute } from "node:path";
import { MODEL } from "../apps/api/src/semantic-memory/model-manifest.mjs";

// Explicit operator action only. Fetches fixed PUBLIC weights, never private data.
const destination = process.argv[2];
if (!destination || !isAbsolute(destination))
  throw new Error("An absolute model directory is required");
for (const [file, expected] of Object.entries(MODEL.files)) {
  const target = resolve(destination, file);
  const hash = (data) => createHash("sha256").update(data).digest("hex");
  try {
    if (hash(await readFile(target)) === expected) continue;
  } catch {
    /* not installed */
  }
  await mkdir(dirname(target), { recursive: true });
  const response = await fetch(
    `https://huggingface.co/${MODEL.id}/resolve/${MODEL.revision}/${file}`,
    {
      signal: AbortSignal.timeout(300000)
    }
  );
  if (!response.ok) throw new Error(`Model download failed: ${response.status}`);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > 130000000) throw new Error("Model download size limit");
    chunks.push(chunk);
  }
  const data = Buffer.concat(chunks);
  if (hash(data) !== expected) throw new Error("Model integrity check failed");
  const temporary = target + ".partial-" + process.pid;
  try {
    await writeFile(temporary, data, { flag: "wx", mode: 0o600 });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
  process.stdout.write(`Installed ${file} (${data.byteLength} bytes)\n`);
}
process.stdout.write(`Verified ${MODEL.encoder}\n`);
