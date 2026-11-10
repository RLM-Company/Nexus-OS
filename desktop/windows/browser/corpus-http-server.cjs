"use strict";

const http = require("node:http");

/**
 * Real Local HTTP Multi-Source Fixture Server (`desktop/windows/browser/corpus-http-server.cjs`).
 *
 * Serves real HTML/JS/form/503/long-page fixtures over local TCP sockets to the real
 * Chromium CDP browser engine (`http://corpus.local:<port>/...`).
 */
function startCorpusHttpServer() {
  const fillerParagraph =
    "Раздел технической документации Koswork Browser Research. Здесь описываются протоколы маршрутизации, " +
    "архитектура изолированных вкладок Chromium CDP и правила верификации UTF-16 выдержек без подмены фактов. ";
  const longPadding = fillerParagraph.repeat(115); // > 18,500 UTF-16 chars

  const server = http.createServer((req, res) => {
    const u = new URL(req.url || "/", "http://corpus.local");
    const baseOrigin = `http://corpus.local:${server.address().port}`;

    if (u.pathname === "/search") {
      const q = (u.searchParams.get("q") || "").toLowerCase();
      const page = Number(u.searchParams.get("page") || "1");

      if (q.includes("trigger_provider_500")) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Search Provider Internal Error");
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      if (page === 1) {
        res.end(`<!doctype html><html><head><title>SERP Page 1</title></head><body>
          <article data-serp-item="true">
            <a href="${baseOrigin}/site-1-alpha-2026">Официальная спецификация Option Alpha (2026)</a>
            <p>Актуальные тарифы Option Alpha с ноября 2026 года: $49/мес и SLA 99.95%.</p>
          </article>
          <article data-serp-item="true">
            <a href="${baseOrigin}/site-1-alpha-2026?utm_source=ads">Официальная спецификация Option Alpha (2026) — дубль URL</a>
            <p>Актуальные тарифы Option Alpha с ноября 2026 года: $49/мес и SLA 99.95%.</p>
          </article>
          <article data-serp-item="true">
            <a href="${baseOrigin}/site-2-alpha-2025-contradiction">Архивный обзор Option Alpha за 2025 год</a>
            <p>В 2025 году стоимость Option Alpha составляла $79/мес.</p>
          </article>
          <article data-serp-item="true">
            <a href="${baseOrigin}/site-3-unavailable-503">Недоступный портал бенчмарков (HTTP 503)</a>
            <p>Сервер временно перегружен.</p>
          </article>
        </body></html>`);
      } else {
        res.end(`<!doctype html><html><head><title>SERP Page 2</title></head><body>
          <article data-serp-item="true">
            <a href="${baseOrigin}/site-4-long-article">Полное руководство и бенчмарк Option Beta (2026)</a>
            <p>Глубокий технический отчёт (>18 000 символов) по Option Beta.</p>
          </article>
          <article data-serp-item="true">
            <a href="${baseOrigin}/site-5-dynamic-and-form">Динамический портал телеметрии и конфигуратор</a>
            <p>Живые метрики задержки p95 и интерактивная форма заявки.</p>
          </article>
        </body></html>`);
      }
      return;
    }

    if (u.pathname === "/site-1-alpha-2026" || u.pathname === "/site-1-mirror-dup") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><html><head>
        <title>Официальная спецификация Option Alpha (2026)</title>
        <meta name="article:published_time" content="2026-10-15" />
        <meta name="event:date" content="2026-11-01" />
      </head><body>
        <h1>Официальный прайс-лист и SLA Option Alpha</h1>
        <p>Опубликовано: 2026-10-15. Дата события: 2026-11-01.</p>
        <p id="alpha-price">Для корпоративного плана Option Alpha базовая цена составляет $49/мес при годовом контракте.</p>
        <p id="alpha-sla">Гарантированный уровень доступности для Option Alpha: SLA 99.95% в режиме 24/7.</p>
        <table>
          <thead><tr><th>Параметр</th><th>Значение</th></tr></thead>
          <tbody>
            <tr><td>Цена Option Alpha</td><td>$49/мес</td></tr>
            <tr><td>SLA Option Alpha</td><td>99.95%</td></tr>
          </tbody>
        </table>
      </body></html>`);
      return;
    }

    if (u.pathname === "/site-2-alpha-2025-contradiction") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><html><head>
        <title>Архивный обзор Option Alpha за 2025 год</title>
        <meta name="article:published_time" content="2025-05-10" />
        <meta name="event:date" content="2025-05-01" />
      </head><body>
        <h1>Обзор тарифов Option Alpha (май 2025)</h1>
        <p>Опубликовано: 2025-05-10. Дата события: 2025-05-01.</p>
        <p>По состоянию на май 2025 года для Option Alpha базовая цена составляет $79/мес.</p>
        <p>Ограничение версии: Option Alpha не поддерживает автономный воздушный контур (air-gapped).</p>
      </body></html>`);
      return;
    }

    if (u.pathname === "/site-3-unavailable-503") {
      res.writeHead(503, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><html><head><title>503 Service Unavailable</title></head><body><h1>HTTP 503: Источник временно недоступен</h1></body></html>`);
      return;
    }

    if (u.pathname === "/site-4-long-article") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><html><head>
        <title>Полное руководство и бенчмарк Option Beta (2026)</title>
        <meta name="article:published_time" content="2026-10-18" />
        <meta name="event:date" content="2026-11-01" />
      </head><body>
        <h1>Технический регламент Option Beta</h1>
        <p>${longPadding}</p>
        <section id="deep-section">
          <h2>Итоговые параметры Option Beta (раздел на глубине >18 000 символов)</h2>
          <p>Для платформы Option Beta подтверждённая цена составляет $65/мес, а гарантированный SLA 99.90%.</p>
          <p>Задержка чтения для Option Beta удерживается на уровне p95 &lt; 18 мс.</p>
        </section>
        <iframe id="cross-origin-ad" src="http://external-widget.example.org/banner"></iframe>
      </body></html>`);
      return;
    }

    if (u.pathname === "/site-5-dynamic-and-form") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><html><head>
        <title>Динамический портал телеметрии и конфигуратор</title>
        <meta name="article:published_time" content="2026-10-20" />
        <meta name="event:date" content="2026-11-05" />
      </head><body>
        <h1>Телеметрия задержек и форма расчёта квоты</h1>
        <div id="js-telemetry">Загрузка телеметрии...</div>
        <div id="shadow-host"></div>
        <form id="quota-form" onsubmit="event.preventDefault(); document.getElementById('form-status').textContent = 'Заявка принята: ' + document.getElementById('org-input').value + ' (' + document.getElementById('tier-select').value + ')';">
          <label for="org-input">Организация</label>
          <input id="org-input" name="org" type="text" value="" placeholder="Введите организацию" />
          <select id="tier-select" name="tier">
            <option value="standard">Standard</option>
            <option value="enterprise">Enterprise</option>
          </select>
          <input id="spec-file" name="specFile" type="file" />
          <button id="submit-btn" type="submit">Отправить расчёт</button>
        </form>
        <div id="form-status" role="status">Ожидание отправки</div>
        <button id="mutate-price-btn" type="button" onclick="document.getElementById('js-telemetry').textContent = 'ПОДМЕНА ТЕКСТА ПОСЛЕ НАБЛЮДЕНИЯ: задержка p95 < 999 мс';">Изменить DOM</button>
        <script>
          document.getElementById("js-telemetry").textContent =
            "По данным живой телеметрии Chromium V8 для Option Alpha задержка p95 < 12 мс при полной нагрузке.";
          const host = document.getElementById("shadow-host");
          if (host && host.attachShadow) {
            const root = host.attachShadow({ mode: "open" });
            root.innerHTML = "<p id='shadow-note'>Верифицированный модуль Shadow DOM: шифрование AES-256-GCM активно.</p>";
          }
        </script>
      </body></html>`);
      return;
    }

    if (u.pathname === "/site-6-captcha-gate") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><html><head><title>Проверка безопасности: капча</title></head><body>
        <h1>Подтвердите, что вы не робот (CAPTCHA)</h1>
        <div class="g-recaptcha" id="captcha-box"></div>
      </body></html>`);
      return;
    }

    if (u.pathname === "/site-7-payment-gate") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><html><head><title>Оплата подписки</title></head><body>
        <h1>Подтвердить платёж</h1>
        <p>Введите номер карты и CVV для списания средств.</p>
      </body></html>`);
      return;
    }

    if (u.pathname === "/slow-cancel-target") {
      setTimeout(() => {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<html><body>Медленный ответ</body></html>");
      }, 2500);
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
  });

  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      const baseOrigin = `http://corpus.local:${port}`;
      resolve({
        port,
        baseOrigin,
        searchEndpoint: `${baseOrigin}/search`,
        close: () => new Promise((r) => server.close(r))
      });
    });
    server.on("error", reject);
  });
}

module.exports = {
  startCorpusHttpServer
};
