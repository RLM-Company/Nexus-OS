# Kosmora: user-selected interface patterns, 10 October 2026

The user's sixteen 21st.dev references are unified with the existing neutral Kosmora tokens, existing layout and pinned React/Next runtime. This delivery adds no dependencies, remote fonts, images or third-party runtime requests. Components are original implementations of the observed interaction patterns, not copied marketplace source. The supplied Switch and Shining Text snippets informed the respective accessible checkbox and CSS shimmer implementations.

Registry HTTP downloads returned 403; browser previews and official page-markdown descriptions were reviewed instead. Component code access requires a 21st API key; no access controls were bypassed. The andrewlu0 sidebar URL returns 404. Exact-source installation is not claimed.

| User reference                | Kosmora integration                                                                                              |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| andrewlu0/sidebar             | Missing reference; existing sidebar refined with common spacing and neutral active states                        |
| ln-dev7/dorpdown-navigation   | Brand mode menu and grouped descriptions, existing navigation preserved                                          |
| shadcn/dropdown-menu          | Mode/account popovers: shared radii, spacing, focus, outside/Escape closure                                      |
| jatin-yadav05/file-tree       | Neutral folder/file glyphs in real GitHub explorer                                                               |
| ddoemonn/tree-view            | ARIA tree, selection, expand/collapse, roving focus and arrow/Home/End keys                                      |
| ayushmxxn/code-block          | Existing chat code toolbar plus keyboard-accessible multi-file Work result tabs and copying                      |
| zanwei/ball-model-picker      | Neutral sphere motif in model selector; real configured models, explicit choice, persisted account preference    |
| jolbol1/switch                | Shared accessible switch for server-persisted Relay settings                                                     |
| preetsuthar17/shining-text    | Shared CSS shimmer for actual pending states; reduced motion supported                                           |
| theshanelevine/streaming-text | Live Markdown stream indicator, response actions and follow-up draft buttons; no artificial output delay         |
| kokonutd/pricing-table        | Reusable future plan comparison primitive; no invented plans, prices or payment flow                             |
| jahed/ai-chat-input           | Unified rounded input, integrated model control, existing attachments/voice/search/send/cancel preserved         |
| arunjdass/ai-planning         | Real Work steps, dependencies, waiting decisions and checkpoints                                                 |
| monolythdev/ai-agent-pipeline | Shared process timeline driven exclusively by backend task statuses, no simulated agent work or foreign branding |
| ibelick/system-message        | Shared info/warning/error/success banners wired to composer, settings and Work errors                            |
| educalvolpz/siri-orb          | Neutral CSS voice orb shown only during actual recording/transcription; preview explicitly labelled              |

The model picker reads the latest preference version before saving and sends only the accepted fields. Follow-up buttons append to the current draft; they never dispatch an AI request. File preview content remains escaped React text. The voice indicator never requests microphone access itself. Reduced-motion and forced-colour fallbacks cover added decorations. `/interface-kit` is a labelled component review surface, not fake production activity. Its model selector is the real account control.

## Useful additional references

1. A working sidebar reference replacing the deleted andrewlu0 page, if that exact appearance is important.
2. Document/library cards: file types, upload progress, citations and large-file preview.
3. Canvas split editor: artifact tabs, version history, comments and export.
4. Tables: dense data grid, filters, column settings and chart toolbar.
5. Compact project/agent cards and an empty state for each workspace.
6. Mobile navigation and an unobtrusive notification/toast pattern.

These can be screenshots or component links; prefer neutral variants and explicit source licensing. Billing prices/features and genuine reasoning/provider metadata require product/backend decisions, not visual references.

## Validation and deployment boundary

Source release: `5a5d8ba88ce8f1f4d5dff96bb784e49b932027cd`. Web archive SHA-256: `da3711d4b07db562d709e8ddfa40ff393682e000e77447fdcf967bc6af08cdbd`. The VPS successfully built `cosmora-alpha-app:interface-5a5d8ba` without network access; Docker image ID: `sha256:848357da77dcdf0e25f1358603b026aa306af8e43fc00093441fcdc7811dcd57`.

Type checking, lint, formatting, diff and secret checks passed. Web unit tests: 37 passed; real table-worker regression: 10 passed. Of 39 selected browser cases, 38 passed in the initial run; after HMR had settled, the remaining Work persistence case and six related checks passed together (7/7). This is evidence across two runs, not a claim of one 39/39 run. The five added interface cases cover fresh-version model preferences, keyboard tree navigation, file tabs/copying, reduced motion/mobile width, and the composer/voice popover.

A separate network-isolated container was started with the actual production API configuration, current model registry and a copy of the verified database backup. Its 34 migrations applied, authenticated health/chats/projects/personal-settings/media-capabilities reads returned 200, and the real registry exposed one streaming model. Relay remained disabled. No model, GitHub-write, microphone or payment request was dispatched.

**The interface and integrated API are active on the VPS.** After automatic approval review rejected the wider API/migration action, the user separately confirmed it (`lf`, Russian `да` typed with the English keyboard layout). Activation then completed with exit 0, healthy API/web, 34 migrations, authenticated health/chats/projects/personal-settings/usage/history-search/media-capabilities reads returning 200, and `EXISTING_DATA_PRESERVED`. The verified pre-upgrade database SHA-256 is `06e40d352595d161e0de14d90e5dae552892e6ca07b1aa19ff61a0473b2224ca`; it contained six general chats, thirty messages, fifteen runs, fifteen usage records, three identity sessions and one actor. Login, proxy and search were not restarted.

Deployment script: `/opt/cosmora/releases/5a5d8ba/activate.sh`; matching local revision: `2026-10-10/kosmora-design-release/activate.sh`, SHA-256 `243a531f18393111fe8d83392aa4c6074a68cd3aa58a317d65f7c36059754fe2`. The script uses a temporary read-only verification container with the existing private owner-session environment file; the API container itself intentionally does not contain that token. Before deployment, its active-work guard was corrected to recognise the actual terminal `succeeded` status; the rejected first attempt stopped before any production mutation. The successful execution included a verified SQLite/assets backup, rollback, health checks and comparison of every original row.

Live browser verification confirmed remembered login, existing chat count, the new composer, real configured model menu, persistence of model choice after reload, and the compact voice popover. Live screenshots are saved at `qa/kosmora-live-interface.jpg` and `qa/kosmora-live-model-picker.jpg`. The component gallery loaded at `/interface-kit`; `/github` loaded the authorised `RLM-Company/Nexus-OS` repository with its real branch list and 450 files in the new tree. No AI message, GitHub write or microphone recording was sent.

Live verification also found an API validation defect: Fastify's default coercion changed nullable model defaults into empty strings and nullable chat Relay overrides into `false`. Source fix `7d779b30c4a1c500f458a8ba358cc92bad6c856b` applies the existing strict TypeBox validator to these two account routes. Four actual-HTTP regression cases were added; all fourteen account/Relay tests, lint and type checks passed locally. The VPS built and tested the API fix without network access. Its API-only deployment completed with exit 0, another verified backup, and no new database migration or web restart. Returning to the default model then succeeded through the live browser and persisted after reload; the original default preference was restored and Relay stayed off. Final healthy images: API `cosmora-alpha-app:api-7d779b3`, web `cosmora-alpha-app:interface-5a5d8ba`, login unchanged on `cosmora-alpha-app:b21c2c7`.

The real OCI Code runner remains disabled: loading a workspace into a Docker read-only root filesystem requires a separate fix. Voice visuals reflect existing dictation/transcription; realtime voice and paid media are not claimed as delivered by this UI change. The pricing primitive is prepared for future real plan data.

## Workspace design follow-up

The user clarified that the design elements were already prepared. Source revision `ddbd27a3bd8887703b20a690527dfba415aca368` carries that design into the existing document library, table workbench, Canvas and Work panels without changing their placement or business logic. Controls now share the monochrome colour variables, radii, typography and touch sizes. Studio uses a quiet segmented navigation. The document library has an illustrated empty state and file icons; its primary upload action is explicit instead of the old `button:first-child` rule, which incorrectly emphasised unrelated actions. Canvas and table errors/notices use the existing accessible shared messages. Real busy statuses use the reduced-motion-aware indicator. Provider implementation details were removed from the library's unavailable-analysis copy, and the table upload label was made readable.

Validation for this follow-up: TypeScript and targeted ESLint passed; formatting and diff checks passed; **all 20 selected browser cases passed in one run** (Canvas, document library, data workbench, Studio files including mobile, and Work persistence). These use the local mock provider. The server production build passed with network access disabled. No paid AI request was sent in this follow-up.

**Workspace design release image:** `cosmora-alpha-app:workspace-ui-ddbd27a`. API remains `cosmora-alpha-app:api-7d779b3`, login remains `cosmora-alpha-app:b21c2c7`. Only web was recreated; the activation script verified the exact API/login container IDs and start timestamps remained unchanged. No database migration ran. Compose reported healthy web, and `/?surface=files` and `/interface-kit` returned 200. Live browser reload retained the remembered session and six existing chats, displayed the new library empty state and source-search badge, and switched successfully between documents and the renamed table uploader.

Release/rollback records: `/opt/cosmora/releases/ddbd27a/activate.sh`, `overlay.yaml`, `deployctl.before`, `deployctl.next`. Local deployment material is under `2026-10-10/kosmora-workspace-design`. The eight-file source archive is 27,513 bytes, SHA-256 `dc5fcde0583434364bf91970167502b70b24f624bbdad8ce9621da5ec597f778`; verification succeeded on the VPS before extraction. The web build retained previous static chunks for already-open browser tabs. A web-only rollback is built into activation.

Current visual proof: `qa/kosmora-live-studio-refined.jpg` and `qa/kosmora-live-tables-refined.jpg` show the live site; `qa/kosmora-library-refined.png` shows the local fixture with document search/export controls. No live project was created solely for Canvas verification; its real version/draft/export scenarios were covered by the local browser suite.

## Composer follow-up — current live web

User-requested source revision `534a3efb4dda9eb405a54801baf26346cf36ae44` removes Relay and the search control from the composer, puts model selection beside the redrawn paperclip on the left, and places dictation beside Send on the right. Chat settings/history management now open from the icon in the top-right corner; Relay remains persisted there and in personal settings. Its existing recovery actions were retained. Model/dictation popovers align to the appropriate side and fit the mobile viewport.

Right-clicking Send changes its icon to headphones; clicking it opens the browser voice assistant. Shift+F10 switches back on the focused voice button, and the settings menu offers an accessible/mobile entry. Opening/switching modes never starts recording or submits a message. Each explicit “Говорить” action recognises one phrase through browser speech recognition, uses the existing selected-model chat endpoint, and synthesises that turn's completed reply through the browser. The assistant does not replay earlier answers, deduplicates recognition events, stops microphone/synthesis on closing, bounds recording to 60 seconds and suppresses late callbacks. It blocks voice sends while the composer has unsent text/attachments or execution is stopped. No realtime vendor audio session or paid server transcription is implied; availability depends on the browser speech APIs.

Automatic naming was already implemented in the database (`titleFor(initialMessage)`); a speech-turn regression now confirms its immediate display and persistence after reload, alongside the existing normal-text naming/rename/archive test. No extra title-generation model request was added.

Validation: strict TypeScript, targeted ESLint, formatting/diff checks and the network-isolated production build passed. The first browser run passed 23/24 cases; a voice reload assertion failed during concurrent development HMR. After edits settled, the ten relevant composer/voice/history/component cases passed together, including an explicit chat-URL assertion, mobile popup bounds, zero requests/microphone starts on mode changes, one real local chat POST per recognised phrase despite duplicate recognition callbacks, synthesised reply, and suppression of late recognition after closing. Recognition/synthesis are test doubles and the local AI provider is mock; no live recording or paid AI request was sent in this update.

**Current live web image:** `cosmora-alpha-app:composer-534a3ef`. Its web-only activation completed with healthy status, HTTP checks returning 200, and exact API/login IDs/start times unchanged. API remains `cosmora-alpha-app:api-7d779b3`; login remains `cosmora-alpha-app:b21c2c7`; no migrations ran. Live browser verification confirmed the revised composer, Relay hidden inside settings, right-click icon switching, opening/closing the assistant with the real browser speech API detected, and restoration of normal send mode. Six existing chats and the remembered session remained visible.

Release/rollback: `/opt/cosmora/releases/534a3ef/activate.sh`, `overlay.yaml`, `deployctl.before`, `deployctl.next`; local material `2026-10-10/kosmora-composer-release`. Nine-file source archive: 35,033 bytes, SHA-256 `e1c51931bc25d01bf573d868ce55bbfdec2cd5dc9031e448c7b560191896478d`, verified on the VPS. Previous static chunks retained. Current live proof: `qa/kosmora-live-composer-revised.jpg`, `qa/kosmora-live-voice-assistant.jpg`; desktop/mobile fixture screenshots: `qa/kosmora-composer-revised-desktop.png`, `qa/kosmora-composer-revised-mobile.png`.
