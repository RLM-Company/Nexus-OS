# Cosmora private MVP — 4 October 2026

This release candidate stacks on PR #291. It prepares the owner's first usable chat/code/GitHub
workspace without spending the model balance. Live AI execution remains stopped.

## Available implementation

- Ordinary chats and projects: streaming, stop, restart recovery, saved history.
- Chat rename, Markdown export, reversible archive with restore from the sidebar.
- Safe answer Markdown: tables, code copying/download, answer copying/download; no raw HTML,
  remote image loading or code execution.
- UTF-8 code/text attachments; PDF/DOCX text extraction; PNG/JPEG history and provider-native wire
  format. Documents are stored as extracted text, not original binaries. No OCR/password documents.
- Up to four files, 8000 text characters/file, 24 KB combined attachment context. Documents up to
  2 MB/20 PDF pages; images up to 1 MB and bounded dimensions. Vision needs a verified model route.
- Server-persisted project materials: 4000-character instructions, version conflicts, owner isolation,
  run/work snapshots. Images attach to individual messages, not permanent project materials.
- Bounded recent-turn model context: full history stays stored; oversize current input fails before
  the model call. Earlier omitted turns are disclosed to the model.
- Actual GitHub reads through an owner/repository-bound private token; code import into an unsent
  chat; edits/new files; persisted review; separate branch and draft PR on explicit owner approval.
  No merge, reference update/delete or automatic retry of uncertain publication. Recovery reads
  reconcile the saved commit and PR without a second write.
- Optional free search: five source links/snippets, explicit search and explicit attachment. Search
  systems receive only the entered query. Complete pages and autonomous browser actions are absent.

## Acceptance boundary

Local free validation passes: formatting, secret scan, lint, strict TypeScript, 442 unit/API
tests, 13 deployment tests, 13 provider-connection tests, six secret-scanner tests, nine builds
and the isolated compatible-provider fixture. All 132 Chromium scenarios pass in the stable
full run with two workers. An earlier concurrent run timed out; the stable run used unchanged
source files throughout. GitHub Actions secrets/variables now select CheapVibeCode with one
attempt, no mock fallback and the emergency stop enabled.

Free checks use the real API/SQLite/UI with synthetic model/GitHub fixtures. Actual GitHub reads and
the private search service can be checked without model generation. Unit/fixture success does not
prove provider answer quality, billed prices, tools or vision.

After funding, perform an explicitly budgeted ordinary chat, project-material answer and bounded
Manager file task. Check response streaming, usage, saved history, stop/reload and file downloads.
To test GitHub writes through Cosmora, review one harmless change, resume the owner-controlled
stop and explicitly publish its draft PR. Review it in GitHub; merging remains a separate decision.

## Known limits

CheapVibeCode route pricing/privacy evidence and capability expiry must be reviewed before the
paid acceptance. Vision is currently unavailable in that selected Registry profile. Voice,
image/video/audio generation, arbitrary local execution, autonomous external tools, billing and
public multi-user launch are outside this private first release. Windows development continues
in its separate PR stack; the thin client uses the hosted interface.

No secrets are included in this document, Git history or release archive.
