# Gemini delivery — received 3 November 2026

This reference branch preserves the complete file contents of the owner's ZIP.
It is a candidate delivery, not the current Kosmora runtime or a release.

- Drive file: https://drive.google.com/file/d/1eg3BqZacKW2erWc_whqB4rUXyj6LFDEe/view
- Archive: `kosmora-complete-3days-all-in-one-package.zip`, 1,173,642 bytes.
- Archive SHA256: `13f533f3c1edc75517d4bb110cd7515e953a98aecbb215e9f9e1470051aa3859`.
- 235 files, 3,714,154 uncompressed bytes. All 202 entries in the author's master
  manifest matched their declared size and SHA256 prefix.
- TypeScript parsed all 170 JS/TS source files without syntax errors. This is not
  a typecheck or proof of runtime integration.
- Known key-pattern scans found no matches, including six decoded shell-script
  payloads. No claim of a complete secret or security audit is made.
- Compared with accepted working source `1443d644`, 24 files differ, 210 are new
  and one is identical. Copying this tree wholesale would replace shared source.

## Initial independent checks

19 of 25 supplied component-suite scripts passed in the standalone archive on
Windows/Node 26, using the actual installed TypeScript transpiler and native
SQLite. Six could not complete because the patch delivery omits required base
files such as account-settings/privacy/archive.ts and desktop-state.cjs. This
does not establish six functional regressions: the archive is not a full repo.
The author's 25/25 statement is not independently reproduced by this run.
No paid model, live Drive/VPS request or owner-desktop action was used.

These scripts transpile small fixtures; passing them is distinct from the
complete workspace's typecheck, validation, authorization and runtime wiring.

## Confirmed adaptation requirements

- `dense-vector-semantic-search.ts` uses hashed n-gram random projections and
  eight hand-written synonym groups. Preserve it as a lexical approximation;
  do not advertise it as a learned multilingual semantic encoder.
- `ast-code-sandbox-verifier.ts` is a regex checker with node:vm execution, not
  an AST security sandbox. The existing isolated Code execution boundary remains
  authoritative. [Node's documentation](https://nodejs.org/api/vm.html#vm-executing-javascript)
  explicitly rules out node:vm as a security boundary for untrusted code.
- `saveWordReportToWorkspace` writes with fs.writeFileSync after resolving a
  supplied root; it does not use the live owner grant, exclusive create, final
  verification or native per-effect confirmation. Reuse the document-buffer
  generation through the current authorized workspace service instead.
- Automatic JSON repair must not produce executable tool commands or grants.
- Optional context heuristics must preserve current required-evidence and
  full-payload budgets. Existing applied migrations and the secret scanner must
  not be replaced with older counterparts from this package.
- The Multi-Agent component remains a reference; the owner scheduled it last.
- UI candidates remain references until the owner requests their visual changes.

Active adaptations and acceptance results belong on the integration branch,
separate from this preserved source. The original push scripts are delivery
artifacts, not instructions to run them or overwrite the active repository.
