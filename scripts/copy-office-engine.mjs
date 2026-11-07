import { copyFile, mkdir } from "node:fs/promises";
const destination = new URL("../apps/api/dist/document-workspace/", import.meta.url);
await mkdir(destination, { recursive: true });
for (const name of [
  "office-edit",
  "office-view",
  "office-document",
  "office-text",
  "version-backup",
  "path-guard",
  "errors"
])
  await copyFile(
    new URL(`../desktop/windows/workspace/${name}.cjs`, import.meta.url),
    new URL(`${name}.cjs`, destination)
  );
