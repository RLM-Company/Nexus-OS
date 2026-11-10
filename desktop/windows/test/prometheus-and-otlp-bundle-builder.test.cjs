"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  buildPrometheusAndOtlpBundle,
  savePrometheusAndOtlpToWorkspace
} = require("../workspace/prometheus-and-otlp-bundle-builder.cjs");

test("Prometheus OpenMetrics & OTLP/JSON v1 Builder emits valid exposition text and OTLP envelopes", () => {
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "kosmora-prom-otlp-"));

  const built = buildPrometheusAndOtlpBundle({
    serviceName: "kosmora-kernel",
    metrics: [
      {
        name: "kosmora_raft_commits_total",
        type: "counter",
        help: "Total Raft quorum commits",
        value: 128,
        labels: { node: "node-a", region: "eu" }
      }
    ]
  });

  assert.equal(built.metricCount, 1);
  assert.match(built.prometheusText, /# HELP kosmora_raft_commits_total/);
  assert.match(built.prometheusText, /kosmora_raft_commits_total\{node="node-a",region="eu"\} 128/);

  const otlp = JSON.parse(built.otlpJson);
  assert.equal(otlp.resourceMetrics[0].scopeMetrics[0].metrics.length, 1);

  const saved = savePrometheusAndOtlpToWorkspace(workspaceDir, "kernel-metrics", {
    metrics: [{ name: "kosmora_up", value: 1 }]
  });

  assert.equal(fs.existsSync(saved.promPath), true);
  assert.equal(fs.existsSync(saved.otlpPath), true);
  assert.equal(saved.sha256.length, 64);

  assert.throws(() => {
    savePrometheusAndOtlpToWorkspace("", "invalid", {});
  }, /WORKSPACE_REQUIRED/);
});
