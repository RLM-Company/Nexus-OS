// Local HTTP smoke against the real app router (in-memory SQLite, mock provider).
// No live model, no owner data, no secrets: this is a local integration check.
import { randomUUID } from "node:crypto";
import { loadServerConfig } from "../packages/config/dist/index.js";
import {
  IdentityStore,
  OwnerSkillStore,
  openDatabase,
  runMigrations
} from "../packages/db/dist/index.js";
import { buildApp } from "../apps/api/dist/app.js";
import { BearerSessionIdentityResolver } from "../apps/api/dist/identity.js";

const db = openDatabase(":memory:");
await runMigrations(db);
const identity = new IdentityStore(db.sqlite);
identity.registerActor("a", "a", "owner");
const token = identity.issueSession({
  ownerId: "a",
  actorId: "a",
  assurance: "single_factor",
  ttlMs: 60_000
}).token;
const app = buildApp({
  config: loadServerConfig({ NODE_ENV: "test" }),
  database: db,
  identityStore: identity,
  identityResolver: new BearerSessionIdentityResolver(identity),
  ownerSkillStore: new OwnerSkillStore(db.sqlite)
});
const call = (method, path, body) =>
  app.inject({
    method,
    url: `/api/v1/owner-skills${path}`,
    headers: {
      authorization: `Bearer ${token}`,
      origin: "http://localhost:3000",
      ...(body === undefined ? {} : { "content-type": "application/json" })
    },
    ...(body === undefined ? {} : { payload: JSON.stringify(body) })
  });

const proposed = await call("POST", "/corrections/propose", { correction: "Отвечай тезисами" });
const draft = proposed.json().draft;
const accepted = await call("POST", "/corrections/accept", {
  client_request_id: randomUUID(),
  draft: {
    format: draft.format,
    name: draft.name,
    summary: draft.summary,
    instructions: draft.instructions
  }
});
const evaluated = await call("POST", "/evaluate-result", {
  source: "Бюджет 19 700 ₽",
  answer: "- 19 700 ₽",
  required_facts: ["19 700 ₽"],
  forbidden: ["21 000"],
  format: "bullets"
});
const report = {
  propose_status: proposed.statusCode,
  draft_inert: proposed.json().draft.accepted === false,
  accept_status: accepted.statusCode,
  skill_name: accepted.json().skill?.name,
  evaluate_status: evaluated.statusCode,
  evaluate_passed: evaluated.json().passed,
  not_checked: evaluated.json().not_checked
};
console.log(JSON.stringify(report, null, 2));
await app.close();
db.close();
if (
  proposed.statusCode !== 200 ||
  report.draft_inert !== true ||
  accepted.statusCode !== 201 ||
  evaluated.statusCode !== 200 ||
  evaluated.json().passed !== true
)
  process.exit(1);
