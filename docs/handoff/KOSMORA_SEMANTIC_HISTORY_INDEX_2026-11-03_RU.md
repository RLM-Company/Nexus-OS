# Инкрементальный индекс разрешённой истории

## Согласованный объём

Продолжение offline semantic-memory (PR #436), согласовано владельцем «делаем».
Индексируется вся поддерживаемая и явно разрешённая история, а не только последние
48 сообщений. Интерфейс, sidebar, логотип, desktop и provider credentials не меняются.
Индекс не обучает веса и не гарантирует воспроизведение каждого факта.

## Устройство

- Один SQLite-кэш в прежней БД: ссылки на оригиналы, fingerprint, диапазоны UTF-16
  и нормализованные 384-dimensional float32 vectors. Второй копии текста нет.
- Отдельные durable cursors на owner/target/encoder, общий кэш источников одного
  владельца. Перезапуск продолжает со следующего диапазона, а не начинает заново.
- Keyset-обход заметок, general-chat и project messages, без ограничения по давности.
  Только завершённые допустимые сообщения; архив, подавленные источники, credentials,
  истёкшие заметки и чужие данные исключаются прежним authority layer.
- Изначально до 600 UTF-16 единиц на фрагмент, overlap до 60. Реальный tokenizer
  проверяет предел 512 tokens; при переполнении ширина уменьшается без пропуска текста.
  Суррогатная пара не разрезается. NULL-vector означает переполнение, не успех.
- Перед сохранением снова проверяются settings version, grants, оригинал/fingerprint,
  ожидаемое смещение и privacy fence. Запись атомарна; запоздавшие результаты отвергаются.
- Фоновый обход ограничен 8 фрагментами за inference и 32 cached references за шаг.
  Ожидание после работы — минимум 50 ms и не меньше тройной длительности шага:
  это ориентир около 25% duty cycle фонового исполнения, не гарант CPU-процента.
  После готовности/блокировки idle poll — 1 s; housekeeping sweep — не чаще раза
  в минуту, чтобы большой готовый кэш не сканировался каждые 50 ms.
  Запрос пользователя имеет один приоритетный waiter; бесконечной очереди нет.
- Малый профиль автоматически выбирается при <=1 GiB доступного процессу лимита
  памяти или одном CPU: batch=1; на одном CPU intra-op=1. Обычный профиль batch=4,
  intra-op=2. Inter-op=1. SHA256 весов считается потоком с буфером 1 MiB.
- После трёх реальных ошибок inference target становится blocked; busy/cold не
  считается ошибкой. Изменение исходника/разрешений запускает новый обход.

## Поиск и честный охват

Кодируется вопрос, сохранённые passages повторно не кодируются. Vector rows сначала
ограничиваются текущим owner/grants; затем идёт постраничный exact cosine scan
(256 строк/страницу), с yield event loop. По умолчанию бюджет scan 250 ms. Это не
жёсткий SLA: текущая страница и сопутствующие SQL/encoding могут занять больше.
Выбираются лучшие 32 источника, затем действует прежний RRF и контекстный бюджет.
Цитаты, SHA оригинала, роль, версия и разрешения повторно проверяются после await.
FTS, обязательные ограничения и exact usage receipts сохраняются.

Ответ содержит index state (building/ready/capacity/blocked), counts и scan_limited.
Ready означает завершённый текущий обход, а не идеальную семантическую полноту.
Частичный или ограниченный scan явно помечается limited. Квота — 100 000 chunks
на владельца: около 146,5 MiB только vectors, плюс SQLite/metadata. При достижении
capacity источники не удаляются; индекс остаётся частичным. Увеличение квоты или
освобождение места позволяет продолжить. No-source/отсутствие совпадения не является
доказательством отсутствия факта во всей истории.

## Privacy и жизненный цикл

Migration 0063 — additive tables/indexes/triggers. Редактирование/удаление источника
удаляет производные vectors. Изменение grants, архивирование, suppression и переход
owner lifecycle из active очищают соответствующий owner cache и cursors. Вставка
сообщения сбрасывает только действительно связанные targets, включая собственный.
TTL сравнивается по нормализованному SQLite времени, включая timezone offsets.

Обязательный privacy adapter semantic-memory останавливает задачи владельца,
прерывает inference, дожидается фактического завершения native worker и удаляет
rebuildable cache до экспорта/удаления. Исходники экспортируются прежними adapters;
embeddings не объявляются отдельными пользовательскими документами. После export
индекс восстанавливается из разрешённых оригиналов. Это не обещание forensic erase
RAM, WAL, filesystem snapshots или ранее созданных backup-файлов.

## Приёмка

Автотесты: источник за прежним окном; grants/чужой owner; правки и отзыв во время
inference; SQLite reopen/resume; quota recovery; CJK overflow без дыр; TTL/privacy;
cache reuse; insert перед cursor; scan budget; 3-error circuit; project provenance.
Контролируемые one-hot vectors в тестах проверяют механику, не интеллект модели.

[Результат настоящего E5](../research/semantic-history-index-2026-11-03.json):
16 фактов RU/EN 2020 года + 80 более новых нерелевантных сообщений, 22 вопроса.
При неизменных fixture, gate и RRF top-3: bounded 6/22, индекс 20/22; top-1 18/22,
MRR 0,86255. Медиана recall около 17,1 ms против 292,5 ms bounded path на операторском
ПК; 99 manual batches построены за 1544 ms без задержек scheduler. Это небольшой
синтетический набор и не production SLA/оценка общего интеллекта. RSS snapshot
224,3 MiB — не peak. Малый профиль batch=1/threads=1 сохранил top-3 20/22 и
top-1 18/22: median indexed 26,9 ms, snapshot RSS 140,2 MiB на том же ПК.
API smoke с настоящим encoder, старым источником за 48 сообщениями и mock LLM
подтвердил exact receipt и отсутствие источника в system-инструкциях (0 paid calls). 1800 известных CJK-символов покрыты 7 adaptive chunks.

Воспроизведение (модель устанавливается отдельно по pinned manifest):

```sh
pnpm --filter @cosmora/api exec node --import tsx --conditions=development ../../scripts/bench-semantic-history-index.mjs /absolute/model report.json
# Малый профиль того же encoder:
pnpm --filter @cosmora/api exec node --import tsx --conditions=development ../../scripts/bench-semantic-history-index.mjs /absolute/model small.json --small
```

## Выкатка

Нужен KOSMORA_SEMANTIC_MODEL_DIR с установленной и проверенной offline-моделью.
Flag не включает память ни одному чату и не выдаёт новых grants. Без flag остаётся
прежний lexical path. Production сборка копирует worker + manifest в dist.
Выкладка API отдельно от web сохраняет внешний вид. До активации: consistent DB
snapshot, проверка migrations на копии, staging модели в лимитах хоста и rollback
на прежний API image. Additive cache schema позволяет вернуть старый API без
перезаписи текущих пользовательских данных. Фактический результат выкладки
фиксируется отдельно; наличие этого документа не означает production activation.

## Выбор готовых компонентов

Используются уже pinned MIT E5 и Apache-2.0 Transformers.js из PR #436. Проверен
sqlite-vec (https://github.com/asg017/sqlite-vec, MIT/Apache-2.0): полезен для больших
ANN/vector workload, но сейчас требует native extension и нового deployment path.
Для текущего bounded owner quota оставлен встроенный SQLite с scoped exact scan;
upstream-код sqlite-vec не копировался. Новых runtime-зависимостей этот индекс не добавляет.
Дальше — отдельная крупная оценка, absent-fact случаи и при необходимости ускорение
vector scan. Это отдельная очередь, не обещание текущего результата.
