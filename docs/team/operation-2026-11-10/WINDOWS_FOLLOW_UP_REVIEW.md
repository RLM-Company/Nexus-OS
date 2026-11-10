# Windows: границы частичной приёмки

Из #502 интегрированы c0b1439b guard portability (волна 1) и выбранный commit
e3cbd1a8 diagnostics (волна 2), с rootпоправками faults/build.files/preflight.
Это не слияние полного head1a3f8a62 или последующего 4651fd68.

На 1a3f8a62 выполнен pure packagegraph probe: временный main.cjs с
require("./missing.cjs"), отсутствующим модулем и build.files=["main.cjs",
"lib/**/*"]. buildPackageGraphReport вернул walked1,missing[] вместо отказа.
Контроль с настоящим lib/child.cjs и корректным recursiveglob прошёл.
Не утверждать, что этот контроль воспроизводит все globслучаи.

Перед приёмкой следующего guard: missing/static local require, single/double
quotes, index/JSON/extension resolution и реальные используемые wildcardpatterns.
Второе направление: hosted logout cleanup должен завершиться до нового входа/
смены origin; согласовать lifecycle, а не просто подавить ошибку asyncclear.
Это требование проверки гонки, не заявление о воспроизведённом на Electron баге.
Установщики запускать только в одноразовой WindowsCI/VM; owner-PC не трогать.
Новый head сначала сверить: возможно, автор уже исправил эти места.
