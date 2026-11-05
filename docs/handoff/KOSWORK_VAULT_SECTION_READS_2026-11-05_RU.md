# Koswork: точное чтение разделов Markdown

Пакет поверх PR #447. Ссылки заголовков из оглавления теперь ведут к section
reader. Граница: начало выбранного ATX-заголовка → следующий заголовок того же
или более высокого уровня, либо EOF. Подразделы входят; fenced code заголовками
не считается. Единый Markdown scanner используется оглавлением и section reader.

Ответ содержит абсолютные позиции источника, section_start_utf16,
section_end_utf16, section_level, SHA256, content и next_path. Продолжение
останавливается на границе выбранного раздела. Общий fitDocumentExcerpt получил
внутренний endLimit без изменения обычных Office/PDF/fragment ответов.
Прежние source fragment links продолжают работать. Новых прав/OS действий нет.

Проверки: 49 focused tests прошли. Полный desktop 275 tests: 274 passed,
0 failed, 1 штатный Windows-only skip. Длинный родительский раздел с подразделом,
CRLF/CR/LF и emoji восстанавливается точно; соседний раздел с другой ценой и
условием не включён ни в одну часть. Невалидный/fenced heading, неправильный
cursor, удалённый оригинал отклоняются. Полный Work navigation fixture проходит.
Форматирование, secrets и whitespace прошли. Сканирование ограничено прежним
10 MiB оригиналом; постоянного индекса нет. ATX-only, не анализ смысла документа.
Нет live provider, Windows install/VPS или новой UI-приёмки.
