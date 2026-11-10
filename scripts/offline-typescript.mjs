/** Resolve the repository's normal devDependency for offline smoke tests.
 * The absolute fallback is only for the isolated artifact-validation container. */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, rmSync, unlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);

export const ts = (() => {
  try {
    return require("typescript");
  } catch {
    try {
      return require("/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js");
    } catch {
      try {
        const babel = require("/usr/share/nodejs/@babel/core");
        const tsPlugin = require("/usr/share/nodejs/@babel/plugin-transform-typescript");
        return {
          ModuleKind: { ESNext: 99, CommonJS: 1 },
          ScriptTarget: { ES2022: 9 },
          transpileModule(source, options = {}) {
            const fileName = options.fileName ?? "module.ts";
            const result = babel.transformSync(source, {
              filename: fileName,
              babelrc: false,
              configFile: false,
              retainLines: true,
              plugins: [
                [
                  tsPlugin,
                  {
                    allowDeclareFields: true,
                    onlyRemoveTypeImports: true,
                    isTSX: fileName.endsWith(".tsx")
                  }
                ]
              ]
            });
            return { outputText: result?.code ?? "" };
          }
        };
      } catch {
        throw new Error(
          "Integration smoke requires the TypeScript devDependency: install the locked pnpm workspace first."
        );
      }
    }
  }
})();

const PYTHON_SQLITE_DRIVER = `
import json, sqlite3, sys
payload = json.loads(sys.stdin.read())
db_path = payload["dbPath"]
mode = payload["mode"]
sql = payload["sql"]
params = payload.get("params", [])
conn = sqlite3.connect(db_path, timeout=30.0)
conn.row_factory = sqlite3.Row
try:
    conn.execute("PRAGMA foreign_keys = ON;")
    if mode == "exec":
        conn.executescript(sql)
        conn.commit()
        print(json.dumps({"ok": True}))
    elif mode == "run":
        cur = conn.execute(sql, params)
        conn.commit()
        print(json.dumps({"ok": True, "changes": cur.rowcount, "lastInsertRowid": cur.lastrowid}))
    elif mode == "get":
        cur = conn.execute(sql, params)
        row = cur.fetchone()
        conn.commit()
        print(json.dumps({"ok": True, "row": dict(row) if row is not None else None}))
    elif mode == "all":
        cur = conn.execute(sql, params)
        rows = [dict(r) for r in cur.fetchall()]
        conn.commit()
        print(json.dumps({"ok": True, "rows": rows}))
    else:
        raise ValueError("Unsupported mode: " + str(mode))
except Exception as exc:
    conn.rollback()
    print(json.dumps({"ok": False, "error": str(exc)}))
    sys.exit(1)
finally:
    conn.close()
`;

class PythonDatabaseSyncFallback {
  constructor(filename = ":memory:") {
    this.isMemory = filename === ":memory:";
    if (this.isMemory) {
      this.tempDir = mkdtempSync(join(tmpdir(), "kosmora-sqlite-mem-"));
      this.filePath = join(this.tempDir, "mem.sqlite");
    } else {
      this.filePath = filename;
    }
    this.txPath = `${this.filePath}.tx`;
    this.inTransaction = false;
    this.closed = false;
    this.invoke("exec", "SELECT 1;");
  }

  activePath() {
    return this.inTransaction ? this.txPath : this.filePath;
  }

  invoke(mode, sql, params = []) {
    if (this.closed) throw new Error("Database is closed");
    const proc = spawnSync("python3", ["-c", PYTHON_SQLITE_DRIVER], {
      input: JSON.stringify({
        dbPath: this.activePath(),
        mode,
        sql,
        params: params.map((p) => (p === undefined ? null : p))
      }),
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024
    });
    if (proc.status !== 0) {
      let msg = proc.stderr || proc.stdout || "SQLite error";
      try {
        const parsed = JSON.parse(proc.stdout);
        if (parsed.error) msg = parsed.error;
      } catch {
        /* ignore */
      }
      throw new Error(msg.trim());
    }
    return JSON.parse(proc.stdout);
  }

  exec(sql) {
    const trimmed = String(sql).trim();
    if (/^BEGIN(?:\s+(?:IMMEDIATE|EXCLUSIVE|DEFERRED))?;?$/i.test(trimmed)) {
      if (this.inTransaction) throw new Error("cannot start a transaction within a transaction");
      if (existsSync(this.filePath)) {
        copyFileSync(this.filePath, this.txPath);
      }
      this.inTransaction = true;
      return;
    }
    if (/^COMMIT;?$/i.test(trimmed)) {
      if (!this.inTransaction) throw new Error("cannot commit - no transaction is active");
      if (existsSync(this.txPath)) {
        copyFileSync(this.txPath, this.filePath);
        unlinkSync(this.txPath);
      }
      this.inTransaction = false;
      return;
    }
    if (/^ROLLBACK;?$/i.test(trimmed)) {
      if (!this.inTransaction) throw new Error("cannot rollback - no transaction is active");
      if (existsSync(this.txPath)) {
        unlinkSync(this.txPath);
      }
      this.inTransaction = false;
      return;
    }
    this.invoke("exec", sql);
  }

  prepare(sql) {
    return {
      run: (...params) => this.invoke("run", sql, params),
      get: (...params) => this.invoke("get", sql, params).row ?? undefined,
      all: (...params) => this.invoke("all", sql, params).rows ?? []
    };
  }

  close() {
    this.closed = true;
    if (existsSync(this.txPath)) {
      try {
        unlinkSync(this.txPath);
      } catch {
        /* ignore */
      }
    }
    if (this.isMemory && this.tempDir) {
      try {
        rmSync(this.tempDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
}

export const DatabaseSync = (() => {
  try {
    return require("node:sqlite").DatabaseSync;
  } catch {
    return PythonDatabaseSyncFallback;
  }
})();
