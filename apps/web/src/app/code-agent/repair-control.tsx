"use client";

import { useRef, useState } from "react";
import styles from "./code-agent.module.css";

/** This command is rendered only after the server advertises repair_once v2. */
export function CodeRepairControl({
  disabled,
  reviewHash,
  expectedVersion,
  checkType,
  repair
}: {
  disabled: boolean;
  reviewHash: string;
  expectedVersion: number;
  checkType: "syntax" | "node-test";
  repair: (request: {
    review_hash: string;
    expected_run_version: number;
    client_request_id: string;
    approve: true;
  }) => void;
}) {
  const [approved, setApproved] = useState(false);
  const requestId = useRef<string | null>(null);
  return (
    <div aria-label="Исправление по результату проверки">
      <p>
        Одна модельная попытка исправления с повтором той же проверки. Затем требуется новый
        просмотр diff. Проверка:{" "}
        <code>{checkType === "syntax" ? "node --check" : "node --test"}</code>.
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
          repair({
            review_hash: reviewHash,
            expected_run_version: expectedVersion,
            client_request_id: requestId.current,
            approve: true
          });
          setApproved(false);
        }}
      >
        Исправить по результату проверки
      </button>
    </div>
  );
}
