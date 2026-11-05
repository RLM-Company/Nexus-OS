# Koswork: навигация по Markdown-источникам Vault

Пакет поверх PR #443. Существующие list/find записи Markdown получают outline_path.
Агент читает его обычным workspace_read и получает уровни/названия разделов,
исходные UTF-16 offsets, SHA256 и готовые opaque paths к тексту раздела.
Чтение раздела остаётся обычным ограниченным fragment read; оглавление не
объявляется содержимым раздела и не выдаёт новых полномочий.

Разбор: ATX #..###### с отступом до трёх пробелов, вне backtick/tilde fences.
Setext, HTML, семантические разделы Office/PDF не поддержаны и не заявляются.
Оглавление ограничено первыми 256000 UTF-16 единицами, 40 заголовками и 6500
сериализованными UTF-8 байтами до добавления ссылок. Финальный ответ с paths
проверяется общей границей 14000 байт. Заголовок сокращается до 160 UTF-16
с сохранением Unicode, title_truncated сообщает сокращение. truncated и
scanned_utf16 явно описывают неполное покрытие. Это навигация, не доказательство
истинности текста. Оригиналы, grants, readonly protocol и UI не изменены.

Проверка: 34 focused tests passed; полный desktop 265 tests, 264 passed,
0 failed, 1 штатный Windows-only skip. Реальные временные Markdown-источники:
смешанные CR/LF, emoji, fenced code, длинные заголовки и поздний раздел с 00123,
ценой и исключением. Сквозной путь list → outline → source read; отсутствие
доступа без grant, foreign owner, revoke и удалённый оригинал. Byte budget
проверяется после добавления всех section links. Formatting/secrets/whitespace
прошли. Нет новых dependencies/migrations, live model/Windows install/VPS.
