"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { writeAtomicJson } = require("./desktop-state.cjs");
const { compareVersions, validateSignedManifest, MANIFEST_PATH } = require("./update-policy.cjs");

const MAX_MANIFEST_BYTES = 16384;
const CHECK_TIMEOUT_MS = 12000;
const DOWNLOAD_TIMEOUT_MS = 180000;

async function fetchUnredirected(fetcher, url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      signal: controller.signal
    });
    if (!response.ok || response.url !== url || (response.status >= 300 && response.status < 400))
      throw new Error(`Запрос релиза отклонён (HTTP ${response.status}).`);
    return { response, release: () => clearTimeout(timer) };
  } catch (error) {
    clearTimeout(timer);
    throw error;
  }
}

async function readSmallBody(response, maxBytes) {
  if (!response.body) throw new Error("Пустой ответ сервера релизов.");
  const reader = response.body.getReader();
  const parts = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error("Превышен размер манифеста обновления.");
      parts.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(parts).toString("utf8");
}

function packageFilename(version) {
  compareVersions(version, "0.0.0");
  return `Kosmora-Setup-${version}-x64.exe`;
}

async function fileMatches(file, sha256, size) {
  try {
    const stats = await fs.promises.lstat(file);
    if (!stats.isFile() || stats.size !== size) return false;
    const digest = crypto.createHash("sha256");
    for await (const chunk of fs.createReadStream(file)) digest.update(chunk);
    return digest.digest("hex") === sha256;
  } catch {
    return false;
  }
}

function createUpdateService({ fetcher, origin, currentVersion, userData, publicKeyPem }) {
  const releasesDir = path.join(userData, "verified-releases");
  const indexFile = path.join(releasesDir, "index.json");
  let latest = null;

  function readIndex() {
    try {
      const index = JSON.parse(fs.readFileSync(indexFile, "utf8"));
      if (!Array.isArray(index)) return [];
      return index
        .filter((entry) => {
          try {
            packageFilename(entry.version);
            return (
              typeof entry.sha256 === "string" &&
              /^[a-f0-9]{64}$/.test(entry.sha256) &&
              Number.isSafeInteger(entry.size) &&
              entry.size > 0
            );
          } catch {
            return false;
          }
        })
        .slice(0, 10);
    } catch {
      return [];
    }
  }

  async function check() {
    if (!publicKeyPem)
      return {
        status: "disabled",
        message: "Нет закреплённого публичного ключа релизов; обновления выключены."
      };
    const server = origin();
    if (!server) return { status: "offline", message: "Нет активного сервера Kosmora." };
    const url = server + MANIFEST_PATH;
    const { response, release } = await fetchUnredirected(fetcher, url, CHECK_TIMEOUT_MS);
    try {
      const manifest = JSON.parse(await readSmallBody(response, MAX_MANIFEST_BYTES));
      latest = {
        ...validateSignedManifest(manifest, { publicKeyPem, origin: server }),
        manifest,
        origin: server
      };
      if (compareVersions(latest.version, currentVersion()) <= 0)
        return { status: "current", version: currentVersion() };
      return { status: "available", version: latest.version, size: latest.size };
    } finally {
      release();
    }
  }

  async function stage() {
    // Always re-fetch and re-verify the signed manifest before writing an executable.
    const result = await check();
    if (result.status !== "available" || !latest)
      throw new Error("Нового подписанного релиза нет.");
    const candidate = latest;
    if (origin() !== candidate.origin)
      throw new Error("Активный сервер изменился; проверьте релиз заново.");
    const destination = path.join(releasesDir, packageFilename(candidate.version));
    if (await fileMatches(destination, candidate.sha256, candidate.size)) {
      if (origin() !== candidate.origin)
        throw new Error("Активный сервер изменился; проверьте релиз заново.");
      validateSignedManifest(candidate.manifest, { publicKeyPem, origin: candidate.origin });
      remember(candidate);
      return { file: destination, version: candidate.version, reused: true };
    }
    await fs.promises.mkdir(releasesDir, { recursive: true });
    const temporary = path.join(
      releasesDir,
      `.${packageFilename(candidate.version)}.${crypto.randomUUID()}.part`
    );
    let response, release;
    let handle;
    try {
      ({ response, release } = await fetchUnredirected(
        fetcher,
        candidate.assetUrl,
        DOWNLOAD_TIMEOUT_MS
      ));
      const contentLength = response.headers?.get("content-length");
      if (contentLength !== null && Number(contentLength) !== candidate.size)
        throw new Error("Размер загружаемого обновления не совпадает с манифестом.");
      if (!response.body) throw new Error("Пустой файл релиза.");
      handle = await fs.promises.open(temporary, "wx", 0o600);
      const reader = response.body.getReader();
      const digest = crypto.createHash("sha256");
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = Buffer.from(value);
          size += chunk.byteLength;
          if (size > candidate.size) throw new Error("Файл релиза превышает подписанный размер.");
          digest.update(chunk);
          let offset = 0;
          while (offset < chunk.byteLength) {
            const { bytesWritten } = await handle.write(chunk, offset, chunk.byteLength - offset);
            if (!bytesWritten) throw new Error("Не удалось записать файл обновления.");
            offset += bytesWritten;
          }
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      await handle.sync();
      await handle.close();
      handle = null;
      if (size !== candidate.size || digest.digest("hex") !== candidate.sha256)
        throw new Error("SHA-256 скачанного обновления не совпадает с подписанным манифестом.");
      // No execution or installer launch happens in this application.
      if (origin() !== candidate.origin)
        throw new Error("Активный сервер изменился во время загрузки.");
      validateSignedManifest(candidate.manifest, { publicKeyPem, origin: candidate.origin });
      await fs.promises.rename(temporary, destination);
      remember(candidate);
      return { file: destination, version: candidate.version, reused: false };
    } finally {
      if (handle) await handle.close().catch(() => {});
      if (release) release();
      await fs.promises.rm(temporary, { force: true }).catch(() => {});
    }
  }

  function remember(candidate) {
    const index = readIndex().filter((entry) => entry.version !== candidate.version);
    index.unshift({
      version: candidate.version,
      size: candidate.size,
      sha256: candidate.sha256,
      manifest: candidate.manifest,
      origin: candidate.origin
    });
    writeAtomicJson(indexFile, index.slice(0, 10));
  }

  async function previousVerified() {
    for (const entry of readIndex()) {
      // A mutable profile index is not a trust anchor. Revalidate the pinned-key
      // signature as well as the actual bytes before describing a rollback as verified.
      try {
        if (!publicKeyPem || entry.origin !== origin()) continue;
        const verified = validateSignedManifest(entry.manifest, {
          publicKeyPem,
          origin: entry.origin
        });
        if (
          verified.version !== entry.version ||
          verified.sha256 !== entry.sha256 ||
          verified.size !== entry.size
        )
          continue;
      } catch {
        continue;
      }
      if (compareVersions(entry.version, currentVersion()) >= 0) continue;
      const file = path.join(releasesDir, packageFilename(entry.version));
      if (await fileMatches(file, entry.sha256, entry.size))
        return { file, version: entry.version };
    }
    return null;
  }

  return { check, stage, previousVerified };
}

module.exports = { createUpdateService, fileMatches, packageFilename, readSmallBody };
