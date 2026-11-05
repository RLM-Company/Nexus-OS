# Koswork: заполнение бюджета выдержки Office/PDF

База: a5b96d964bfab2010173cc064e77ba03f0e3e5a5.

Существующие readDocumentFile/readPdfFile теперь подбирают максимальный целый
Unicode-префикс в пределах 6000 UTF-16 единиц и 10000 сериализованных UTF-8 байт.
Ранее превышение бюджета делило длину пополам. Общий helper учитывает метаданные,
JSON escaping и курсор. Продолжение сохраняет прежние проверки версии файла,
хеша PDF-текста, owner/grant/cancellation. Новых прав или wire-полей нет.

Проверка: 37 focused desktop tests passed, 0 failed/skipped. Полный desktop:
254 tests, 252 passed, 1 failed, 1 skipped. Единственный сбой work-cycle.test.cjs
(сценарий переключения приложения, COMPUTER_ACTION_INVALID) воспроизведён на
неизменённой базе в отдельном worktree: 9 passed, 1 failed. Сбой не исправлялся
в этом пакете. Secret scan, syntax, formatting и diff whitespace прошли.

Тесты проверяют полный round-trip русского, ASCII, emoji и JSON-escaped текста,
прогресс курсора и невозможность вместить следующий Unicode code point.
Синтетический русский текст из 12000 букв Ж читается за 3 части вместо прежних 4.
Это измерение разбиения, не замер стоимости/скорости модели. Live provider,
установка Windows и VPS не проверялись. PR остаётся draft до CI/review.
