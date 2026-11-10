"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { OfficeOperation } from "@cosmora/contracts";
import {
  deleteOfficeDraft,
  officeDraftKey,
  OFFICE_DRAFT_PREFIX,
  readOfficeDraft,
  restoreOfficeDraft,
  saveOfficeDraft,
  type OfficeDraftSnapshot,
  type OfficeDraftSource
} from "./office-draft-storage";

export function OfficePlanDraft({
  source,
  operations,
  disabled,
  onRestore
}: {
  source: OfficeDraftSource;
  operations: OfficeOperation[];
  disabled: boolean;
  onRestore: (operations: OfficeOperation[]) => void;
}) {
  const [snapshot, setSnapshot] = useState<OfficeDraftSnapshot | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const active = useRef(false);
  useLayoutEffect(() => {
    active.current = !disabled;
    return () => {
      active.current = false;
    };
  }, [disabled]);
  const { name, version, existingSheets } = source;
  const refresh = useCallback(() => {
    try {
      const next = readOfficeDraft(window.localStorage, { name, version, existingSheets });
      setSnapshot(next);
      setNotice(next.notice);
      setError("");
    } catch {
      setError("Хранилище браузера недоступно. Текущий план остаётся в редакторе.");
    }
  }, [name, version, existingSheets]);
  useEffect(() => {
    refresh();
    const changed = (event: StorageEvent) => {
      if (event.key === null || event.key === officeDraftKey({ name, version, existingSheets }))
        setNotice(
          "Сохранённый черновик изменился в другой вкладке. Проверьте его снова перед действием."
        );
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [refresh, name, version, existingSheets]);
  const action = async (fn: () => void) => {
    try {
      if (!navigator.locks)
        throw Error(
          "Для работы с черновиками требуется браузер с Web Locks и HTTPS или localhost."
        );
      await navigator.locks.request(OFFICE_DRAFT_PREFIX, { ifAvailable: true }, (lock) => {
        if (!lock)
          throw Error(
            "Черновик сейчас используется другой вкладкой. Повторите действие после её завершения."
          );
        if (!active.current) return;
        fn();
      });
      setError("");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Хранилище браузера недоступно.");
    }
  };
  return (
    <fieldset disabled={disabled}>
      <legend>Черновик плана в этом браузере</legend>
      <p>
        По кнопке сохраняются тексты и значения правок, имя и версия исходника. Восстановление
        доступно 7 дней; запись удаляется отдельной кнопкой. Файл, preview и подтверждение записи не
        сохраняются. После перезагрузки выберите тот же файл и восстановите план. Черновик доступен
        пользователям этого профиля браузера. Сохраняются только правки, добавленные в план;
        незавершённые поля не включаются.
      </p>
      <button
        type="button"
        disabled={!snapshot || !operations.length}
        onClick={() =>
          void action(() => {
            const next = saveOfficeDraft(
              window.localStorage,
              source,
              operations,
              snapshot!.raw,
              crypto.randomUUID()
            );
            setSnapshot(next);
            setNotice(
              "Черновик сохранён в этом браузере. Последующие изменения сохраняйте этой кнопкой снова."
            );
          })
        }
      >
        Сохранить черновик плана
      </button>
      <button
        type="button"
        disabled={!snapshot?.operations}
        onClick={() =>
          void action(() => {
            const restored = restoreOfficeDraft(window.localStorage, source, snapshot!.raw!);
            onRestore(restored);
            setNotice(
              "План восстановлен. Проверьте его и запросите новый preview перед подтверждением."
            );
          })
        }
      >
        Восстановить черновик плана
      </button>
      <button
        type="button"
        disabled={!snapshot?.raw}
        onClick={() =>
          void action(() => {
            deleteOfficeDraft(window.localStorage, source, snapshot!.raw!);
            setSnapshot({ raw: null, operations: null, notice: "" });
            setNotice("Сохранённый черновик удалён. Текущий план в редакторе не изменён.");
          })
        }
      >
        Удалить сохранённый черновик
      </button>
      <button type="button" onClick={refresh}>
        Проверить сохранённый черновик
      </button>
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </fieldset>
  );
}
