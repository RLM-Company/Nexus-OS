import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
const repo = process.argv[2],
  req = createRequire(join(repo, "packages/db/package.json"));
const ts = createRequire(join(repo, "package.json"))("typescript");
function show(file) {
  return execFileSync("git", ["show", "origin/review-684:" + file], {
    cwd: repo,
    encoding: "utf8"
  });
}
let contracts = {};
function load(file) {
  const js = ts.transpileModule(show(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", js)(
    (name) => (name === "@cosmora/contracts" ? contracts : req(name)),
    mod,
    mod.exports
  );
  return mod.exports;
}
contracts = {
  ...load("packages/contracts/src/project-members.ts"),
  ...load("packages/contracts/src/project-sources.ts")
};
const { ProjectMembershipStore } = load("packages/db/src/project-membership-store.ts");
const { ProjectSourceStore } = load("packages/db/src/project-source-store.ts");
const db = new DatabaseSync(":memory:");
db.exec(
  "CREATE TABLE projects(id TEXT PRIMARY KEY,owner_id TEXT); INSERT INTO projects VALUES('project-a','owner-a'); CREATE TABLE kosmora_owner_data_lifecycle(owner_id TEXT,state TEXT);"
);
db.exec(show("packages/db/migrations/0074_project_members.sql"));
db.exec(show("packages/db/migrations/0073_project_sources.sql"));
const membership = new ProjectMembershipStore(db);
membership.invite("project-a", "owner-a", { account_id: "owner-b", role: "editor" });
membership.accept("project-a", "owner-b");
const access = membership.canAccess("project-a", "owner-b");
let read;
try {
  read = new ProjectSourceStore(db).exclusions("project-a", "owner-b");
} catch (error) {
  read = { error: error.code, status: error.status };
}
console.log(
  JSON.stringify(
    {
      delivery: "6547e18e",
      acceptedMemberCanAccess: access,
      sourceReadResult: read,
      fixture: "native SQLite, actual supplied store classes and contracts; minimal schema"
    },
    null,
    2
  )
);
db.close();
