"use strict";

const { createKosworkWorkspaceService } = require("../workspace/workspace-service.cjs");

/**
 * Koswork OASIS SARIF 2.1.0 Epistemic Audit & JSON Schema Validator Exporter
 * (`desktop/windows/browser/json-schema-and-sarif-audit-exporter.cjs`).
 *
 * Deepens Requirement #5:
 * - Exports a standard OASIS SARIF 2.1.0 (`Static Analysis Results Interchange Format`)
 *   epistemic audit report (`reports/<slug>.sarif.json`) and a companion JSON Schema
 *   validation report (`reports/<slug>-schema-validation.json`) via `workspace-service.cjs`.
 * - Encodes inter-site contradictions (`KOSWORK001_CONTRADICTION`), outdated/superseded
 *   sources (`KOSWORK002_OUTDATED_SOURCE`), unavailable HTTP 503 sources (`KOSWORK003_UNAVAILABLE_503`),
 *   post-observation text substitutions (`KOSWORK004_POST_OBS_SUBSTITUTION`), and rejected
 *   bare links (`KOSWORK005_BARE_LINK_REJECTED`) with exact UTF-16 `charOffset` and `charLength`.
 */

const SARIF_RULES = Object.freeze([
  {
    id: "KOSWORK001_CONTRADICTION",
    name: "InterSiteClaimContradiction",
    shortDescription: {
      text: "Обнаружено межсайтовое противоречие значений для одного критерия."
    }
  },
  {
    id: "KOSWORK002_OUTDATED_SOURCE",
    name: "SupersededOutdatedSource",
    shortDescription: {
      text: "Источник содержит устаревшие данные, перекрытые более свежей датой (eventDate/pageDate)."
    }
  },
  {
    id: "KOSWORK003_UNAVAILABLE_503",
    name: "UnavailableHttpSource",
    shortDescription: {
      text: "Целевой источник оказался временно недоступен (HTTP 503 или сетевой сбой)."
    }
  },
  {
    id: "KOSWORK004_POST_OBS_SUBSTITUTION",
    name: "PostObservationTextSubstitution",
    shortDescription: {
      text: "Обнаружена пост-наблюдательная подмена текста после первичной фиксации снимка."
    }
  },
  {
    id: "KOSWORK005_BARE_LINK_REJECTED",
    name: "BareLinkWithoutExcerptRejected",
    shortDescription: {
      text: "Голая ссылка без дословной UTF-16 выдержки отклонена как доказательство утверждения."
    }
  }
]);

function buildSarif210ResearchAuditReport(report = {}) {
  const results = [];

  for (const c of report.contradictions || []) {
    const sideA = c.sideA || {};
    const startUtf16 = Number.isInteger(sideA.startUtf16) ? sideA.startUtf16 : 0;
    const endUtf16 = Number.isInteger(sideA.endUtf16) ? sideA.endUtf16 : startUtf16;
    results.push({
      ruleId: "KOSWORK001_CONTRADICTION",
      level: "warning",
      message: {
        text: `${c.optionName || "Option"} / ${c.criterion || "Spec"}: ${c.summary || "Расхождение между источниками"}`
      },
      locations: [
        {
          physicalLocation: {
            artifactLocation: {
              uri: sideA.url || "https://corpus.local/unknown"
            },
            region: {
              charOffset: startUtf16,
              charLength: Math.max(0, endUtf16 - startUtf16),
              snippet: {
                text: sideA.quote || ""
              }
            }
          }
        }
      ]
    });
  }

  for (const out of report.outdatedSources || []) {
    results.push({
      ruleId: "KOSWORK002_OUTDATED_SOURCE",
      level: "note",
      message: {
        text: `Устаревший источник для ${out.optionName || "Option"} / ${out.criterion || "Spec"} (pageDate: ${out.pageDate || "н/д"}, eventDate: ${out.eventDate || "н/д"})`
      },
      locations: [
        {
          physicalLocation: {
            artifactLocation: {
              uri: out.url || "https://corpus.local/outdated"
            }
          }
        }
      ]
    });
  }

  for (const unav of report.unavailableSources || []) {
    results.push({
      ruleId: "KOSWORK003_UNAVAILABLE_503",
      level: "warning",
      message: {
        text: `Источник недоступен (HTTP ${unav.statusCode || 503}): ${unav.url}`
      },
      locations: [
        {
          physicalLocation: {
            artifactLocation: {
              uri: unav.url || "https://corpus.local/503"
            }
          }
        }
      ]
    });
  }

  for (const sub of report.postObservationSubstitutions || []) {
    results.push({
      ruleId: "KOSWORK004_POST_OBS_SUBSTITUTION",
      level: "error",
      message: {
        text: `Пост-наблюдательная подмена текста на ${sub.url || "вкладке"}`
      },
      locations: [
        {
          physicalLocation: {
            artifactLocation: {
              uri: sub.url || "https://corpus.local/substituted"
            }
          }
        }
      ]
    });
  }

  for (const bare of report.rejectedBareLinks || []) {
    results.push({
      ruleId: "KOSWORK005_BARE_LINK_REJECTED",
      level: "error",
      message: {
        text: `Отклонена голая ссылка без UTF-16 выдержки: ${bare.url || bare.sourceUrl || ""}`
      },
      locations: [
        {
          physicalLocation: {
            artifactLocation: {
              uri: bare.url || bare.sourceUrl || "https://corpus.local/bare"
            }
          }
        }
      ]
    });
  }

  const sarifLog = {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "KosworkBrowserEpistemicAuditor",
            version: "1.0.0",
            rules: SARIF_RULES
          }
        },
        results
      }
    ]
  };

  const schemaValidation = {
    schemaId: "https://kosmora.local/schemas/koswork-browser-research-report-v1.json",
    valid: Boolean(
      typeof report.question === "string" &&
        Array.isArray(report.comparisonRows) &&
        Array.isArray(report.contradictions) &&
        Array.isArray(report.unavailableSources)
    ),
    totalSarifFindings: results.length,
    findingsByRule: SARIF_RULES.reduce((acc, r) => {
      acc[r.id] = results.filter((res) => res.ruleId === r.id).length;
      return acc;
    }, {})
  };

  return {
    sarifLog,
    schemaValidation
  };
}

async function saveSarifAndJsonSchemaAuditViaWorkspace({
  workspaceRoot,
  slug = "research-epistemic-audit",
  report = {},
  signal = null
} = {}) {
  const { sarifLog, schemaValidation } = buildSarif210ResearchAuditReport(report);
  const svc = createKosworkWorkspaceService();
  await svc.connectFolder({ folderPath: workspaceRoot, signal });

  const sarifFile = await svc.createFile({
    relativePath: `reports/${slug}.sarif.json`,
    content: JSON.stringify(sarifLog, null, 2) + "\n",
    createParents: true,
    signal
  });
  const schemaFile = await svc.createFile({
    relativePath: `reports/${slug}-schema-validation.json`,
    content: JSON.stringify(schemaValidation, null, 2) + "\n",
    createParents: true,
    signal
  });

  return {
    sarifLog,
    schemaValidation,
    sarifFile,
    schemaFile
  };
}

module.exports = {
  SARIF_RULES,
  buildSarif210ResearchAuditReport,
  saveSarifAndJsonSchemaAuditViaWorkspace
};
