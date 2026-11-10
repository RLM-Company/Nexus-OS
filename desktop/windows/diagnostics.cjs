"use strict";

// Собственная диагностика клиента: собирает факты, которые пользователь может
// проверить сам, и никогда не включает имена или пути пользовательских файлов,
// идентификаторы владельца, cookies, токены или содержимое запросов. Неизвестные
// поля входа намеренно игнорируются, чтобы чужие ключи не проникли в отчёт.
// Модуль чистый и инъекционный: Electron остаётся в main.cjs.

const CONTROL = /[\u0000-\u001f\u007f]/g;
const MAX_FAULTS = 8;
const MAX_TEXT = 240;

function clampText(value) {
  const raw = typeof value === "string" ? value.replace(CONTROL, " ") : "";
  return raw.trim().slice(0, MAX_TEXT);
}

function clampCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

// Отчёт показывает только сам origin (schema/host). Query и фрагменты с
// потенциальными токенами не сохраняются по определению — адрес сервера
// хранится как чистый origin в connection-policy, но диагностика опирается
// на собственную нормализацию, а не на предположение о входе.
function originText(value) {
  const raw = clampText(value).trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : "";
  } catch {
    return "";
  }
}

function buildDiagnostics(input = {}, { now = () => new Date().toISOString() } = {}) {
  const origin = originText(input.origin);
  const profile = input.profile && typeof input.profile === "object" ? input.profile : {};
  const app = input.app && typeof input.app === "object" ? input.app : {};
  const downloads = input.downloads && typeof input.downloads === "object" ? input.downloads : {};
  const updates = input.updates && typeof input.updates === "object" ? input.updates : {};
  const faults = (Array.isArray(input.faults) ? input.faults : [])
    .map(clampText)
    .filter(Boolean)
    .slice(0, MAX_FAULTS);
  return {
    generated_at: now(),
    app: {
      version: clampText(app.version),
      electron: clampText(app.electron),
      node: clampText(app.node),
      platform: clampText(app.platform),
      arch: clampText(app.arch),
      packaged: app.packaged === true,
      single_instance_lock: app.hasSingleInstanceLock === true,
      secure_storage: app.secureStorage === true
    },
    profile: {
      ok: profile.ok === true,
      writable: profile.writable === true,
      redirected: profile.redirected === true,
      directory: clampText(profile.profileDirectory),
      reason: clampText(profile.reason)
    },
    connection: {
      origin: origin || null,
      owner_verified: input.ownerVerified === true,
      identity_epoch: clampCount(input.identityEpoch) ?? 0
    },
    downloads: {
      active: clampCount(downloads.active) ?? 0
    },
    updates: {
      pinned_key: updates.pinnedKey === true
    },
    faults
  };
}

function formatDiagnosticsText(diagnostics) {
  if (!diagnostics || typeof diagnostics !== "object") return "Диагностика недоступна.";
  const lines = [];
  const app = diagnostics.app ?? {};
  const versions = [app.version, app.electron && `Electron ${app.electron}`]
    .filter(Boolean)
    .join(", ");
  const headline = versions ? `Kosmora ${versions}` : "Kosmora";
  const environment = [app.platform, app.arch, app.node && `Node ${app.node}`]
    .filter(Boolean)
    .join(" / ");
  lines.push(headline + (environment ? ` — ${environment}` : ""));
  const flags = [];
  flags.push(app.packaged ? "упакованная сборка" : "сборка из исходников");
  if (app.secure_storage !== true)
    flags.push("защищённое хранилище Windows недоступно");
  if (app.single_instance_lock === false)
    flags.push("второй экземпляр: блокировка не получена");
  lines.push(`Приложение: ${flags.join("; ")}.`);

  const connection = diagnostics.connection ?? {};
  lines.push(
    connection.origin
      ? `Подключение: сервер ${connection.origin}; ${
          connection.owner_verified
            ? "владелец подтверждён"
            : "вход не подтверждён в этой сгенерации"
        }; сгенерация идентичности ${connection.identity_epoch}.`
      : "Подключение: активный сервер не выбран."
  );

  const profile = diagnostics.profile ?? {};
  const profileLine = [`Каталог профиля: ${profile.directory || "неизвестен"}`];
  if (profile.ok) {
    profileLine.push("запись возможна, настройки сохраняются");
    if (profile.redirected) profileLine.push("профиль перенаправлен в LocalCache упакованной среды");
  } else {
    profileLine.push("запись невозможна, настройки не сохраняются");
  }
  if (profile.reason) profileLine.push(profile.reason);
  lines.push(`Профиль: ${profileLine.join("; ")}.`);

  const downloads = diagnostics.downloads ?? {};
  lines.push(
    `Загрузки: активных загрузок ${downloads.active ?? 0}; история загрузок и хранилище материалов хранятся отдельно по владельцу и серверу; счётчики — в их окнах.`
  );

  const updates = diagnostics.updates ?? {};
  lines.push(
    `Обновления: закреплённый ключ релизов ${updates.pinned_key ? "есть" : "нет"}; автовыполнение обновлений не включено.`
  );

  if (diagnostics.faults.length)
    lines.push(`Проблемы: ${diagnostics.faults.join(" | ")}.`);
  else lines.push("Проблемы: не зафиксировано.");
  lines.push(`Отчёт сформирован: ${diagnostics.generated_at}.`);
  return lines.join("\n");
}

module.exports = { buildDiagnostics, formatDiagnosticsText };
