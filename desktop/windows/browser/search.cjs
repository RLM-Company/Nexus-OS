"use strict";
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { safeUrl } = require("./policy.cjs");
const SEARCH_PAGE = pathToFileURL(path.join(__dirname, "search.html")).href;
function pageUrl(id) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id))
    throw Error("BROWSER_STALE");
  return SEARCH_PAGE + "?entry=" + id;
}
function entryId(value) {
  try {
    const url = new URL(value);
    const id = url.searchParams.get("entry");
    return id && pageUrl(id) === url.href ? id : null;
  } catch {
    return null;
  }
}
function query(value) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim().length > 240 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  )
    throw Error("BROWSER_QUERY_INVALID");
  return value.trim();
}
function results(body, requested) {
  if (!body || body.query !== requested || !Array.isArray(body.items) || body.items.length > 100)
    throw Error("BROWSER_SEARCH_UNAVAILABLE");
  const items = [],
    seen = new Set();
  const clean = (s, max) =>
    String(s)
      .replace(/<[^>]*>/g, "")
      .replace(/[\u0000-\u001f\u007f]/gu, " ")
      .slice(0, max);
  for (const item of body.items) {
    const url = safeUrl(item?.url);
    if (!url || url.length > 1500 || seen.has(url) || typeof item.title !== "string") continue;
    seen.add(url);
    items.push({
      title: clean(item.title, 180),
      url,
      snippet: typeof item.snippet === "string" ? clean(item.snippet, 700) : ""
    });
    if (items.length === 5) break;
  }
  return items;
}
// Fixed application function in the isolated world. Never evaluates search-result HTML.
const render = function (data) {
  if (new URL(location.href).searchParams.get("entry") !== data.id) return false;
  const heading = document.getElementById("query"),
    status = document.getElementById("search-status"),
    list = document.getElementById("results");
  if (!heading || !status || !list) return false;
  document.title = data.query + " — Kosmora";
  heading.textContent = data.query;
  status.textContent = data.loading
    ? "Ищем подходящие страницы…"
    : data.error === "BROWSER_SEARCH_CANCELLED"
      ? "Поиск остановлен. Повторите запрос в адресной строке."
      : data.error === "BROWSER_SEARCH_EXPIRED"
        ? "Эта выдача уже выгружена из памяти. Повторите запрос в адресной строке."
        : data.error
          ? "Поиск сейчас недоступен. Повторите запрос позже."
          : data.items.length
            ? "Найденные источники · " + data.items.length
            : "Ничего не найдено. Попробуйте уточнить запрос.";
  list.replaceChildren();
  for (const item of data.items) {
    const row = document.createElement("li"),
      source = document.createElement("span"),
      link = document.createElement("a"),
      snippet = document.createElement("p");
    source.className = "source";
    source.textContent = new URL(item.url).hostname;
    link.href = item.url;
    link.rel = "noreferrer";
    link.textContent = item.title || source.textContent;
    snippet.textContent = item.snippet;
    row.append(source, link, snippet);
    list.append(row);
  }
  return true;
};
module.exports = { SEARCH_PAGE, pageUrl, entryId, query, results, render: render.toString() };
