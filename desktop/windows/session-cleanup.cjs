"use strict";

// Остатки браузерного сеанса (localStorage, cache, cookies) привязаны к origin,
// а не к владельцу: следующий владелец того же сервера не должен получать их в
// наследство. Помощник вызывает ровно эти две очистки в фиксированном порядке,
// чтобы меню-выход и hosted-first-party-выход вели себя одинаково. Ошибки
// не гасятся — вызывающая сторона решает, как честно сообщить о них.
async function clearBrowserSessionData(getSession) {
  const browserSession = getSession();
  await browserSession.clearStorageData();
  await browserSession.clearCache();
}

module.exports = { clearBrowserSessionData };
