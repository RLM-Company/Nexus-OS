# Kosmora brand

The owner selected helmet alternative 1 on 7 October 2026: a white helmet,
black visor, black outline and diagonal orbital ring. The product name is
**Kosmora**, with **KOSMORA** in the logo lockup.

`kosmora-symbol.png` is the canonical transparent raster artwork. White helmet
areas are opaque white. `kosmora-lockup.png` includes the wordmark. Both were
edited with the built-in image_gen tool from the selected reference. The exact
prompts are in `prompts-20261007.json`. These PNGs are not editable vector geometry.

Run from the repository root:

```sh
node scripts/render-brand-assets.mjs
node scripts/render-brand-assets.mjs --check
```

The generator trims transparent canvas padding and creates the shared 256px
symbol, React SVG image wrapper, standalone owner-login wrapper, 512px app tile
and Windows ICO with 16/24/32/48/64/128/256px entries. SVG files contain embedded
PNG artwork; they are not vector tracings. All outputs preserve the white helmet
and black visor. The tile uses the existing violet accent, `#6552b8`, with the
whole symbol inside the central maskable safe circle. Web `/icon` and
`/apple-icon` render at their declared sizes. The owner-login artwork is embedded
in its existing script, so its standalone mount needs no additional asset path.

The name is updated across web navigation, chat, Studio, Manager, settings,
install prompts, metadata, exports, model system prompts and Windows installer
labels. Technical compatibility identifiers (`@cosmora/*`, `COSMORA_*`, database
names, cookie/session names, storage keys, the Windows application ID and profile
directory) remain stable so the rename does not reset user data or access.

Windows 0.10.0 presents Kosmora in its executable, installer and shortcuts. It
uses the existing `cosmora-windows-desktop` profile and `persist:cosmora` browser
partition. The installer upgrade identity remains `com.cosmora.desktop`.

Earlier logo comparison images under `docs/design` are historical explorations,
not the selected mark. Validation and rollout evidence are recorded separately;
the assets alone do not establish a production release or owner installation.
