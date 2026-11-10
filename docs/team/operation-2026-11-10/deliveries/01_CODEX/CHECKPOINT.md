# O-001

База f9eb45285f3473bfd3fe9a73939c1903dc696b3b, ветка ops/codex-kosmora-koswork.
Изменены DB acceptResult и регрессии DB/API. Современная приёмка требует полного
набора файлов с verifiedArtifact readback; legacy поведение сохранено.
DB14/14; API full88/89, один старый timeout; scoped повтор4/4passed.
Не повышать статус до интеграции без полного CI на точном head.
Следующее: commit/PR, CI, интеграция, журнал; затем следующий сценарий BACKLOG.md.
