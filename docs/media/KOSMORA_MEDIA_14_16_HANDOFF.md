# Kosmora — media blocks 14–16, isolated implementation

**Integration update 2026-10-09:** Current verification and final contracts are in
`docs/handoff/KOSMORA_SETTINGS_RESEARCH_MEDIA_INTEGRATION_2026-10-09.md`.
Production storage defaults to `/var/lib/cosmora/media`; explicit configuration may
override it. Owner-scoped asset deletion, transcription disconnect cancellation,
bounded browser recording and emergency-stop polling were added. Paid media remains
OFF and live provider acceptance is still unverified. Historical authoring notes
below are retained for provenance.

Source baseline: tracked archive `b15912d23ab15a99e38370e22e472faf28c99961`.
This feature adds **real protocol adapters** but **does not claim live provider acceptance**.
No paid media calls have been made. Text model configuration, work runtime, Policy Engine,
financial ledgers and video are unchanged.

## Behaviour

- **Images:** `POST /api/v1/media/images` queues a real `gpt-image-1` `images/generations`
  request. Output is a validated PNG byte buffer; only a successful full response becomes
  `done` and an authenticated first-party image/download URL. Never substitutes a prompt.
- **Speech-to-text:** `POST /api/v1/media/transcriptions` accepts validated, bounded webm/wav/mp4/mp3
  base64 JSON and uses multipart `/audio/transcriptions` with `gpt-4o-mini-transcribe`.
  The result is returned to an editable browser transcript, never sent as a chat message automatically.
  No input recording is saved by the server.
- **Text-to-speech:** `POST /api/v1/media/speech` uses `gpt-4o-mini-tts`, voice `alloy`, MP3 output.
  Audio controls, stop, download, and saved audio history are available. Browser
  `speechSynthesis` is an optional unsaved alternative, with no provider credential.
- **Browser transcription:** checks native SpeechRecognition/webkitSpeechRecognition availability;
  browser vendor services may process microphone data, so this is not represented as guaranteed
  offline transcription. Browser compatibility and microphone permission are required.
- **Jobs:** atomic filesystem JSON metadata and protected media blobs under an operator-selected
  persistent directory. The status flow is `queued → running → done|failed|cancelled`, with
  explicit cancellation/AbortController and no late-result resurrection. Interrupted jobs after
  restart become `failed/INTERRUPTED`; no automatic paid retries. Jobs and downloads are owner-scoped.
- **Fail closed:** media-capability registry is independent of chat route's `vision` flag.
  Static allowlist lists provider/model/specification for each capability. Readiness requires a
  storage directory, private media API key, operator opt-in and no process emergency stop.
  `X-Kosmora-Media-Consent: explicit` plus `explicit_paid_consent: true` are both required on
  paid POSTs. Only the pinned official HTTPS API origin is allowed and redirects are rejected.
  Server credentials are never serialized to the browser.

## Operator-only configuration (do not commit credentials)

```env
KOSMORA_MEDIA_DIR=/absolute/path/to/persistent-private-media-volume
KOSMORA_MEDIA_OPENAI_API_KEY=<server-secret>
KOSMORA_MEDIA_PAID_ENABLED=false
```

All three are **optional** and paid execution is **off by default**. For live media use,
review the operational budget, provider privacy terms and product financial authorization,
mount persistent storage with 0700 permissions, and explicitly set
`KOSMORA_MEDIA_PAID_ENABLED=true`. This switch is not a substitute for a broader spending
ledger or owner approval framework. When not set, `/media/capabilities` reports a reason,
and paid actions cannot start. Browser voice may still work independently.

API endpoints, all behind the existing global owner identity boundary:

| Method | Path | Function |
| --- | --- | --- |
| GET | `/api/v1/media/capabilities` | status / registered media models |
| POST | `/api/v1/media/images` | enqueue image, 2000-character prompt limit |
| POST | `/api/v1/media/speech` | enqueue MP3, 4096-character input limit |
| POST | `/api/v1/media/transcriptions` | recognize ≤1.5 MB audio, no stored input recording |
| GET | `/api/v1/media/jobs` | list owner's jobs |
| GET | `/api/v1/media/jobs/:id` | poll job state |
| DELETE | `/api/v1/media/jobs/:id` | cancel pending/running job |
| GET | `/api/v1/media/assets/:id?download=1` | private file or inline image/audio |

## Integration steps

1. Apply **module** diff, then **integration** diff, to the stated base (no PR merge).
2. Ensure deployment image includes the new modules; existing package names remain unchanged.
3. Set `KOSMORA_MEDIA_DIR` to a dedicated **persistent** path on the API container if paid media
   will be activated. Do not place user media in a public static folder or ephemeral build layer.
4. Keep paid disabled until financial authorization, media-secret provisioning, and smoke checks.
5. Run `pnpm --filter @cosmora/model-gateway typecheck && pnpm --filter @cosmora/api typecheck &&
   pnpm --filter @cosmora/web typecheck`, followed by the relevant `vitest` tests and browser smoke.
6. Test real credentials **only when permitted** using one explicit image and one bounded voice request;
   verify status, bytes, authenticated download, cancellation and record recovery after restart.

## Verification and remaining limits

- In this isolated environment a TypeScript parser/transpiler checked modified TS/TSX sources.
  Isolated *strict TypeScript* checking of the media gateway/store/service succeeded.
  An 8-case Node runtime fixture exercised the actual adapter/store/service on deterministic
  responses: disabled route, opt-in, exact API endpoint/redirect policy, PNG and MP3 persistence,
  owner isolation, transcription validation, cancellation late-result fence, restart recovery,
  non-asset rejection, and emergency stop.
- Repository `vitest` suites, full workspace typecheck/lint, Next build, Playwright and real
  media endpoints were **not** run: the archive contains no `node_modules`, and this container
  cannot fetch pnpm from npm (EAI_AGAIN). Included Vitest tests need running in integration CI.
- Media storage is designed for a single API process and dedicated persistent filesystem;
  multi-replica coordination, file retention/deletion, financial spend ledger, provider discovery,
  audio diarization, browser compatibility matrix and live price preflight are outside this patch.
  The UI discloses that price is unknown. Media execution must remain disabled until budget and
  authorization policies are addressed by integration owners. No video placeholder is introduced.

Official endpoints consulted:
[Images](https://platform.openai.com/docs/api-reference/images/create),
[Transcription](https://platform.openai.com/docs/api-reference/audio/createTranscription),
[Speech](https://platform.openai.com/docs/api-reference/audio/createSpeech).
