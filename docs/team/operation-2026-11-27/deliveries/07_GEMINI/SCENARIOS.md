# Воспроизводимые сценарии Studio и презентаций

Запускайте из корня репозитория с зависимостями из lockfile. Живые ключи для перечисленных команд не нужны.

```bash
pnpm --filter @cosmora/api exec vitest run --maxWorkers=2 test/studio-creative.test.ts test/studio-candidate.test.ts test/chat-images.test.ts test/presentations.test.ts test/presentation-work.test.ts test/presentation-history.test.ts
pnpm --filter @cosmora/db exec vitest run test/project-intake-upgrade.test.ts test/presentation-upgrade.test.ts test/presentation-work-upgrade.test.ts
KOSMORA_E2E_PRODUCTION=1 pnpm --filter @cosmora/web exec playwright test --workers=1 e2e/studio-creative-media.spec.ts e2e/studio-storyboard.spec.ts e2e/studio-music.spec.ts e2e/presentation-visuals.spec.ts e2e/presentation-work.spec.ts e2e/image-editing.spec.ts e2e/owner-ui-media.spec.ts
pnpm check:core
```

- Production API и настоящее файловое хранилище. Управляемый транспорт возвращает реальные синтетические байты MP3/MP4. Проверяются параметры на исходящем вызове, точные байты и хеш на выдаче, диапазоны, чужой аккаунт, повтор ID, отмена, поздний результат, таймаут, повреждённый контейнер, неподдерживаемый внешний URL и восстановление истории.
- Chromium. Studio проверяет явное согласие, потерянный ответ при запуске, историю после перезагрузки и скачанный файл по байтам. Для проверки UI ответы медиа замещены маршрутизацией Playwright. Раскадровка, задачи Work и сохранение презентаций работают через штатный API. Поставщик Work в E2E заменён управляемым сценарным ответом.
- Презентации. Проверка скачивает PPTX, сверяет исходную часть неизменённого слайда, поля таблицы, заметки и байты встроенного изображения. Сценарий оставляет экспорт `studio-presentation.pptx` и снимки предпросмотра. Для визуальной проверки самого экспорта выполните `soffice -env:UserInstallation=file:///tmp/nexus-studio-lo --headless --convert-to pdf --outdir /tmp <путь>/studio-presentation.pptx`. Затем откройте PDF или преобразуйте его страницы через `pdftoppm -png`.

Фикстуры: `apps/api/test/fixtures/studio-effect.mp3` (синтетический шум, FFmpeg), `apps/api/test/fixtures/studio-clip.mp4` (3 с, H.264 160×90, FFmpeg) и `apps/web/e2e/fixtures/presentation-studio.png` (цветная шкала). Имена, описания и бизнес-значения синтетические. Эти файлы используются только тестами.
