import { expect, it } from "vitest";
import {
  renderPlaybook,
  automationHash,
  evaluateSavedFiles,
  validatePlaybookDefinition
} from "../src/project-automation.js";
import type { PlaybookDefinition } from "@cosmora/contracts";
const definition: PlaybookDefinition = {
  title_template: "Report {{topic}}",
  variables: [{ key: "topic", label: "Topic", required: true }],
  nodes: [
    { id: "research", title: "Research {{topic}}", goal: "Study {{topic}}", depends_on: [] },
    {
      id: "review",
      title: "Review",
      goal: "Check saved evidence",
      depends_on: ["research"],
      requires_critic: true
    }
  ]
};
it("renders literal inputs without evaluating replacement tokens, code or nested placeholders", () => {
  const value = "$& {{other}} <script>alert(1)</script>";
  expect(renderPlaybook(definition, { topic: value }).nodes[0]?.goal).toBe("Study " + value);
  expect(definition.nodes[0]?.goal).toBe("Study {{topic}}");
});
it.each([{}, { unknown: "value" }, { topic: "  " }])(
  "rejects missing/unknown/empty required variables %j",
  (variables) => {
    expect(() => renderPlaybook(definition, variables)).toThrow();
  }
);
it("uses optional defaults and canonical object hashes independent of property order", () => {
  const d = structuredClone(definition);
  d.variables[0]!.default_value = "Moon";
  expect(renderPlaybook(d, {}).title).toBe("Report Moon");
  expect(automationHash({ a: 1, b: { x: 1, y: 2 } })).toBe(
    automationHash({ b: { y: 2, x: 1 }, a: 1 })
  );
});
it.each(["unknown", "broken", "cycle", "duplicate"])("rejects invalid playbook %s", (kind) => {
  const d = structuredClone(definition);
  if (kind === "unknown") d.nodes[0]!.goal = "{{missing}}";
  if (kind === "broken") d.title_template = "{{topic";
  if (kind === "cycle") d.nodes[0]!.depends_on = ["review"];
  if (kind === "duplicate") d.variables.push(d.variables[0]!);
  expect(() => validatePlaybookDefinition(d)).toThrow();
});
it("bounds output after expansion and preserves independent dependency IDs", () => {
  const d = structuredClone(definition);
  d.nodes[0]!.goal = "{{topic}}".repeat(4);
  expect(() => renderPlaybook(d, { topic: "x".repeat(1100) })).toThrow("RENDERED_TEMPLATE_LIMIT");
});
it("missing files fail even negative checks and evaluations make no semantic quality claim", () => {
  expect(
    evaluateSavedFiles([{ file: "report.md", kind: "not_contains", value: "BAD" }], []).passed
  ).toBe(false);
  const result = evaluateSavedFiles(
    [
      { file: "report.md", kind: "exists" },
      { file: "report.md", kind: "contains", value: "Moon" },
      { file: "report.md", kind: "min_chars", value: 4 }
    ],
    [{ name: "report.md", content: "Moon", sha256: "hash" }]
  );
  expect(result).toMatchObject({ passed: true, model_quality_assessed: false });
  expect(result.results.every((r) => r.evidence_sha256 === "hash")).toBe(true);
});
it.each([
  { file: "report.md", kind: "contains", value: "" },
  { file: "report.md", kind: "min_chars", value: "5" },
  { file: "report.md", kind: "exists", value: "unexpected" }
] as const)("rejects an ambiguous evaluation rule %j", (rule) => {
  expect(() => evaluateSavedFiles([rule], [])).toThrow("INVALID_EVALUATION_RULE");
});
