import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("invalidates only the API build when packaged Office sources or their copier change", () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const fixture = mkdtempSync(join(tmpdir(), "office-turbo-"));
  const office = [
    "office-edit",
    "office-view",
    "office-document",
    "office-text",
    "version-backup",
    "path-guard",
    "errors"
  ].map((name) => `desktop/windows/workspace/${name}.cjs`);
  const copy = (path: string) => {
    const destination = join(fixture, path);
    mkdirSync(join(destination, ".."), { recursive: true });
    cpSync(join(root, path), destination);
  };
  try {
    for (const path of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "turbo.json"])
      copy(path);
    for (const parent of ["apps", "packages"])
      for (const entry of readdirSync(join(root, parent))) {
        const path = `${parent}/${entry}/package.json`;
        if (existsSync(join(root, path))) copy(path);
      }
    for (const path of [...office, "scripts/copy-office-engine.mjs"]) copy(path);
    const hashes = () => {
      const output = execFileSync(
        process.execPath,
        [
          join(root, "node_modules/turbo/bin/turbo"),
          "run",
          "build",
          "--filter=@cosmora/api",
          "--filter=@cosmora/web",
          "--dry=json"
        ],
        {
          cwd: fixture,
          encoding: "utf8",
          env: { ...process.env, TURBO_TELEMETRY_DISABLED: "1" },
          stdio: ["ignore", "pipe", "pipe"]
        }
      );
      const { tasks } = JSON.parse(output) as {
        tasks: Array<{
          taskId: string;
          hash: string;
          dependencies: string[];
          resolvedTaskDefinition: { outputs: string[] };
        }>;
      };
      return {
        api: tasks.find((t) => t.taskId === "@cosmora/api#build")!,
        web: tasks.find((t) => t.taskId === "@cosmora/web#build")!
      };
    };
    const before = hashes();
    expect(before.api.dependencies).toContain("@cosmora/contracts#build");
    expect(before.api.resolvedTaskDefinition.outputs).toContain("dist/**");
    for (const path of [...office, "scripts/copy-office-engine.mjs"]) {
      writeFileSync(join(fixture, path), "// changed Office fixture input\n");
      const changed = hashes();
      expect(changed.api.hash, path).not.toBe(before.api.hash);
      expect(changed.web.hash, path).toBe(before.web.hash);
      copy(path);
      expect(hashes().api.hash).toBe(before.api.hash);
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}, 30000);
