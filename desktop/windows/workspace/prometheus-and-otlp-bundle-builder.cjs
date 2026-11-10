"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function formatLabels(labels = {}) {
  const entries = Object.entries(labels);
  if (entries.length === 0) return "";
  const body = entries
    .map(([k, v]) => `${k}="${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
    .join(",");
  return `{${body}}`;
}

/**
 * Zero-dependency Prometheus OpenMetrics Text Exposition (.prom) &
 * OpenTelemetry Protocol OTLP/JSON v1 (.otlp.json) Telemetry Bundle Builder.
 */
function buildPrometheusAndOtlpBundle(spec = {}) {
  const serviceName = spec.serviceName || "kosmora-os-kernel";
  const metrics = Array.isArray(spec.metrics) ? spec.metrics : [];

  const promLines = [];
  const otlpMetrics = [];

  for (const m of metrics) {
    const name = String(m.name || "kosmora_metric_total").replace(/[^a-zA-Z0-9_:]/g, "_");
    const type = m.type || "gauge";
    const help = m.help || `Telemetry metric ${name}`;
    const value = Number(m.value ?? 0);
    const labels = m.labels || {};

    promLines.push(`# HELP ${name} ${help}`);
    promLines.push(`# TYPE ${name} ${type}`);
    promLines.push(`${name}${formatLabels(labels)} ${value}`);

    otlpMetrics.push({
      name,
      description: help,
      unit: m.unit || "1",
      gauge: {
        dataPoints: [
          {
            asDouble: value,
            attributes: Object.entries(labels).map(([k, v]) => ({
              key: k,
              value: { stringValue: String(v) }
            }))
          }
        ]
      }
    });
  }

  promLines.push("# EOF");

  const otlpObj = {
    resourceMetrics: [
      {
        resource: {
          attributes: [{ key: "service.name", value: { stringValue: serviceName } }]
        },
        scopeMetrics: [
          {
            scope: { name: "kosmora.telemetry.exporter", version: "2.14.0" },
            metrics: otlpMetrics
          }
        ]
      }
    ]
  };

  return {
    prometheusText: promLines.join("\n") + "\n",
    otlpJson: JSON.stringify(otlpObj, null, 2) + "\n",
    metricCount: metrics.length
  };
}

function savePrometheusAndOtlpToWorkspace(workspaceDir, baseName, spec) {
  if (!workspaceDir || typeof workspaceDir !== "string") {
    throw new Error("WORKSPACE_REQUIRED");
  }
  const cleanBase = path
    .basename(baseName || "telemetry-snapshot")
    .replace(/\.(prom|otlp\.json|json)$/i, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_");
  const resolvedWorkspace = path.resolve(workspaceDir);

  const promPath = path.resolve(resolvedWorkspace, `${cleanBase}.prom`);
  const otlpPath = path.resolve(resolvedWorkspace, `${cleanBase}.otlp.json`);

  if (!promPath.startsWith(resolvedWorkspace + path.sep)) {
    throw new Error("PATH_TRAVERSAL_BLOCKED");
  }

  fs.mkdirSync(resolvedWorkspace, { recursive: true });
  const built = buildPrometheusAndOtlpBundle(spec);
  fs.writeFileSync(promPath, built.prometheusText, "utf8");
  fs.writeFileSync(otlpPath, built.otlpJson, "utf8");

  return {
    promPath,
    otlpPath,
    metricCount: built.metricCount,
    sha256: crypto
      .createHash("sha256")
      .update(built.prometheusText + built.otlpJson, "utf8")
      .digest("hex")
  };
}

module.exports = {
  buildPrometheusAndOtlpBundle,
  savePrometheusAndOtlpToWorkspace
};
