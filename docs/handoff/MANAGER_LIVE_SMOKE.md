# Manager live smoke

The live smoke is an explicit, owner-authorized check for the configured external model route. It
creates one ordinary chat and one Manager project, waits for both server-owned runs to complete,
and verifies that each persisted assistant answer is non-empty.

It sends exactly two model requests. It does not print response content or credentials and refuses
mock mode, mock fallback, non-loopback API origins, or active emergency stops.

Run the secret-free preflight first:

```powershell
pnpm manager:preflight
```

Then authorize the two paid requests only for the current shell and run the smoke:

```powershell
$env:COSMORA_ALLOW_PAID_SMOKE = "SEND_TWO_PAID_REQUESTS"
pnpm manager:smoke
Remove-Item Env:COSMORA_ALLOW_PAID_SMOKE
```

The command intentionally leaves the created chat and project in the local SQLite history as
evidence of the live route. Delete neither automatically: cleanup is a separate owner action.
