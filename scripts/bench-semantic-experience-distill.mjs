// Frozen synthetic evaluation of a deterministic extractive distillation
// candidate for accepted work experience (the "общая автоматическая
// дистилляция" step of the Ruflo adoption row). No model, no weights and no
// product code changes are involved: the candidate distiller is a prototype
// implemented inside this measurement script, the panel is synthetic and
// frozen, and results are one-machine observations, not SLA or intelligence
// claims. The candidate never rewrites text. Everything it emits is a
// byte-exact slice of the source example field it came from, so the measured
// tradeoff is pure whole-step and prefix dropping: stale segments (paths,
// recipients, credentials, coordinates, approvals, old refs, checked states)
// disappear only together with clean text co-located in the same step, and
// a sketch budget can pack out and exclude later steps entirely.
import { readFile, writeFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

const [output, comparePath] = process.argv.slice(2);
const fixture = JSON.parse(
  await readFile(
    new URL(
      "../packages/db/test/fixtures/semantic-experience-distill-evaluation.json",
      import.meta.url
    ),
    "utf8"
  )
);
const fixtureSha = createHash("sha256").update(JSON.stringify(fixture)).digest("hex");

// The sketch stays far below the 14000-byte work_reference budget; the goal
// prefix keeps most of a bounded goal excerpt without splitting code points.
const SKETCH_BYTE_LIMIT = 5000;
const GOAL_PREFIX_BYTE_LIMIT = 480;

// Every rule mirrors one stalled-evidence class of WORK_REFERENCE_RULES
// (apps/api/src/computer-control/service.ts): paths, recipients, credentials,
// coordinates, checked states and old refs are example history, not current
// requirements. Matching is conservative on purpose; recall beyond the frozen
// panel is not claimed.
const PATTERNS = [
  { id: "path_separator_token", re: /\S*[\\/]\S*|\b[A-Za-z]:\\/ },
  { id: "email_or_handle", re: /[\w.+-]+@[\w-]+\.[\w.-]+|@[A-Za-z0-9_]{3,}/ },
  {
    id: "credential_assignment",
    re: /\b(?:логин|пароль|токен|ключ|секрет|password|token|pin-код)\s*[:=]/i
  },
  { id: "credential_token", re: /\b[A-Z]{2,5}-\d{4,6}-[A-Za-z0-9]{4,8}\b|\b[A-Za-z0-9_-]{24,}\b/ },
  { id: "coordinate_pair", re: /\d{1,3}[.,]\d{3,}\s*,\s*\d{1,3}[.,]\d{3,}/ },
  {
    id: "date_or_old_ref",
    re: /\b20\d{2}-\d{2}-\d{2}\b|\b(?:см\.|смотри)\s|#\d{2,6}\b|\bревизия\b/i
  },
  {
    id: "approval_or_checked",
    re: /проверено владел|принято заказчик|согласован[аоо]|одобрено|проверено мной/i
  }
];

const byteLen = (value) => Buffer.byteLength(value, "utf8");
const jsonBytes = (value) => byteLen(JSON.stringify(value));

const matchesProhibition = (text) => {
  for (const pattern of PATTERNS) if (pattern.re.test(text)) return pattern.id;
  return null;
};

// Sentence spans in UTF-16 units; prefix building stops before the first
// stale sentence, so the excerpt stays an exact prefix of source_goal and no
// later sentence is re-joined.
const splitSentences = (text) => {
  const parts = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const symbol = text[i];
    if (
      (symbol === "." || symbol === "!" || symbol === "?") &&
      (i + 1 === text.length || /\s/.test(text[i + 1]))
    ) {
      parts.push({ start, end: i + 1 });
      let next = i + 1;
      while (next < text.length && /\s/.test(text[next])) next++;
      start = next;
      i = start - 1;
    }
  }
  if (start < text.length && text.slice(start).trim().length)
    parts.push({ start, end: text.length });
  return parts;
};

// Byte-budgeted prefix cut for a single long sentence; surrogate pairs are
// processed atomically, so the excerpt never splits a code point. The
// trailing-surrogate retreat is defensive for malformed sources.
const cutToBytes = (text, budget) => {
  let used = 0;
  let cut = 0;
  for (let i = 0; i < text.length;) {
    const chunk = text.codePointAt(i) >= 0x10000 ? text.slice(i, i + 2) : text[i];
    const width = byteLen(chunk);
    if (used + width > budget) break;
    used += width;
    cut = i + chunk.length;
    i += chunk.length;
  }
  let result = text.slice(0, cut);
  while (result.length && /[\uD800-\uDBFF]/.test(result[result.length - 1])) {
    result = result.slice(0, -1);
  }
  return result;
};

const buildGoalExcerpt = (goal) => {
  const sentences = splitSentences(goal);
  let excerpt = "";
  let cut = false;
  let empty = false;
  for (const { start, end } of sentences) {
    const sentence = goal.slice(start, end);
    if (matchesProhibition(sentence)) {
      empty = excerpt.length === 0;
      break;
    }
    const candidate = excerpt.length === 0 ? sentence : excerpt + " " + sentence;
    if (byteLen(candidate) <= GOAL_PREFIX_BYTE_LIMIT) {
      excerpt = candidate;
      continue;
    }
    // The first clean sentence that does not fit is cut mid-sentence to the
    // byte budget; the sketch keeps an exact truncated prefix.
    const separator = excerpt.length === 0 ? "" : " ";
    const remaining = GOAL_PREFIX_BYTE_LIMIT - byteLen(excerpt) - separator.length;
    const tail = remaining >= 40 ? cutToBytes(sentence, remaining) : "";
    excerpt = excerpt + separator + tail;
    cut = true;
    break;
  }
  return { excerpt, cut, empty };
};

// Once the sketch budget is exhausted the packing stops; every later step is
// excluded as a whole (no partial steps, no later-step jigsaw).
const distillCandidate = (example) => {
  const goal = buildGoalExcerpt(example.source_goal);
  const kinds = [...new Set(example.tool_observations.map((o) => o.kind))].sort();
  const skeleton = {
    format: "koswork.example-sketch.v1",
    prototype: "extractive-drop-candidate-v1",
    source_task_id: example.source_task_id,
    source_project_id: example.source_project_id,
    accepted_at: example.accepted_at,
    outcome: example.outcome,
    goal_excerpt: goal.excerpt,
    goal_prefix_only: true,
    goal_cut: goal.cut,
    plan: [],
    tool_kinds: kinds,
    tool_counts_included: false,
    weights_trained: false
  };
  const sketch = { ...skeleton };
  const drops = [];
  let clipped = 0;
  for (let index = 0; index < example.plan.length; index++) {
    const step = example.plan[index];
    const rule = matchesProhibition(step.title) ?? matchesProhibition(step.criteria);
    if (rule) {
      drops.push({ index: index, rule: rule });
      continue;
    }
    const candidate = [...sketch.plan, { title: step.title, criteria: step.criteria }];
    if (byteLen(JSON.stringify({ ...sketch, plan: candidate })) > SKETCH_BYTE_LIMIT) {
      clipped = example.plan.length - index;
      break;
    }
    sketch.plan = candidate;
  }
  return { sketch: sketch, drops: drops, clipped: clipped, goalEmpty: goal.empty };
};

const walkStrings = (value, path, visit) => {
  if (typeof value === "string") visit(value, path);
  else if (Array.isArray(value))
    value.forEach((item, i) => walkStrings(item, path + "[" + i + "]", visit));
  else if (value && typeof value === "object")
    for (const [key, item] of Object.entries(value)) walkStrings(item, path + "." + key, visit);
};

const hasUnpairedSurrogate = (text) => {
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xdc00 && unit <= 0xdfff) return true;
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text[i + 1] ?? 0;
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i++;
    }
  }
  return false;
};

const runCases = () =>
  fixture.cases.map((c) => {
    const started = performance.now();
    const first = distillCandidate(c.example);
    const firstSha = createHash("sha256").update(JSON.stringify(first.sketch)).digest("hex");
    const second = distillCandidate(c.example);
    const secondSha = createHash("sha256").update(JSON.stringify(second.sketch)).digest("hex");
    const ms = performance.now() - started;

    const sketch = first.sketch;
    const sketchText = JSON.stringify(sketch);
    const sketchBytes = byteLen(sketchText);
    const inputBytes = jsonBytes(c.example);
    const carried = c.forbidden_literals.filter((literal) => sketchText.includes(literal));
    const present = c.relevant_literals.filter((literal) => sketchText.includes(literal));
    const reusablePresent = present.filter(
      (literal) => !c.relevant_literals_declared_lost.includes(literal)
    );
    const lostDeclared = c.relevant_literals_declared_lost.filter(
      (literal) => !sketchText.includes(literal)
    );
    const declaredLostButPresent = c.relevant_literals_declared_lost.filter((literal) =>
      sketchText.includes(literal)
    );
    const unexpectedLosses = c.relevant_literals.filter(
      (literal) =>
        !c.relevant_literals_declared_lost.includes(literal) && !sketchText.includes(literal)
    );

    const violations = [];
    const sourcePlan = c.example.plan;
    walkStrings(sketch, "sketch", (value, path) => {
      if (hasUnpairedSurrogate(value)) violations.push(path);
      if (path.endsWith("goal_excerpt") && !c.example.source_goal.startsWith(value))
        violations.push(path);
    });
    for (let index = 0; index < sketch.plan.length; index++) {
      if (
        !sourcePlan.some(
          (step) =>
            step.title === sketch.plan[index].title && step.criteria === sketch.plan[index].criteria
        )
      )
        violations.push("plan[" + index + "]");
    }
    for (const kind of sketch.tool_kinds)
      if (!c.example.tool_observations.some((o) => o.kind === kind)) violations.push("tool_kinds");

    const sorted = (list) => [...list].sort((x, y) => x - y);
    const measuredDrops = first.drops.map((drop) => drop.index);
    const clipMismatch =
      first.clipped === c.expected_clipped_steps ? null : [first.clipped, c.expected_clipped_steps];

    return {
      id: c.id,
      input_bytes: inputBytes,
      sketch_bytes: sketchBytes,
      sketch_bytes_limit: SKETCH_BYTE_LIMIT,
      reduction: Number((sketchBytes / inputBytes).toFixed(4)),
      provenance_bytes: jsonBytes({
        format: sketch.format,
        prototype: sketch.prototype,
        source_task_id: sketch.source_task_id,
        source_project_id: sketch.source_project_id,
        accepted_at: sketch.accepted_at,
        outcome: sketch.outcome
      }),
      goal_prefix_bytes: byteLen(sketch.goal_excerpt),
      goal_cut: sketch.goal_cut,
      goal_empty: sketch.goal_excerpt === "",
      declared_goal_excerpt_only: c.example.goal_excerpt_only,
      total_steps: c.example.plan.length,
      kept_steps: sketch.plan.length,
      dropped_steps: first.drops.length,
      clipped_steps: first.clipped,
      expected_clipped_steps: c.expected_clipped_steps,
      clip_mismatch: clipMismatch,
      dropped_rules: first.drops.map((drop) => drop.rule),
      expected_dropped_steps: sorted(c.expected_dropped_steps),
      drop_mismatch:
        JSON.stringify(sorted(measuredDrops)) === JSON.stringify(sorted(c.expected_dropped_steps))
          ? null
          : [measuredDrops, sorted(c.expected_dropped_steps)],
      relevant_declared: c.relevant_literals.length,
      relevant_declared_lost: c.relevant_literals_declared_lost.length,
      relevant_kept_strict: present.length,
      relevant_kept_reusable: reusablePresent.length,
      relevant_lost_declared_missing: lostDeclared.length,
      relevant_declared_lost_but_present: declaredLostButPresent.length,
      unexpected_losses: unexpectedLosses,
      forbidden_declared: c.forbidden_literals.length,
      forbidden_carried: carried,
      fidelity_violations: violations,
      sketch_sha256: firstSha,
      second_sha256: secondSha,
      sha_deterministic: firstSha === secondSha,
      ms: Math.round(ms * 1000) / 1000
    };
  });

const cases = runCases();
const caseSha = createHash("sha256")
  .update(JSON.stringify(cases.map(({ ms: _ms, ...rest }) => rest)))
  .digest("hex");
const median = (values) => {
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.floor(sorted.length / 2)];
};
const relevantTotal = cases.reduce((sum, c) => sum + c.relevant_declared, 0);
const declaredLostTotal = cases.reduce((sum, c) => sum + c.relevant_declared_lost, 0);
const relevantStrict = cases.reduce((sum, c) => sum + c.relevant_kept_strict, 0);
const relevantReusableKept = cases.reduce((sum, c) => sum + c.relevant_kept_reusable, 0);
const relevantReusable = relevantTotal - declaredLostTotal;
const stepsTotal = cases.reduce((sum, c) => sum + c.total_steps, 0);
const stepsDropped = cases.reduce((sum, c) => sum + c.dropped_steps, 0);

const report = {
  fixture_sha256: fixtureSha,
  case_sha256: caseSha,
  fixture_cases: cases.length,
  candidate: {
    name: "extractive-drop-candidate-v1",
    deterministic: true,
    operates_product_code: "none; prototype inside the bench script",
    uses_model_or_weights: false,
    rewrites_text: false,
    sketch_format: "koswork.example-sketch.v1"
  },
  limits: {
    sketch_bytes: SKETCH_BYTE_LIMIT,
    goal_prefix_bytes: GOAL_PREFIX_BYTE_LIMIT,
    work_reference_budget_bytes: 14000
  },
  patterns: PATTERNS.map((pattern) => pattern.id),
  aggregates: {
    input_bytes_total: cases.reduce((sum, c) => sum + c.input_bytes, 0),
    sketch_bytes_total: cases.reduce((sum, c) => sum + c.sketch_bytes, 0),
    median_reduction: median(cases.map((c) => c.reduction)),
    max_sketch_bytes: cases.reduce((max, c) => (c.sketch_bytes > max ? c.sketch_bytes : max), 0),
    provenance_bytes_total: cases.reduce((sum, c) => sum + c.provenance_bytes, 0),
    median_op_ms: median(cases.map((c) => c.ms)),
    steps_total: stepsTotal,
    steps_dropped: stepsDropped,
    steps_clipped_total: cases.reduce((sum, c) => sum + c.clipped_steps, 0),
    steps_kept: cases.reduce((sum, c) => sum + c.kept_steps, 0),
    drop_mismatch_cases: cases.filter((c) => c.drop_mismatch !== null).length,
    clip_mismatch_cases: cases.filter((c) => c.clip_mismatch !== null).length,
    relevant_declared: relevantTotal,
    relevant_declared_lost: declaredLostTotal,
    relevant_reusable: relevantReusable,
    relevant_kept_strict: relevantStrict,
    relevant_strict_fraction: Number((relevantStrict / relevantTotal).toFixed(4)),
    relevant_reusable_kept: relevantReusableKept,
    relevant_reusable_kept_fraction: Number((relevantReusableKept / relevantReusable).toFixed(4)),
    forbidden_total: cases.reduce((sum, c) => sum + c.forbidden_declared, 0),
    forbidden_carried_total: cases.reduce((sum, c) => sum + c.forbidden_carried.length, 0),
    unexpected_losses_total: cases.reduce((sum, c) => sum + c.unexpected_losses.length, 0),
    fidelity_violations_total: cases.reduce((sum, c) => sum + c.fidelity_violations.length, 0),
    bounded_violations: cases.filter((c) => c.sketch_bytes > SKETCH_BYTE_LIMIT).length,
    goal_cut_cases: cases.filter((c) => c.goal_cut).length,
    goal_zero_cases: cases.filter((c) => c.goal_empty).length,
    clipping_cases: cases.filter((c) => c.clipped_steps > 0).length,
    sha_deterministic_all: cases.every((c) => c.sha_deterministic)
  },
  environment: {
    node: process.version,
    platform: process.platform,
    release: process.release?.name ?? null,
    arch: process.arch,
    rss_snapshot_mib: Math.round((process.memoryUsage().rss / 1048576) * 100) / 100,
    measured_at: "2026-11-09T12:00:00.000Z"
  },
  cases: cases
};

if (output) await writeFile(output, JSON.stringify(report, null, 2) + "\n");
if (comparePath) {
  const previous = JSON.parse(await readFile(comparePath, "utf8"));
  const strip = (value) =>
    JSON.parse(
      JSON.stringify(value, (key, item) =>
        key === "ms" || key === "rss_snapshot_mib" || key === "median_op_ms" ? undefined : item
      )
    );
  const reproduced =
    JSON.stringify(strip(previous)) === JSON.stringify(strip(report)) &&
    previous.fixture_sha256 === report.fixture_sha256 &&
    previous.case_sha256 === report.case_sha256;
  console.log("REPRODUCED", reproduced ? "true" : "false");
  if (!reproduced) process.exitCode = 1;
}
console.log(JSON.stringify({ ...report, cases: undefined }, null, 2));
