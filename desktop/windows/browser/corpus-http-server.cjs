"use strict";

const http = require("node:http");

/**
 * Reproducible Local HTTP 5-Site Acceptance Corpus & Synthetic Form/Download Server
 * (`desktop/windows/browser/corpus-http-server.cjs`).
 *
 * Serves over real local TCP/HTTP sockets (`http://127.0.0.1:<port>`):
 * - `GET /search?q=...&page=1` — HTML SERP listing the 5 corpus sites
 * - `GET /site-1-official-2026` — Official 2026 specs for Option Alpha (distinct `pageDate` & `eventDate`, HTML `<table>`)
 * - `GET /site-2-contradiction-2025` — Outdated 2025 review with conflicting price ($79/мес vs $49/мес)
 * - `GET /site-3-unavailable-503` — Real HTTP 503 Service Unavailable
 * - `GET /site-4-very-long-article` — Very long multi-section article (> 18,000 UTF-16 code units with surrogate pairs 🧪🚀)
 * - `GET /site-5-dynamic-and-substituted` — Stateful page that mutates a guarantee sentence on subsequent reads
 * - `GET /public-corroboration` — Accessible public page without login corroborating Option Alpha price in a different format (`$49.00 в месяц`)
 */
async function startReproducibleCorpusServer() {
  let site5ReadCount = 0;

  const fillerParagraphs = Array.from({ length: 42 }, (_, idx) =>
    `<p>Раздел ${idx + 1} [🧪🚀]: Подробный технический разбор методологии тестирования распределённых систем хранения и индексации документов в локальной среде выполнения. Этот абзац содержит аналитические выкладки и контрольные замеры пропускной способности конвейера чтения длинных страниц (#${idx + 1}). ${"Дополнительный блок проверочного текста для нагрузочного чтения длинной статьи. ".repeat(2)}</p>`
  ).join("\n");

  const server = http.createServer((req, res) => {
    const host = req.headers.host || "127.0.0.1";
    const baseOrigin = `http://${host}`;
    const parsedUrl = new URL(req.url || "/", baseOrigin);
    const pathname = parsedUrl.pathname;

    if (pathname === "/search") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html>
<html lang="ru">
<head><title>Результаты поиска Koswork</title></head>
<body>
  <article data-serp-item="true">
    <a href="${baseOrigin}/site-1-official-2026?utm_source=serp&id=alpha">Официальная спецификация Koswork Option Alpha (2026)</a>
    <p>Официальный прайс-лист и параметры SLA для Option Alpha.</p>
  </article>
  <article data-serp-item="true">
    <a href="${baseOrigin}/site-2-contradiction-2025">Архивный обзор корпоративных решений (Май 2025)</a>
    <p>Архивный разбор стоимости Option Alpha за весну 2025 года.</p>
  </article>
  <article data-serp-item="true">
    <a href="${baseOrigin}/site-3-unavailable-503">Недоступный портал бенчмарков</a>
    <p>Сервер бенчмарков на техническом обслуживании.</p>
  </article>
  <article data-serp-item="true">
    <a href="${baseOrigin}/site-4-very-long-article">Полное руководство по архитектуре Option Beta (Длинная статья)</a>
    <p>Многостраничное исследование архитектуры и цен Option Beta.</p>
  </article>
  <article data-serp-item="true">
    <a href="${baseOrigin}/site-5-dynamic-and-substituted">Динамический портал телеметрии Option Beta</a>
    <p>Динамические метрики и условия возврата средств.</p>
  </article>
</body>
</html>`);
      return;
    }

    if (pathname === "/site-1-official-2026") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html>
<html lang="ru">
<head>
  <title>Официальная спецификация Koswork Option Alpha (2026)</title>
  <meta property="article:published_time" content="2026-10-15" />
  <meta name="event:date" content="2026-11-01" />
</head>
<body>
  <p>Введение в корпоративный пакет Option Alpha для защищённых рабочих станций.</p>
  <p>Официальный прайс-лист: для пакета Option Alpha базовая цена составляет $49/мес при годовой подписке.</p>
  <p>Техническая архитектура: для Option Alpha автономный режим полностью поддерживается (SQLite WAL + локальный индекс).</p>
  <p>Гарантии надёжности: для Option Alpha поддержка SLA зафиксирована на уровне 99.95% времени доступности.</p>
  <table id="alpha-spec-table">
    <tr><th>Параметр</th><th>Значение</th></tr>
    <tr><td>Тариф Option Alpha</td><td>$49/мес</td></tr>
    <tr><td>SLA Option Alpha</td><td>99.95%</td></tr>
  </table>
</body>
</html>`);
      return;
    }

    if (pathname === "/site-2-contradiction-2025") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html>
<html lang="ru">
<head>
  <title>Архивный обзор корпоративных решений (Май 2025)</title>
  <meta property="article:published_time" content="2025-05-10" />
  <meta name="event:date" content="2025-05-01" />
</head>
<body>
  <p>Архивный разбор рынка за весну 2025 года.</p>
  <p>По состоянию на май 2025 года для пакета Option Alpha базовая цена составляет $79/мес без учёта скидок.</p>
</body>
</html>`);
      return;
    }

    if (pathname === "/site-3-unavailable-503") {
      res.writeHead(503, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><html><head><title>503 Service Unavailable</title></head><body><p>503 Service Unavailable — сервер временно недоступен.</p></body></html>`);
      return;
    }

    if (pathname === "/site-4-very-long-article") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html>
<html lang="ru">
<head>
  <title>Полное руководство по архитектуре Option Beta (Длинная статья)</title>
  <meta property="article:published_time" content="2026-10-20" />
  <meta name="event:date" content="2026-10-18" />
</head>
<body>
  ${fillerParagraphs}
  <p>Итоговая сводка по пакету Option Beta: базовая цена составляет $35/мес для малых команд.</p>
  <p>В пакете Option Beta автономный режим реализован через частичный кэш последних 100 документов.</p>
  <p>Для пакета Option Beta поддержка SLA составляет 99.90% в рабочие дни.</p>
</body>
</html>`);
      return;
    }

    if (pathname === "/site-5-dynamic-and-substituted") {
      site5ReadCount += 1;
      const refundSentence =
        site5ReadCount === 1
          ? "Гарантия возврата средств: 30 дней без условий."
          : "Гарантия возврата средств: возврат не предусмотрен (тариф невозвратный).";
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html>
<html lang="ru">
<head>
  <title>Динамический портал телеметрии Option Beta</title>
  <meta property="article:published_time" content="2026-10-28" />
  <meta name="event:date" content="2026-10-25" />
</head>
<body>
  <p>Первичный экран портала Option Beta.</p>
  <p>${refundSentence}</p>
  <p>Динамически подгруженный блок телеметрии: пакет Option Beta подтверждает задержку индексации менее 12 мс.</p>
</body>
</html>`);
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const baseOrigin = `http://127.0.0.1:${addr.port}`;

  return {
    server,
    port: addr.port,
    baseOrigin,
    resetState() {
      site5ReadCount = 0;
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
    }
  };
}

module.exports = {
  startReproducibleCorpusServer
};
