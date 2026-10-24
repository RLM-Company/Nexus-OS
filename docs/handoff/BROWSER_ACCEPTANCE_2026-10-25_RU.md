# Браузерная приёмка 25 октября

База: интеграционная ветка `codex/integrate-work-presentations-20261017`,
коммит `5af25157ae673c071b103d3396792d18e2224a9b`, дерево
`98fd40e8e4d8281ccd9485c1a14127f04cc5ab4b` после PR376–378.

## Результат

Выполнены реальные Playwright-клики, проверки DOM и скачанных файлов:

- **25 / 25 passed** на Next dev webpack, 1 worker, 1.7 минуты:
  10 Canvas, 9 graph context, 3 Research → Canvas, 2 XLSX, 1 Work schedule.
- **10 / 10 passed** на production Next build/start, 1 worker, 30.5 секунды:
  те же 9 graph context и 1 Work schedule.
- Production Next webpack build (20 страниц), полный E2E TypeScript,
  Prettier, secrets и diff checks успешны.

Проверены графы/контекст, SHA/review/CAS, восстановление потерянного ответа,
сравнение и конкурентное изменение материалов, точные bytes скачанного JSON,
реальная SQLite после перезагрузки, Canvas версии/конфликты/экспорт/DOCX,
неактивное HTML-содержимое, Research citations/copy и поздние ответы,
XLSX выбор листа/заголовков/правка/export/отмена, фильтры и сроки Work без запуска.

Это локальная функциональная приёмка выбранных сценариев, не весь набор из
336 E2E-тестов и не hosted CI. API использовал существующий изолированный
integration fixture с mock provider и локальным owner; production-прогон
означает production **web** плюс этот же тестовый API. Реальная внешняя модель,
production auth/edge, пользовательский ноутбук и действующий VPS не проверены.

## Доступный браузер

Официальный Playwright download возвращал повреждённый ZIP. Из npm получен
`@sparticuz/chromium@153.0.0` (Chromium 153.0.8010.0), распакованный отдельно от
репозитория и application dependencies. Playwright 1.62.1 запускает этот binary
через executablePath. В приложение и lockfile новая зависимость не добавлялась.
Это альтернативный Chromium 153, не штатный bundled Chromium 151.

## Воспроизводимый запуск

Добавлены `playwright.acceptance.config.ts` и `test:acceptance`. Конфиг запускает
собственные API/Next прямыми Node-командами, отказывается переиспользовать чужие
серверы и отключает paid media в тестовой среде. Обычный запуск с установленным
Playwright browser:

```sh
pnpm --filter @cosmora/web test:acceptance e2e/intelligence-graph-context.spec.ts
```

Для заранее установленного Chromium задайте
`KOSMORA_E2E_CHROMIUM_EXECUTABLE` — полный путь к binary. Если ему требуются
дополнительные локальные shared libraries, настройте LD_LIBRARY_PATH в тестовом
окружении. Конкретные scratch paths этого запуска не входят в конфиг.
Для проверки уже собранного web задайте `KOSMORA_E2E_PRODUCTION=true` после
актуальной сборки; стандартный production proxy должен смотреть на порт 3100.

## Исправленная фикстура

Первый запуск дал 8 passed / 1 failed: тест восстановления 503 связывал доступность
сервиса с номером HTTP-запроса. React Strict Mode отменяет и повторяет начальный
effect, поэтому второй read преждевременно «восстанавливал» сервер. Теперь
outage сохраняется до явного ручного retry. Ожидания UI не ослаблены, код
продукта для этого не менялся. Повторный dev и production прогоны успешны.

## Выкладка

Read-only SSH-попытка к ранее указанному VPS завершилась до handshake:
`Network is unreachable`. В этой среде также нет SSH key/config или agent.
Удалённых изменений, снятия защит SSH, публикации другого хостинга и повторного
запроса credentials не было. Выкладку с backup/rollback и smoke можно выполнить
только из среды с настроенным доступом к существующему серверу. Предыдущие
протоколы VPS release и SQLite backup сохраняются.
