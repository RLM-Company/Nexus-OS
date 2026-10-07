# Kosmora demo design pass — 2026-10-07

The owner login and every workspace now share a light monochrome palette. The brand disclosure selects Chat, Work or Code; Work/Code no longer occupy the ordinary tools list. Switching modes preserves the current chat and its draft. New chat remains an explicit fresh conversation action.

## Visual direction

References inspected visually:

- [AI Chat UI on Pinterest](https://in.pinterest.com/thalavaisankar7/ai-chat-ui/) and [compact composer/tool menu](https://in.pinterest.com/pin/860609810085011912/): one composer surface, unobtrusive tool icons, short menu rows.
- [Kimi](https://www.kimi.com/en/): neutral surfaces, generous conversation width, quiet secondary controls.
- [Claude product overview](https://claude.com/product/overview): restrained typography and a clear primary action.

The implementation uses Kosmora's selected helmet artwork and neutral grays. No third-party artwork or branding is included.

## Interface changes

- Login: white 408px card on a neutral background, 24px title, 44px controls; desktop connection screen follows the same scale.
- Shell: 244px sidebar, 64px desktop header, 704px conversation width, new-chat heading capped at 24px.
- Composer: one subtle outer border, no inner textarea outline or focus shadow; keyboard focus remains visible on controls.
- Studio: compact tool tiles. Skills and apps: aligned rows with actions. Work: compact metrics and project list. Code/media: consistent forms and outputs.
- Settings: navigation column, grouped rows and monochrome switches. Files, project context and standalone GitHub/Skills/Agent Studio/Control Center/model pages use consistent spacing and type.
- Transitions: short opacity/4px movement and neutral hover states, suppressed for reduced-motion preferences. Native disclosure and dialog retain keyboard behavior.

## Validation and boundaries

Initial local gate: production build, web lint/typecheck, 13 unit tests, 8 owner-access tests, desktop checks, secret scan and 45 targeted Chromium tests passed. New mode tests cover Escape/focus, draft preservation, reload and mobile navigation.

Final audit fixes: project/view scope survives mode reload; the Code GitHub action occupies the text column instead of the icon column; login microcopy contrast is increased. An additional 27 Chromium tests passed for project draft restoration, context isolation/dialogs, invalid routes, files/CSV and workspace modes.

The production preview was inspected at desktop and 390px mobile widths. A duplicate arrow on the Code GitHub action was removed. The older PWA and keyboard audits now exercise the brand disclosure, including Enter/Tab selection, focus return and the absence of Work/Code in ordinary tools. Those two audits and the Code-to-GitHub navigation test passed together.

The full design passed GitHub CI (179 Chromium tests, 473 Vitest tests and the deployment/profile gates) and the Windows install/upgrade lifecycle. The live rollout confirmed owner access, SQLite health and paused model execution. Live visual inspection then identified Chrome's blue autofill background; login and desktop connection styles now cover autofill, hover and focus with neutral fills while retaining keyboard focus. The follow-up passed 8 owner-access and 15 desktop checks.

This is a presentation/design update. Live paid model tests and provider funding remain deferred. Authentication, persistent data, GitHub permissions and the server's model execution stop must remain intact during rollout.
