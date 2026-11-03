import { copyFile, mkdir } from "node:fs/promises";
// Plain Node worker assets intentionally stay outside the API TypeScript program:
// inference SDK ambient types must not alter unrelated API network declarations.
const source = new URL("../apps/api/src/semantic-memory/", import.meta.url);
const destination = new URL("../apps/api/dist/semantic-memory/", import.meta.url);
await mkdir(destination, { recursive: true });
for (const file of ["encoder-worker.mjs", "model-manifest.mjs"])
  await copyFile(new URL(file, source), new URL(file, destination));
