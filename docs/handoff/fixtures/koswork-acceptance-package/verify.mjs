#!/usr/bin/env node
/**
 * Verifier for the portable Koswork acceptance package B.
 * No dependencies, deterministic, exits non-zero on any mismatch.
 *
 * node verify.mjs                  # self-consistency of the package
 * node verify.mjs --report FILE    # compare a real report with expectations
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dir = resolve(
  process.argv.includes("--dir") ? process.argv[process.argv.indexOf("--dir") + 1] : here
);
const read = (name) => readFileSync(join(dir, name));
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const json = (name) => JSON.parse(read(name).toString("utf8"));
const failures = [];
const check = (ok, message) => {
  if (!ok) failures.push(message);
};
const eq = (actual, expected, message) =>
  check(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  );

/* -------------------------------------------------- package integrity ----- */
const expected = json("expected.json");
check(expected.format === "kosmora.koswork-acceptance.v1", "Unexpected expectations format");
const sums = read("SHA256SUMS")
  .toString("utf8")
  .trim()
  .split("\n")
  .map((line) => {
    const [hash, name] = line.trim().split(/\s+/);
    return { hash, name };
  });
for (const { hash, name } of sums)
  check(sha256(read(name)) === hash, `SHA256SUMS mismatch: ${name}`);

const sourceA = read("source-a.txt").toString("utf8");
const sourceB = read("source-b.txt").toString("utf8");
check(
  sourceA.includes("19 700") && sourceA.includes("00123") && sourceA.includes("07.11.2026"),
  "source-a facts missing"
);
check(
  sourceB.includes("4 300") && sourceB.includes("00456") && sourceB.includes("08.11.2026"),
  "source-b facts missing"
);
eq(expected.derived.total_amount, 19700 + 4300, "dependency calculation");
eq(expected.derived.articles, ["00123", "00456"], "articles");

// Expectations must be internally consistent with the scenario matrix.
const scenarios = expected.scenarios;
for (const name of ["normal", "paused_resumed", "restarted", "partial", "retry_new_date"])
  check(!!scenarios[name], `missing scenario ${name}`);
check(scenarios.partial.complete === false, "partial must not be complete");
check(
  scenarios.partial.completed_steps < scenarios.partial.total_steps,
  "partial counters inconsistent"
);
check(
  scenarios.retry_new_date.invariant.total_amount === expected.derived.total_amount,
  "retry changed total"
);
eq(
  scenarios.retry_new_date.invariant.articles,
  expected.derived.articles,
  "retry changed articles"
);
check(
  scenarios.restarted.explicit_continuation_required === true,
  "restart must require explicit continuation"
);
check(
  scenarios.normal.model_requests === scenarios.paused_resumed.model_requests,
  "pause/resume changed model requests"
);

/* --------------------------------------------------- report comparison ---- */
const reportArg = process.argv.includes("--report")
  ? process.argv[process.argv.indexOf("--report") + 1]
  : null;
if (reportArg) {
  const report = JSON.parse(readFileSync(resolve(reportArg), "utf8"));
  check(report.format === "kosmora.koswork-acceptance-report.v1", "Unexpected report format");
  const actual = report.scenarios ?? {};
  const n = actual.normal ?? {};
  eq(n.status, scenarios.normal.expected_status, "normal.status");
  eq(n.model_requests, scenarios.normal.model_requests, "normal.model_requests");
  for (const token of expected.final_document.must_contain)
    check(n.content_checks?.[token] === true, `normal missing token ${token}`);
  const pr = actual.paused_resumed ?? {};
  check(pr.pause_visible === true, "paused_resumed not visible");
  check(pr.resumed_explicitly === true, "paused_resumed not explicit");
  check(pr.replayed_completed_steps === false, "paused_resumed replayed completed steps");
  const rs = actual.restarted ?? {};
  eq(rs.completed_steps_kept, scenarios.restarted.completed_steps_kept, "restarted kept steps");
  check(rs.explicit_continuation_required === true, "restarted continuation not explicit");
  const pa = actual.partial ?? {};
  check(pa.complete === scenarios.partial.complete, "partial.complete");
  eq(pa.completed_steps, scenarios.partial.completed_steps, "partial.completed_steps");
  eq(pa.total_steps, scenarios.partial.total_steps, "partial.total_steps");
  const rn = actual.retry_new_date ?? {};
  eq(rn.new_date, scenarios.retry_new_date.new_date, "retry_new_date.new_date");
  eq(
    rn.total_amount,
    scenarios.retry_new_date.invariant.total_amount,
    "retry_new_date.total_amount"
  );
  eq(rn.articles, scenarios.retry_new_date.invariant.articles, "retry_new_date.articles");
  check(rn.explicit_retry === true, "retry_new_date not explicit");
}

if (failures.length) {
  console.error(`VERIFY FAILED (${failures.length}):\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log(
  JSON.stringify(
    {
      verify: "passed",
      package: reportArg ? "report compared with expectations" : "self-consistency",
      scenarios: Object.keys(scenarios),
      model_requests: scenarios.normal.model_requests,
      derived_total: expected.derived.total_amount
    },
    null,
    2
  )
);
