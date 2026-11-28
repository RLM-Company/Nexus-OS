# Third-party notices — Games 3D runtime

## three.js

- Package: `three@0.187.0` (runtime), `@types/three@0.187.0` (types).
- License: MIT (verified via `npm view three license` and `npm view @types/three license`, 27 ноября 2026).
- Source: https://github.com/mrdoob/three.js
- Used for: real WebGL scene construction, camera/light/material, mesh from inert `obj-lite` data.
- No user code is executed in the app origin: only the trusted `three` runtime and bounded data.

Full license text for the pinned version should be kept by the integrator when
merging the dependency into main, per AGENTS.md "retain license notices and pin
the upstream source".
