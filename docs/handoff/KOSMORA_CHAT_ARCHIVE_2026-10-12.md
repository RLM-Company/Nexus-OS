# Kosmora chat ZIP archives — 12 October 2026

Chat settings now offer `Архив с вложениями (.zip)` alongside Markdown and JSON.
ZIP contains both transcript formats, a manifest, a Russian README and saved
attachments. The manifest links each file to its message, records the original name,
stored representation, UTF-8/binary byte count and SHA-256. Numbered safe paths preserve
duplicates and Unicode. User/assistant messages are included; system events, internal
run metadata and unsent drafts are excluded.

PDF/DOCX are exported as their saved extracted text, all other text files as `.txt`.
Images are the stored version, which may have been resized during upload. No original
document/image recovery is claimed. Individual attachment downloading already existed;
this change supplies one archive for a whole conversation. It is not chat import.

Everything runs on the user's device. ZIP code loads only on explicit selection and
download. Compression uses fflate's asynchronous API, with no new dependency or
external service. A 25 MiB uncompressed budget and 300-attachment limit reject the
whole operation explicitly rather than silently dropping files. Invalid saved
attachments similarly fail the archive; plain exports stay available. Cancellation
aborts pending work and suppresses late downloads; unmount also aborts.

Validation: ZIP round-trip/image/Unicode/hash/duplicate-name/system-event cases,
invalid images/traversal/size/count gates, no-attachment archive and cancellation.
Seven Chromium cases passed together: ordinary/project plain formats, mobile width,
empty history, actual ZIP content, corrupt attachment recovery, cancellation with
a deliberately delayed browser hash and existing Markdown/history actions. The tests
use local API fixtures and no paid AI request. TypeScript, scoped ESLint, formatting
and secret scan passed. Live activation is recorded after server confirmation.

## Coordination

The exact earlier snapshot `0182e6a612e2c1572be186995463f00857e304b7` was published
to the private GitHub repository as `kosmora-base`, and its ref was confirmed through
GitHub API. No force push, default-branch update or merge ran. Gemini received the
verified branch link and instructions to complete the original four feature blocks
in a separate branch, preserving existing migrations, accounting, streaming and the
coordinator's newer Code executor/transcript changes. Task receipt and restoration
activity were observed; completion of Gemini's four blocks is not claimed.
