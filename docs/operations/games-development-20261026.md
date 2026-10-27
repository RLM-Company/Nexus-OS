# Games: browser game development

Owner clarification: Games is a game-development mode. Preset mini-game generation is a
separate convenience, not the whole product scope. Do not redesign chat/sidebar to implement it.

This increment adds custom Canvas 2D game projects. Work returns three source artifacts:
`scene.html`, `styles.css`, `game.js`. It preserves the existing policy, approval, cancellation,
idempotency, accounting and no automatic paid retry. Files are validated before publication.
Incomplete projects fail explicitly. No migration is needed.

Games opens the development tab by default. The previous arcade/memory/quiz prototypes are
available in a separate tab. Canvas stores a `kosmora.game-project.v1` JSON package with full
versions, draft recovery, import/download and conflict handling. File tabs edit each source;
an empty in-progress file stays editable but cannot run/export. The raw package is recoverable.

The host serializes static scene markup through the existing inert allowlist, removes scene
IDs/style elements and escapes CSS closing tags. Only the fixed launcher runs in the sandboxed
iframe (allow-scripts, no same-origin). Arbitrary project JavaScript runs in a dedicated worker,
receiving an OffscreenCanvas and bounded keyboard/pointer/frame messages. It has no DOM or
navigation. CSP denies network, external scripts, frames, objects and forms. Logs are text,
bounded and do not drive application actions. A nonresponsive worker is terminated; source edits
remove the running frame. Runs expire after ten minutes. This is browser isolation, not a
server sandbox with enforceable per-worker memory quotas.

ZIP export includes the exact source files, project.json, README and self-contained index.html.
It runs offline in a modern browser supporting OffscreenCanvas. index.html is a build snapshot;
editing raw files alone does not rebuild it. Import the changed package and export again.

This increment does not implement native engines/builds, asset upload pipelines, multiplayer,
publishing, or automatic repository synchronization. Those remain further game-development
work. Source parsing is structural validation, not proof of gameplay correctness; runtime
errors and console are shown to the owner.

Validation: contracts reject malformed/duplicate/path/byte-limit inputs; actual HTTP Work
accepts the new discriminator, keeps three artifacts/accounting and rejects missing files
without retry. Chromium covers custom source generation, empty-file recovery, editing,
v1/v2/reload, keyboard rendering, exact ZIP source and offline play, Worker DOM/network isolation,
markup/CSS breakout attempts, syntax/runtime errors and termination of infinite-loop code.
Existing preset games and Sites acceptance scenarios remain covered.
