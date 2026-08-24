import { rmSync } from "node:fs";
import { resolve } from "node:path";

export default function globalSetup(): void {
  const database = resolve(process.cwd(), "../api/data/e2e-b0.1.db");
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(`${database}${suffix}`, { force: true });
  }
}
