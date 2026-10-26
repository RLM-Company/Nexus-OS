# Runtime clock and operation deadlines

Kosmora's model runtime supplies a fresh trusted clock snapshot before each gateway dispatch, including permitted retries. It records UTC, Unix milliseconds, the local calendar date, weekday and explicit UTC offset. `KOSMORA_TIME_ZONE` selects a validated IANA timezone; the default is `Europe/Moscow`. Dates inside user messages and uploaded files remain ordinary historical content. The injected message is transient and does not rewrite stored conversations.

Calendar time comes from the host system clock. Production clock synchronization must be checked with `timedatectl show -p NTPSynchronized`; supplying clock metadata cannot correct an unsynchronized host. This is a snapshot at dispatch, not a continuously ticking clock inside a model generation. Clock context has a fixed conservative input reservation before routing and budget checks; the configured output budget is unchanged.

Code has a read-only `runtime_clock` tool for current time, elapsed task time, calendar-day arithmetic and intervals between timestamps with explicit offsets. Elapsed duration uses a process monotonic timer, so wall-clock corrections do not change it. Calendar arithmetic rejects impossible dates rather than silently normalizing them. Stopwatches last for the active process operation and do not claim to survive a restart. The tool performs no network requests or repository writes and grants no execution or publication permission.

Authenticated clients can read `GET /api/v1/clock?time_zone=Europe/Moscow` and calculate dates with `POST /api/v1/clock/calculate`. Both responses disable caching. Invalid input returns 400; unavailable runtime clock data returns 503. Neither route dispatches a model.

Code preparation/check operations now have a ten-minute overall deadline in addition to existing provider and isolated-runner limits. Expiry aborts the current operation and prevents late work from producing a proposal or publication token. Active ownership is retained until the in-flight operation settles. No automatic retry starts, and uncertain provider usage remains accounted for. Publishing retains its existing separate confirmation and reconciliation path. Research duration limits also use a monotonic clock.

Regression checks cover midnight and year transitions, leap days, daylight-saving ambiguity, backwards wall-clock correction, authenticated API validation, refreshed retry metadata without double reservation, local Code tool execution, operation expiry and existing Code cancellation/accounting behavior.
