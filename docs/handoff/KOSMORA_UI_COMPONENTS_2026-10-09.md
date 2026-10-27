# Kosmora — component polish, 9 October 2026

The sidebar, mode selection, chat, composer, Studio and repository workflow retain their existing layout. This change refines monochrome controls and states, with short transitions and reduced-motion/forced-colors support.

Visual references: [21st.dev component catalog](https://21st.dev/community/components), [Claude-style Chat Input by Saifullah Channa](https://21st.dev/@sensewood8/components/claude-style-chat-input), and the provided [video catalog](https://21st.dev/community/video). The 21st metadata reports the selected composer's license as unknown. No third-party component source was copied and no registry install or paid library access was used. The implemented controls and CSS are original adaptations of familiar interface patterns, with existing Kosmora icons and dependencies.

Reusable `ui/feedback.tsx` exports StatusPill, LoadingDots, ProgressBar, EmptyState and Skeleton for the next Canvas, Data, Work and media modules. ProgressBar clamps real values and represents unknown progress as indeterminate. Unconnected features are not added to navigation. These components are ready to import, not promises of an operational backend.

Functional changes: drag/drop through the same bounded attachment parser; Enter does not submit during IME composition; GitHub import selects the actual chat rather than hiding the prepared draft in Code; composer grows to a bounded height; streaming stops pulling the reader down after they scroll up; code/diff blocks preserve exact copy/download content while presenting line numbers and neutral added/removed markers. Copy feedback resets after two seconds; unavailable clipboard reports failure. Diffs download as `.patch` without silently modifying model output. Automatic diff repair belongs to the parallel Work implementation.

Login changes are HTML/CSS only; existing CSP, authentication, remembered-session semantics and provider credentials remain intact.

This handoff describes source changes. Live deployment and browser acceptance must be recorded separately when completed.
