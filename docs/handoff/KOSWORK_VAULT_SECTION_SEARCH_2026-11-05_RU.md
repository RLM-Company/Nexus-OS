# Koswork: поиск точной фразы внутри Markdown-раздела

Пакет поверх PR #448. workspace_find mode text принимает section path из
оглавления. Результат содержит точные absolute UTF-16 позиции совпадения,
буквальные snippets и ссылки для чтения в прежних границах раздела. Вложенные
подразделы входят, соседние равного/старшего уровня исключены. Запрос — точная
регистрозависимая строка, не regex/нормализация/семантический поиск.

До 8 совпадений и окно 256000 UTF-16 за запрос. Чтобы не потерять фразу на границе,
окно имеет lookahead query.length-1; следующий курсор учитывает уже просмотренные
начала совпадений. Перекрывающиеся совпадения поддержаны, cursor не разрывает
Unicode. next_search_path привязан к query/source/section/grant; изменение query
или grant требует свежего поиска. Сохраняются 14000-byte response guard, 10 MiB
original limit и owner/hash/revoke. Пустые/невалидные Unicode/слишком длинные
запросы отклоняются. Общий sectionBounds/scanner исключает разные определения
границ у чтения и поиска; нового индекса нет.

Проверка: 47 focused tests passed, полный desktop 278 tests: 277 passed,
0 failed, 1 штатный Windows-only skip. 21 повторное совпадение, overlapping aa
в aaa, граница scan window, точность snippets и исходных позиций, исключение
другой цены/доставки из соседнего раздела, query/grant fencing и source readback.
Prettier/secrets/whitespace прошли. Нет новых dependencies/migrations/UI,
платных моделей, Windows install/VPS или live acceptance.
