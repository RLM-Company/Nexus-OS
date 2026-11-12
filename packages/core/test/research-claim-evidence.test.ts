import { describe, expect, it } from "vitest";
import {
  researchEvidence,
  verifyResearchClaim,
  type ResearchRun,
  type ResearchClaimCheckInput
} from "../src/research/index.js";

const run = (snapshot: string): ResearchRun => ({
  id: "r1",
  owner_id: "a",
  actor_id: "a",
  project_id: "p1",
  question: "Цена",
  status: "completed",
  stage: "",
  candidates: [],
  next_index: 0,
  sources: [
    {
      title: "Прайс",
      url: "https://example.test/price",
      snippet: "",
      status: "read",
      passages: [snapshot],
      checked_at: "2026-11-12T10:00:00Z",
      content_digest: "digest-v1"
    }
  ],
  attempts: 1,
  error_code: null,
  answer: null,
  created_at: "2026-11-12T10:00:00Z",
  updated_at: "2026-11-12T10:00:00Z"
});

const base = (
  snapshot: string,
  extra: Partial<ResearchClaimCheckInput> = {}
): ResearchClaimCheckInput => ({
  evidence: researchEvidence(run(snapshot))[0]!,
  claim_text: "Цена Alpha: 50 рублей.",
  expected_value: "50",
  expected_unit: "рублей",
  trusted_page_version: "E1",
  cited_page_version: "E1",
  trusted_snapshot_digest: "digest-v1",
  cited_snapshot_digest: "digest-v1",
  ...extra
});

describe("verifyResearchClaim: negative regressions from REWORK_TASK", () => {
  it("rejects '50' when the trusted excerpt says 5000 рублей", () => {
    const report = verifyResearchClaim(base("Цена Beta: 5000 рублей."));
    expect(report.claim_assessment).toBe("unconfirmed");
    expect(report.source_quote_verified).toBe(false);
  });

  it("rejects an excerpt about Beta when the claim is about Alpha", () => {
    const report = verifyResearchClaim(
      base("Цена Beta: 5000 рублей.", {
        claim_text: "Цена Alpha: 5000 рублей.",
        expected_value: "5000"
      })
    );
    expect(report.claim_assessment).toBe("unconfirmed");
    expect(report.reason).toContain("отсутствует в доверенной выдержке");
  });

  it("rejects a citation with a different page version", () => {
    const report = verifyResearchClaim(
      base("Цена Alpha: 50 рублей.", { cited_page_version: "different-version" })
    );
    expect(report.claim_assessment).toBe("unconfirmed");
    expect(report.reason).toContain("доверенному снимку/версии");
  });

  it("rejects a digest supplied by the client/model", () => {
    const report = verifyResearchClaim(
      base("Цена Alpha: 50 рублей.", { cited_snapshot_digest: "model-invented" })
    );
    expect(report.claim_assessment).toBe("unconfirmed");
  });

  it("rejects the same number with a different unit", () => {
    const report = verifyResearchClaim(
      base("Цена Alpha: 50 долларов.", {
        claim_text: "Цена Alpha: 50 долларов.",
        expected_unit: "рублей"
      })
    );
    expect(report.claim_assessment).toBe("unconfirmed");
  });

  it("rejects a negation as unconfirmed, not invented verified", () => {
    const report = verifyResearchClaim(
      base("Цена Alpha: 50 рублей, кроме доставки.", {
        claim_text: "Цена Alpha: 50 рублей, кроме доставки."
      })
    );
    expect(report.claim_assessment).toBe("unconfirmed");
  });

  it("verifies an exact value with its unit and trusted version", () => {
    const report = verifyResearchClaim(base("Цена Alpha: 50 рублей."));
    expect(report.claim_assessment).toBe("verified");
    expect(report.source_quote_verified).toBe(true);
  });

  it("separates quote verification from claim assessment", () => {
    const report = verifyResearchClaim(base("Цена Alpha: 50 рублей."));
    expect(Object.keys(report).sort()).toEqual([
      "claim_assessment",
      "reason",
      "source_quote_verified"
    ]);
    expect(report.reason).not.toContain("истина");
  });
});
