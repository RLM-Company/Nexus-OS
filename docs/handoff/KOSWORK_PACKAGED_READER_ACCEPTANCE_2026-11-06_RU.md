# Koswork: приёмка page reader в Windows-пакете

Дополнена существующая проверка GUI на disposable GitHub-hosted Windows runner.
Сценарий использует настоящий упакованный Electron WebContentsView/CDP и
ComputerSession, собственный loopback HTTP fixture и сценарный planner.
Запустить этот режим на компьютере владельца запрещает прежняя environment gate.

После существующих form/upload/download/Work сценариев открывается длинная русская
статья, читается несколькими `browser_read_text`, проверяются точные числа,
условия, emoji, 00123, ограничение UTF-8 и одинаковая версия частей. Hidden,
password, editable, frame и shadow содержимое не попадает в статью.

Затем страница перезагружается, а инструменту передаётся прежняя версия.
Изменение navigation generation приводит к `BROWSER_TEXT_CHANGED` до эффекта;
ComputerSession передаёт отказ для перепланирования. Сценарий завершается после
проверки отказа. Сводный GUI report получает отдельные признаки reader/version/
exclusions. Это проверка packaged transport, а не качества живой модели.

Пользовательский интерфейс, публичные API, устройство владельца и настройки
приложения не меняются. Платных вызовов, серверной выкладки и расширения grants нет.
Функциональная версия остаётся 0.21.2; меняется только CI acceptance harness.
Результат Windows-прогона фиксируется в PR и локальном операторском отчёте.
