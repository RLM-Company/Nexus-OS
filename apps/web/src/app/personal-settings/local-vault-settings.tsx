"use client";
import { useEffect, useState } from "react";
import { localVaultBridge } from "../use-local-vault";
export function LocalVaultSettings() {
  const [available, setAvailable] = useState(false),
    [error, setError] = useState("");
  useEffect(() => setAvailable(Boolean(localVaultBridge())), []);
  return (
    <section>
      <h2>Локальное хранилище</h2>
      <p>
        Оригиналы и снимки памяти в выбранной папке на вашем ПК. Для передачи текста в чат нужно
        отдельное подтверждение.
      </p>
      {available ? (
        <button
          type="button"
          onClick={() => {
            void localVaultBridge()
              ?.open()
              .then((r) =>
                setError(r.ok ? "" : "Для открытия нужен подтверждённый вход в приложении.")
              )
              .catch(() => setError("Не удалось открыть локальное окно."));
          }}
        >
          Открыть локальное хранилище
        </button>
      ) : (
        <p>Доступно в Windows-приложении Kosmora с поддержкой локального хранилища.</p>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
