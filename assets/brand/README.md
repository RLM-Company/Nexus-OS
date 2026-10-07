# Cosmora brand

The orbital symbol is an open ring with a satellite in its opening. It suggests
the initial C while retaining a simple silhouette at small sizes. The application
keeps its existing violet accent, `#6552b8`, and uses monochrome variants on light
and dark surfaces.

Edit only `cosmora-symbol.svg` for symbol geometry. From the repository root run:

```sh
node scripts/render-brand-assets.mjs
node scripts/render-brand-assets.mjs --check
```

The generator maintains the shared React geometry, the standalone owner-login
symbol, Windows app SVG and a lossless ICO with 16/24/32/48/64/128/256px entries.
The existing `render-windows-icon.mjs` command delegates to the same generator.
It uses existing Prettier and Next/Sharp dependencies; no provider API is involved.

Web `/icon` and `/apple-icon` render the same app tile at their declared sizes.
The tile's foreground stays within the central maskable safe circle. Windows
packages its SVG for the local connection screen as well as the ICO for its
executable and shortcuts. The owner-login SVG is embedded in its existing script,
so its isolated deployment mount and authentication dependencies stay valid.

The current design candidate is in `codex/brand-refresh-20261007`. The deployed
server remains on the prior `8cead61` release until the design is released.

Design references:

- [Three directions](../../docs/design/cosmora-logo-directions-20261007.png)
- [Orbit in the application](../../docs/design/cosmora-logo-orbit-desktop-20261007.jpg)

Verification for this candidate: lint, strict types, formatting, secret scan,
nine package builds, 23 deployment/access checks, 15 Windows policy/syntax checks,
six PWA/Chromium scenarios and reproducible generated assets passed. These checks
do not establish a newly packaged Windows installer or a production rollout.
