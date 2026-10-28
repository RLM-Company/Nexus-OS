# Windows final acceptance — integrated Gemini drop

Date: 2026-10-28. Base: `bb8c7763ea781dd72a9f48700f03dc81977d0b3b`.

## Provenance and integration decisions

Received `kosmora-windows-final-acceptance.zip` from the owner's Google Drive;
24 entries, 137,430 compressed bytes. SHA-256:
`3a31626327820139cc00ae731e3355409d99fa11bf0156562d768d90abe31d9e`.
The bundled push script was not executed. The patch does not apply cleanly to current main.

Ported the packaged GUI acceptance driver, loopback HTTP fixture, CI lifecycle
invocation and their tests. Adapted them to the existing `kosmoraDownloads`
bridge, `{ok, entries}` response and boolean `downloadCenter.show()` contract.
Added hard guards requiring a packaged client on a disposable GitHub-hosted
Windows runner. The driver cannot run installer/profile acceptance on the
owner's ordinary laptop. Fixture files and downloads are constrained to the
runner's temporary directory, and the installed executable to the work root.

Preserved the current download center and owner-transition invalidation. The
incoming replacement weakened existing sender/window checks and omitted
owner-change cancellation; it was not transplanted. The incoming claims that
package name, app ID and required files were missing do not match current main.
Existing `com.cosmora.desktop`, profile directory, persistent partition, NSIS
settings, update trust and author/license remain intact.

Ported connection renderer request ordering and improved it to retain a typed
replacement server even while connection-state notifications arrive. Deferred
workspace navigation remains pending through failed loads/authentication until
successful restoration. Authentication and owner checks are retained.
No web design, logo, sidebar, server API, databases or provider settings change.

## Acceptance evidence

`pnpm --dir desktop/windows run check` validates syntax and runs the Node suite.
The loopback fixture test uses synthetic accounts and a test codec; it is not
evidence of Windows DPAPI or of the actual installed GUI. Renderer VM tests
cover stale request completion, asynchronous state ordering and preserving a
replacement address during a failed connection.

The Windows workflow builds a real unsigned x64 NSIS installer, installs it
on its disposable VM and runs two real Electron GUI processes in sequence:

1. First connection, form login, remote preload boundary, owner-bound DPAPI
   draft save/load, two non-overwriting downloads, download history window,
   and a reachable foreign-origin attachment that must not be saved.
2. Relaunch with persistent cookie, route and encrypted draft; second-instance
   deep link; server loss and retry with the saved origin/route; owner B draft
   isolation; explicit logout clearing drafts and the remembered route.

The existing upgrade/uninstall preservation checks still run separately.
The workflow uploads `kosmora-windows-x64` and a synthetic
`kosmora-windows-gui-acceptance` report on success. A passed Node suite alone
does not establish that these installed-client scenarios passed. Refer to the
PR's Windows job and its uploaded report for the exact revision tested.

No paid AI requests are made by these tests. This verifies the Windows shell
against a controlled server, not the unavailable production VPS, its TLS/login
or a real Coscode model run. Production acceptance remains pending restoration
of server access by the owner. The installer remains unsigned, with updates
disabled until a separately verified signing/distribution process is enabled.
