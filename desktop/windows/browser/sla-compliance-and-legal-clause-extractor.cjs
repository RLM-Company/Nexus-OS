"use strict";

/**
 * Koswork SLA Commitments, RPO/RTO & Compliance Certification Clause Extractor
 * (`desktop/windows/browser/sla-compliance-and-legal-clause-extractor.cjs`).
 *
 * Deepens Requirements #2, #3 & #5:
 * - Extracts uptime SLA percentages (`99.95%`, `99.99%`), RPO/RTO recovery targets
 *   (`RTO < 15 мин`, `RPO <= 5 min`), and security/privacy compliance certifications
 *   (`SOC 2 Type II`, `ISO/IEC 27001`, `GDPR`, `HIPAA`, `PCI DSS`, `ФЗ-152`) from
 *   vendor documentation snapshots with exact UTF-16 `[startUtf16..endUtf16]` offsets
 *   and distinct `pageDate`, `eventDate`, and `fetchedAt`.
 * - Compares vendor SLA commitments across multiple options while rejecting bare-link
 *   claims without a verbatim UTF-16 quote (`BARE_COMPLIANCE_LINK_REJECTED`).
 */

const CERTIFICATION_PATTERNS = [
  { canonical: "SOC 2 Type II", re: /\bSOC\s*2(?:\s+Type\s+(?:II|2))?/gi },
  { canonical: "ISO/IEC 27001", re: /\bISO(?:\/IEC)?\s*27001\b/gi },
  { canonical: "GDPR", re: /\bGDPR\b/gi },
  { canonical: "HIPAA", re: /\bHIPAA\b/gi },
  { canonical: "PCI DSS", re: /\bPCI[\s-]*DSS\b/gi },
  { canonical: "ФЗ-152", re: /(?:152-ФЗ|ФЗ-152)/gi }
];

function extractSlaCommitmentsAndLegalClauses(snapshot = {}) {
  const fullText = String(snapshot.fullTextUtf16 || snapshot.text || "");
  const uptimeCommitments = [];
  const recoveryObjectives = [];
  const certifications = [];

  // 1. Uptime SLA percentages: e.g. "SLA 99.95%", "аптайм 99.99%"
  const slaRe = /(?:SLA|аптайм|uptime|доступность)[^.\n]{0,40}?(\d{2}\.\d{1,3})\s*%/gi;
  let m;
  while ((m = slaRe.exec(fullText)) !== null) {
    const pct = Number(m[1]);
    const quote = m[0].trim();
    const startUtf16 = fullText.indexOf(quote, m.index);
    const endUtf16 = startUtf16 + quote.length;

    uptimeCommitments.push({
      uptimePct: pct,
      quote,
      startUtf16,
      endUtf16,
      url: snapshot.url || "",
      title: snapshot.title || "",
      pageDate: snapshot.pageDate || null,
      eventDate: snapshot.eventDate || null,
      fetchedAt: snapshot.fetchedAt || null
    });
  }

  // 2. RTO / RPO recovery objectives: e.g. "RTO < 15 мин", "RPO <= 5 минут"
  const rtoRpoRe = /\b(RTO|RPO)\s*(?:<|<=|до|не более|:|=)?\s*(\d+)\s*(мин|минут|min|minutes|сек|sec|ч|hours|hr)/gi;
  while ((m = rtoRpoRe.exec(fullText)) !== null) {
    const metric = m[1].toUpperCase();
    const rawVal = Number(m[2]);
    const unit = m[3].toLowerCase();
    const minutes =
      unit.startsWith("сек") || unit.startsWith("sec")
        ? Number((rawVal / 60).toFixed(2))
        : unit.startsWith("ч") || unit.startsWith("h")
          ? rawVal * 60
          : rawVal;
    const quote = m[0].trim();
    const startUtf16 = fullText.indexOf(quote, m.index);
    const endUtf16 = startUtf16 + quote.length;

    recoveryObjectives.push({
      metric,
      minutes,
      quote,
      startUtf16,
      endUtf16,
      url: snapshot.url || "",
      pageDate: snapshot.pageDate || null,
      eventDate: snapshot.eventDate || null,
      fetchedAt: snapshot.fetchedAt || null
    });
  }

  // 3. Compliance certifications
  for (const certDef of CERTIFICATION_PATTERNS) {
    certDef.re.lastIndex = 0;
    while ((m = certDef.re.exec(fullText)) !== null) {
      const quote = m[0];
      const startUtf16 = m.index;
      const endUtf16 = m.index + quote.length;
      certifications.push({
        certification: certDef.canonical,
        quote,
        startUtf16,
        endUtf16,
        url: snapshot.url || "",
        pageDate: snapshot.pageDate || null,
        eventDate: snapshot.eventDate || null,
        fetchedAt: snapshot.fetchedAt || null
      });
    }
  }

  return {
    url: snapshot.url || "",
    title: snapshot.title || "",
    pageDate: snapshot.pageDate || null,
    eventDate: snapshot.eventDate || null,
    fetchedAt: snapshot.fetchedAt || null,
    uptimeCommitments,
    recoveryObjectives,
    certifications
  };
}

function compareSlaCommitmentsAcrossVendors(vendorSubmissions = []) {
  const evaluatedVendors = [];
  const rejectedVendors = [];

  for (const item of vendorSubmissions || []) {
    const optionName = String(item?.optionName || "Vendor").trim();
    if (item?.bareLinkOnly || !item?.snapshot) {
      rejectedVendors.push({
        optionName,
        sourceUrl: item?.sourceUrl || "",
        code: "BARE_COMPLIANCE_LINK_REJECTED",
        reason: "Голая ссылка на страницу SLA/безопасности без UTF-16 выдержки не принимается."
      });
      continue;
    }

    const extracted = extractSlaCommitmentsAndLegalClauses(item.snapshot);
    const bestUptime =
      extracted.uptimeCommitments.length > 0
        ? extracted.uptimeCommitments.reduce((best, cur) =>
            cur.uptimePct > best.uptimePct ? cur : best
          )
        : null;

    const rto = extracted.recoveryObjectives.find((r) => r.metric === "RTO") || null;
    const rpo = extracted.recoveryObjectives.find((r) => r.metric === "RPO") || null;

    evaluatedVendors.push({
      optionName,
      bestUptimePct: bestUptime ? bestUptime.uptimePct : null,
      bestUptimeExcerpt: bestUptime,
      rtoMinutes: rto ? rto.minutes : null,
      rpoMinutes: rpo ? rpo.minutes : null,
      certifications: Array.from(
        new Set(extracted.certifications.map((c) => c.certification))
      ),
      certificationExcerpts: extracted.certifications,
      pageDate: item.snapshot.pageDate || null,
      eventDate: item.snapshot.eventDate || null,
      fetchedAt: item.snapshot.fetchedAt || null
    });
  }

  evaluatedVendors.sort(
    (a, b) => Number(b.bestUptimePct || 0) - Number(a.bestUptimePct || 0)
  );

  return {
    evaluatedCount: evaluatedVendors.length,
    rejectedCount: rejectedVendors.length,
    highestUptimeVendor: evaluatedVendors[0] ? evaluatedVendors[0].optionName : null,
    evaluatedVendors,
    rejectedVendors
  };
}

module.exports = {
  extractSlaCommitmentsAndLegalClauses,
  compareSlaCommitmentsAcrossVendors
};
