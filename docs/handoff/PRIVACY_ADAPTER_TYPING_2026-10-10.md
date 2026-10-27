# Privacy adapter typing — 10 October 2026

Focused corrections cover `apps/api/src/account-settings/privacy/account-core-adapter.ts`, `integrated-adapters.ts`, `archive.ts`, `routes.ts` and `shared-owner-budget.ts`. The root maintainer owns `privacy/coordinator.ts`.

Attachment JSON crosses the parser boundary as `unknown`. Image candidates are checked for valid metadata, supported image MIME, canonical bounded base64 and complete bytes before an original descriptor is produced. Export preserves additional stored metadata while removing inline binary data. Opaque binary key captures are validated before they are passed to SQLite; every binary lookup retains its owner join.

Archive chunks are also treated as `unknown`. Only string and `Uint8Array` chunks become bytes, with the existing length and SHA-256 checks preserved. The filename header sanitizer retains its deliberate control-character removal with a targeted lint explanation.

The adapter methods keep their Promise contract and existing synchronous execution of SQLite snapshots/transactions. Documented `require-await` exceptions are limited to the adapter files and the single synchronous budget reconciliation method. No artificial `await`, global unsafe-type rule change, owner-fence weakening, deletion-order change or new persistence was introduced. The media adapter explicitly acknowledges its epoch argument; its existing durable lifecycle/ownerActive fence remains responsible for blocking late writes.

Focused ESLint: PASS. API semantic typecheck found no errors in these files; the remaining observed error was in the concurrently edited research test. The existing compiled `privacy-coordinator.node.mjs` suite checks owner isolation, incomplete export rejection, actual FK cascades, retained accounting, fencing during delayed quiesce, partial deletion failure and original image hashing/download scope. Its run against refreshed API output is recorded below when the root build is ready.
