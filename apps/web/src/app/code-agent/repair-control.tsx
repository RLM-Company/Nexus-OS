"use client";

import { useRef, useState } from "react";
import styles from "./code-agent.module.css";

/** This command is rendered only after the server advertises repair_once v1. */
export function CodeRepairControl({
  disabled,
  reviewHash,
  repair
}: {
  disabled: boolean;
  reviewHash: string;
  repair: (request: { review_hash: string; client_request_id: string; approve: true }) => void;
}) {
  const [approved, setApproved] = useState(false);
  const requestId = useRef<string | null>(null);
  return (
    <div aria-label="Исправление по результату проверки">
      <p>
        Одна модельная попытка исправления с повтором той же проверки. Затем требуется новый
        просмотр diff.
      </p>
      <label className={styles.checkbox}>
        <input
          type="checkbox"
          checked={approved}
          disabled={disabled}
          onChange={(event) => setApproved(event.target.checked)}
        />
        Разрешаю одну дополнительную модельную попытку и повтор проверки; расход учитывается в
        текущем бюджете
      </label>
      <button
        disabled={disabled || !approved}
        onClick={() => {
          requestId.current ??= crypto.randomUUID();
          repair({ review_hash: reviewHash, client_request_id: requestId.current, approve: true });
          setApproved(false);
        }}
      >
        Исправить по результату проверки
      </button>
    </div>
  );
}
