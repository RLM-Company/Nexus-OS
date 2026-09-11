# Sunday Manager demo runbook — 2026-09-11

## Honest demo claim

This is a **controlled vertical slice** with a **synthetic/read-only executor**. It proves a
persisted Manager plan, reload, explicit execution, artifacts/checkpoint, background-run
observation and Stop. It does not prove a production provider, autonomous company, real tool
execution or a finished multi-agent runtime.

## One-time preparation

Requirements: Node.js 24+, pnpm 11.19 and the repository on the demo PC.

```bash
pnpm install --frozen-lockfile
pnpm db:migrate
```

Keep the demo on the default mock model route. Do not configure a provider credential, A6,
finance, production or external integrations for this walkthrough.

## Desktop start

In terminal 1:

```bash
pnpm demo
```

In terminal 2:

```bash
pnpm demo:preflight
```

Continue only after `Demo preflight PASS`. Open `http://127.0.0.1:3000`.

## Optional phone start

Use only a trusted private Wi-Fi network. In terminal 1 run:

```bash
pnpm demo:lan
```

Run the same preflight in terminal 2. Find the PC's private IPv4 address (`ipconfig` on Windows or
`ip addr` on Linux), then open `http://<PC-private-IP>:3000` on the phone. If the operating system
asks about firewall access, allow only the private network. The API stays on `127.0.0.1`; only the
Next.js frontend listens on the LAN and proxies API requests locally.

Stop the processes with `Ctrl+C` immediately after the walkthrough.

## Five-minute walkthrough

1. Open Cosmora and enter `Подготовь план улучшения документации проекта`.
2. Wait for `Ответ получен` from the local mock Manager chat.
3. Select `Подготовить Manager plan` and show the three persisted steps.
4. Reload the page, reopen the project and show that the same plan remains.
5. Select `Запустить безопасный шаг` and show the synthetic analysis, three artifacts and saved
   checkpoint.
6. Start a separate chat run, reload/reopen while it is active and use `Stop` to demonstrate the
   server-owned cancellation path.
7. Open Control Center and describe confirmations, Decision Trace, hard limits, emergency stop and
   read-only `RECOVERY_REQUIRED` visibility. Do not activate or approve anything during the demo.

## Preflight failures

| Failure                       | Safe response                                                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| API, web or proxy unavailable | Keep terminal 1 open, inspect its first startup error and restart; do not switch to an external service.                       |
| SQLite is not healthy         | Stop the demo and inspect the local database/migration error. Do not delete the database as an improvised fix.                 |
| Model route is not mock-only  | Stop, remove the external provider variables from the demo process and restart. Never paste a key into chat or the repository. |
| Emergency stop is active      | Keep execution blocked. Review and clear it only through the existing audited recovery flow with the required owner proof.     |
| Phone cannot connect          | Stay on the desktop demo; do not expose the API or use public tunnelling.                                                      |

## Completion checklist

- `pnpm demo:preflight` passed immediately before the walkthrough;
- desktop flow works; phone is optional;
- the words `controlled vertical slice` and `synthetic/read-only executor` are used;
- no provider credential, external integration, finance, production action or A6 activation is
  present;
- terminals are stopped after the walkthrough.
