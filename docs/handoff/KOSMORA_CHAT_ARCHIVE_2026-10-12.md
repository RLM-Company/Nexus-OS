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

## Live activation

Source `e757e19ddf3b80424d099ebf43ccc0353140b8b6` is active on the VPS as
`cosmora-alpha-app:chat-archive-e757e19`. The three-file web archive is 5,967 bytes,
SHA-256 `a496979f498d91a93d1ca39b63e693a6bbf1f4cdc7908b0d7ee512daf7c39057`.
The checksum and network-disabled production build passed. Activation exited 0,
web reached healthy and the Code/interface-kit HTTP checks returned 200. The script
verified identical API, owner-login and executor container IDs/start times before and
after activation. No migrations or model requests ran.

Live browser verification retained the session and all six chats. A real ZIP was
downloaded from the existing synthetic image-counting conversation. Its five entries
contained two messages, a manifest, README and one saved image; local unzip verified
the attachment's byte count and SHA-256 against the manifest. No test message or
production project was created. Project ZIP uses the same builder; project plain
exports were verified with local fixtures. Final unit count: nine cases passed,
including long-transcript asynchronous compression. Chromium count: seven passed
together, with the deliberate delayed-hash cancellation case described above.

Deployment/rollback material is under `/opt/cosmora/releases/chat-archive-e757e19`:
`activate.sh`, `deployctl.before`, `deployctl.next`, `overlay.yaml`, `build.log`.
Restore the previous wrapper and recreate only web to roll back. Previous static
chunks were retained for open tabs. Local release material is under
`2026-10-12/chat-archive-e757e19`. Visual proof and Gemini coordination screenshot:
`2026-10-12/kosmora-chat-archive/kosmora-live-chat-archive.png` and
`2026-10-12/kosmora-chat-archive/gemini-resumed.png`, outside the Git checkout.

Only the earlier `kosmora-base` snapshot has been pushed in this pass. No GitHub push
or PR of the newer Code/export/ZIP changes is claimed.
