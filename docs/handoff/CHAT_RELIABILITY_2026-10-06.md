# Ordinary chat reliability — 6 October 2026

Branch: `codex/chat-reliability-20261006`, starting at
`fc6a391a3f0b4d79d608d9ecbfb64d799a566a37`. Draft PR targets
`codex/studio-files-clean-composer-20261004` (#311). The original integrated checkout was
not modified. Integration points are listed in root `DEPENDENCIES.md`.

## Implemented behavior and acceptance criteria

- Text and prepared attachments survive reload and closing/reopening a tab in the same
  browser profile. Keys separate new chat, each ordinary chat and each project. Ordinary
  selection is restored from `?chat=<id>`; project routes retain their existing semantics.
- Removing a chip persists removal. Successful server acceptance clears the sent draft.
  Rejected sends preserve text/files. Text is retained during the pending request instead
  of being erased before acceptance. Starting a new chat while already in the unnamed
  composer explicitly discards that unnamed draft. Navigating away from a named chat or
  project retains its draft. No restoration triggers an automatic model request.
- Material restoration validates the existing attachment contract. Damaged or missing
  material records cannot hide independently stored text. Recovery/storage errors appear
  beside the paperclip only when applicable; there are no new permanent technical banners.
- Photo preparation is a separate module. PNG/JPEG inputs up to 20,000,000 bytes,
  12,000 pixels per edge and 48,000,000 pixels total are checked before decoding. Images
  exceeding the existing wire bounds are resized with preserved aspect ratio and EXIF
  orientation. A working edge of 2800 pixels is reduced as needed to fit 1,000,000 bytes,
  4096 pixels per edge and 8,000,000 pixels total. PNG stays PNG with transparency; JPEG
  uses quality 0.88. Files are processed sequentially and late reads are invalidated when
  scope changes. Existing thumbnails, removal and upload contracts remain in place.
- Reload/network interruption follows the existing server-owned run. EventSource retries
  the same read-only events URL; history polling still reconciles terminal state. It never
  submits input again. A replay's sequence-zero delta replaces the stream accumulator.
  Terminal events and accepted sends invalidate older snapshots. Longer received content
  survives stale streaming snapshots. Epoch guards reject old reads/streams after changing
  chat or promoting to a project.
- Rename/archive/restore, large Markdown/code rendering, code/answer copying and downloads
  use existing implementations; the checked scenarios did not identify another defect.

## Bounded browser storage

`composer-draft-storage.ts` uses localStorage on the existing private application origin:

- text remains in `cosmora:composer-draft:<scope>` for compatibility with existing drafts;
- versioned attachment/timestamp records use `cosmora:composer-materials:<scope>`;
- at most 20 draft scopes, 4,000,000 UTF-16 code units across keys/values and 128,000 text
  code units per draft; records expire after 30 days;
- expired/oldest scopes are removed before a write that would exceed count/size bounds;
  unrelated feature keys are never evicted; legacy raw-text drafts remain readable;
- text is written before larger material records. On browser quota failure, the current
  text/files remain in the tab, text is persisted when possible, stale material is removed
  and the UI reports incomplete persistence. Browser quotas may be smaller than our cap.

This is local browser persistence, not server backup or cross-device sync. Clearing site
data deletes drafts; private mode, denied storage and browser quota can prevent persistence.
Multiple tabs share keys and use the latest successful write. Original small images that
already meet wire bounds retain their original bytes/metadata; resized photos are reencoded.
Draft storage is not a new authentication boundary or a multi-user service.

## Real validation

- Full repository lint and strict TypeScript passed; web checks rerun after final UI changes.
- All 447 unit/API tests passed (442 existing plus five bounded-storage tests).
- All 39 selected Chromium scenarios passed in the final unchanged-source run with two
  workers against isolated mock API/SQLite and Next dev servers on 3437/3337. This includes
  ordinary-chat cancellation after reload and a stale pre-completion snapshot. The two
  draft recovery scenarios additionally passed three repetitions each after correction.
- Storage tests cover scope isolation, clearing, legacy/corrupt material, quota fallback,
  entry/size eviction, unrelated keys, expiry and oversized text without truncation.
- Browser scenarios cover closing/reopening drafts, project isolation, chip removal,
  accepted/rejected sends, a synthetic 4032x3024 JPEG above 1 MB, thumbnail persistence,
  unsafe dimensions, reload/offline recovery with exactly one POST and one user/assistant
  message, old-view reads, complete large Unicode Markdown/code copy/download,
  rename/archive/restore, project cancellation and existing execution gates.
- Existing Studio selected-part transfer, PDF/DOCX extraction and mobile scenarios pass
  without decoder or Studio changes. Mobile composer screenshot at 390x844 was inspected.
- Repository formatting, whitespace diff check and secret scan passed.

The first targeted runs exposed unnamed-new-chat attachment restoration and an initially
enabled composer before URL hydration; both were corrected and their scenarios passed.
An added cancellation fixture initially matched an exact model prompt and missed the
appended attachment context; the fixture now matches its controlled prompt prefix.
The editor also waits for draft-scope hydration. Recovery warnings survive strict-mode
reconciliation; the corrupt-storage fixture is installed before app initialization so
live autosave cannot race the fixture setup. No source changed during the final 39-test run.

## Reproduce and remaining boundary

Install with `pnpm install --frozen-lockfile`, then run:

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @cosmora/web exec playwright test -c playwright.chat-reliability.config.ts chat-reliability.spec.ts composer-draft-restart.spec.ts chat-history-markdown.spec.ts chat-text-attachments.spec.ts chat-document-attachments.spec.ts b0.1.spec.ts console-persistence.spec.ts manager-console-races.spec.ts chat-execution-gate.spec.ts studio-files.spec.ts
pnpm build
```

Check listening ports before starting. The isolated configuration refuses existing servers
and creates `apps/api/data/chat-reliability-<runner pid>.db`. It explicitly selects the mock
provider and does not load `.env`. Other existing E2E files hardcode API port 3100, so the
complete default E2E suite was not run or claimed on these alternate ports.

No live paid AI, payments, production/secret changes, deployment or main merge. Photo storage
and preparation do not prove vision support; unavailable vision routes keep their existing
failure behavior. PNG/JPEG are supported, HEIC/RAW/OCR are not. Device Safari/Firefox and a
real phone EXIF fixture were not tested; Chromium mobile viewport and synthetic JPEG were.
The integration owner still needs PR review/integration and any separately authorized live
provider acceptance. The shared API/Studio/GitHub/Windows workstreams remain separate.
