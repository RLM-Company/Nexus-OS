# Version timeline provenance — 10 October 2026

`version-timeline.tsx` and its CSS module adapt the original Kosmora neutral primitives delivery in `kosmora-incoming/round3/primitives/sources/kosmora-neutral-primitives`, with its MIT license retained in this directory. The package's supplied source review describes the React, TypeScript and CSS as original implementations of common interface patterns. No third-party marketplace component source, preview media, remote font or registry package was copied into this module.

The delivery's visual reference for the timeline pattern is the [21st.dev timeline collection](https://21st.dev/community/components/explore/timeline-component-react). This link records supplied provenance; it is not a blanket license for marketplace content. The earlier composer reference has unknown licensing in `docs/handoff/KOSMORA_UI_COMPONENTS_2026-10-09.md` and is not a source of this timeline module.

The integration replaces package-global CSS with a local CSS module and existing Kosmora theme variables, uses deterministic UTC dates unless the host supplies a display label, clamps diff counts, and renders selection/restore controls only when their host callbacks exist. It adds no dependencies. Runtime uses the repository's pinned React and React DOM.

The component is retained for future hosts. It is not wired to navigation or a restore API; permissions, confirmations, concurrency, audit and restore-as-new behavior remain the host's responsibility.
