# Observability

The first operational slice currently lives in the API composition root: structured route/run logs,
content-free process-lifetime counters, and derived safety alerts at
`GET /api/v1/operations/status`. This package remains the future extraction point for metrics
exporters and distributed tracing; prompt and response content must not be added to telemetry.
