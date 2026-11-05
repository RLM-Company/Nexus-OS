# Koswork: ограниченные материалы Vault

Пакет поверх PR #441; его helper используется и для локальных исходников Vault.
Фрагмент ограничен 10000 JSON/UTF-8 байт, конечный ответ с opaque path и инструкцией
ограничен 14000 байт. Предпросмотр контекста — 20000 UTF-8 байт, с сохранением
существующего ограничения числа символов. Превышение не обрезает цитату молча.

Курсор внутри surrogate pair отклоняется VAULT_QUERY вместо возврата предыдущего
символа повторно. Поисковый offset заранее нормализуется к началу целого символа.
Версии источников, оригинальные байты, grants/revoke и readonly protocol сохранены.
Новых внешних действий/данных, UI и зависимостей нет.

Проверки: 27 focused tests passed. Полный desktop 258 tests: 257 passed,
0 failed, 1 штатный Windows-only skip. UTF-8/JSON budgets, Chinese/emoji/escaped
round-trip, точность чисел/исключений, cursor rejection, search boundary и revoke.
Secret scan и diff whitespace прошли. Ранее существовавший Linux fixture issue
исправлен родительским PR #441. Live model/Windows install/VPS не проверялись.
