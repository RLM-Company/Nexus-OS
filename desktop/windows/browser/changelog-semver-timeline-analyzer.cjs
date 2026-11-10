"use strict";

/**
 * Koswork SemVer Release Changelog & Breaking-Change Timeline Analyzer
 * (`desktop/windows/browser/changelog-semver-timeline-analyzer.cjs`).
 *
 * Deepens Requirements #2, #3 & #5:
 * - Extracts semantic version release blocks (`v1.0.0` .. `v4.2.0 (2026-11-01)`) from
 *   changelog pages with per-release `eventDate` (distinct from `pageDate` and `fetchedAt`),
 *   exact UTF-16 `[startUtf16..endUtf16]` offsets, CVE security identifiers, and
 *   breaking-change / deprecation markers.
 * - Compares feature/API claims across SemVer releases to detect when an older release's
 *   claim (`v3.x`) has been superseded or removed by a newer release (`v4.x`).
 */

function parseSemverTuple(verStr = "") {
  const m = String(verStr || "")
    .trim()
    .replace(/^v/i, "")
    .match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return [0, 0, 0];
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function compareSemverStrings(a = "", b = "") {
  const [aMaj, aMin, aPat] = parseSemverTuple(a);
  const [bMaj, bMin, bPat] = parseSemverTuple(b);
  if (aMaj !== bMaj) return aMaj - bMaj;
  if (aMin !== bMin) return aMin - bMin;
  return aPat - bPat;
}

function extractSemverReleaseChangelog(snapshot = {}) {
  const fullText = String(snapshot.fullTextUtf16 || snapshot.text || "");
  const headerRe =
    /(?:^|\n|\s)(v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\s*(?:\(|—|-|от)?\s*(\d{4}-\d{2}-\d{2})?\s*\)?/g;

  const headers = [];
  let m;
  while ((m = headerRe.exec(fullText)) !== null) {
    const version = m[1].startsWith("v") ? m[1] : `v${m[1]}`;
    const releaseEventDate = m[2] || snapshot.eventDate || null;
    const matchText = m[0].trim();
    const startIdx = fullText.indexOf(matchText, m.index);
    headers.push({
      version,
      releaseEventDate,
      headerStartUtf16: startIdx >= 0 ? startIdx : m.index
    });
  }

  const releases = [];
  for (let i = 0; i < headers.length; i += 1) {
    const cur = headers[i];
    const nextStart =
      i + 1 < headers.length ? headers[i + 1].headerStartUtf16 : fullText.length;
    const blockQuote = fullText.slice(cur.headerStartUtf16, nextStart).trim();
    const startUtf16 = cur.headerStartUtf16;
    const endUtf16 = startUtf16 + blockQuote.length;

    const hasBreakingChange =
      /BREAKING\s+CHANGE|несовместим|удален|deprecated|устарел/iu.test(blockQuote);
    const cveMatches = blockQuote.match(/\bCVE-\d{4}-\d{4,7}\b/gi) || [];

    releases.push({
      version: cur.version,
      eventDate: cur.releaseEventDate,
      pageDate: snapshot.pageDate || null,
      fetchedAt: snapshot.fetchedAt || null,
      url: snapshot.url || "",
      quote: blockQuote,
      startUtf16,
      endUtf16,
      hasBreakingChange,
      cves: Array.from(new Set(cveMatches.map((c) => c.toUpperCase())))
    });
  }

  releases.sort((a, b) => compareSemverStrings(b.version, a.version));

  return {
    url: snapshot.url || "",
    title: snapshot.title || "",
    pageDate: snapshot.pageDate || null,
    fetchedAt: snapshot.fetchedAt || null,
    latestVersion: releases[0] ? releases[0].version : null,
    releasesCount: releases.length,
    releases
  };
}

function verifyBreakingChangesAndDeprecationsAcrossVersions({
  snapshot = {},
  featureKeyword = ""
} = {}) {
  const parsed = extractSemverReleaseChangelog(snapshot);
  const kwLower = String(featureKeyword || "").trim().toLowerCase();

  const matchingReleases = parsed.releases.filter((r) =>
    !kwLower ? true : r.quote.toLowerCase().includes(kwLower)
  );

  if (matchingReleases.length === 0) {
    return {
      found: false,
      status: "feature_not_mentioned_in_changelog",
      latestRelease: null,
      supersededReleases: []
    };
  }

  const newest = matchingReleases[0];
  const older = matchingReleases.slice(1);

  return {
    found: true,
    status:
      older.length > 0 && newest.hasBreakingChange
        ? "SUPERSEDED_BY_NEWER_SEMVER_RELEASE"
        : "ACTIVE_IN_LATEST_SEMVER_RELEASE",
    latestRelease: newest,
    supersededReleases: older
  };
}

module.exports = {
  compareSemverStrings,
  extractSemverReleaseChangelog,
  verifyBreakingChangesAndDeprecationsAcrossVersions
};
