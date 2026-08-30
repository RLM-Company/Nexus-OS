"use client";

import { useMemo, useState, type FormEvent } from "react";
import styles from "./catalog-controls.module.css";

type AgentFunction = {
  function_id: string;
  version: number;
  name: string;
};

type BehaviorPattern = {
  pattern_id: string;
  version: number;
  name: string;
};

type CatalogControlsProps = {
  projectId: string;
  functions: AgentFunction[];
  patterns: BehaviorPattern[];
  onSaved: () => Promise<void> | void;
};

type MutationKind = "function" | "pattern" | "archive";

const formString = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
};

const readError = async (response: Response): Promise<Error> => {
  const body = (await response.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  return new Error(body?.error?.message ?? `Cosmora API returned ${response.status}`);
};

const postJson = async (url: string, payload: unknown): Promise<void> => {
  const response = await fetch(url, {
    method: "POST",
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      "idempotency-key": `agent-studio-ui-${crypto.randomUUID()}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) throw await readError(response);
};

const postAction = async (url: string): Promise<void> => {
  const response = await fetch(url, { method: "POST", cache: "no-store" });
  if (!response.ok) throw await readError(response);
};

export default function CatalogControls({
  projectId,
  functions,
  patterns,
  onSaved
}: CatalogControlsProps) {
  const [pending, setPending] = useState<MutationKind | null>(null);
  const [functionTarget, setFunctionTarget] = useState("");
  const [patternTarget, setPatternTarget] = useState("");
  const [archiveTarget, setArchiveTarget] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedFunction = functions.find((item) => item.function_id === functionTarget);
  const selectedPattern = patterns.find((item) => item.pattern_id === patternTarget);
  const selectedArchivePattern = patterns.find((item) => item.pattern_id === archiveTarget);
  const base = `/api/v1/projects/${encodeURIComponent(projectId)}/agent-studio`;

  const functionOptions = useMemo(
    () => [...functions].sort((a, b) => a.name.localeCompare(b.name, "ru")),
    [functions]
  );
  const patternOptions = useMemo(
    () => [...patterns].sort((a, b) => a.name.localeCompare(b.name, "ru")),
    [patterns]
  );

  const saveFunction = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const payload = {
      name: formString(form, "function-name"),
      description: formString(form, "function-description"),
      result_contract: formString(form, "function-result-contract")
    };
    if (!payload.name || !payload.description || !payload.result_contract) return;

    setPending("function");
    setNotice(null);
    setError(null);
    try {
      if (selectedFunction) {
        await postJson(
          `${base}/functions/${encodeURIComponent(selectedFunction.function_id)}/versions`,
          {
            ...payload,
            expected_version: selectedFunction.version
          }
        );
        setNotice(`Новая версия функции сохранена: v${selectedFunction.version + 1}.`);
      } else {
        await postJson(`${base}/functions`, payload);
        setNotice("Функция создана как immutable v1.");
      }
      formElement.reset();
      setFunctionTarget("");
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить функцию");
    } finally {
      setPending(null);
    }
  };

  const savePattern = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const allowedFunctionIds = form
      .getAll("pattern-function")
      .filter((value): value is string => typeof value === "string" && value.length > 0);
    const limitations = formString(form, "pattern-limitations")
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean);
    const payload = {
      name: formString(form, "pattern-name"),
      description: formString(form, "pattern-description"),
      instructions: formString(form, "pattern-instructions"),
      allowed_function_ids: allowedFunctionIds,
      known_limitations: limitations,
      test_status: formString(form, "pattern-status") || "untested"
    };
    if (
      !payload.name ||
      !payload.description ||
      !payload.instructions ||
      allowedFunctionIds.length === 0
    ) {
      return;
    }

    setPending("pattern");
    setNotice(null);
    setError(null);
    try {
      if (selectedPattern) {
        await postJson(
          `${base}/patterns/${encodeURIComponent(selectedPattern.pattern_id)}/versions`,
          {
            ...payload,
            expected_version: selectedPattern.version
          }
        );
        setNotice(`Новая версия паттерна сохранена: v${selectedPattern.version + 1}.`);
      } else {
        await postJson(`${base}/patterns`, payload);
        setNotice("Паттерн создан как immutable v1.");
      }
      formElement.reset();
      setPatternTarget("");
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить паттерн");
    } finally {
      setPending(null);
    }
  };

  const archivePattern = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!selectedArchivePattern) return;

    setPending("archive");
    setNotice(null);
    setError(null);
    try {
      await postAction(
        `${base}/patterns/${encodeURIComponent(selectedArchivePattern.pattern_id)}/archive`
      );
      setArchiveTarget("");
      setPatternTarget("");
      await onSaved();
      setNotice("Паттерн архивирован. Новые композиции больше не увидят его в активном каталоге.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось архивировать паттерн");
    } finally {
      setPending(null);
    }
  };

  return (
    <div className={styles.editor}>
      <div className={styles.boundary}>
        <strong>Versioned catalog</strong>
        <span>Правка создаёт новую версию. Существующая версия никогда не переписывается.</span>
      </div>

      <div className={styles.forms}>
        <form onSubmit={(event) => void saveFunction(event)}>
          <div className={styles.heading}>
            <span>Function</span>
            <strong>
              {selectedFunction ? `Новая версия v${selectedFunction.version + 1}` : "Новая функция"}
            </strong>
          </div>
          <label htmlFor="function-target">Режим</label>
          <select
            id="function-target"
            value={functionTarget}
            onChange={(event) => setFunctionTarget(event.target.value)}
            disabled={pending !== null}
          >
            <option value="">Создать новую v1</option>
            {functionOptions.map((item) => (
              <option key={item.function_id} value={item.function_id}>
                Новая версия · {item.name} · v{item.version}
              </option>
            ))}
          </select>
          <label htmlFor="function-name">Название</label>
          <input id="function-name" name="function-name" required disabled={pending !== null} />
          <label htmlFor="function-description">Описание</label>
          <textarea
            id="function-description"
            name="function-description"
            rows={2}
            required
            disabled={pending !== null}
          />
          <label htmlFor="function-result-contract">Контракт результата</label>
          <textarea
            id="function-result-contract"
            name="function-result-contract"
            rows={2}
            required
            disabled={pending !== null}
          />
          <button disabled={pending !== null}>
            {pending === "function"
              ? "Сохраняю…"
              : selectedFunction
                ? "Создать версию"
                : "Создать функцию"}
          </button>
        </form>

        <form onSubmit={(event) => void savePattern(event)}>
          <div className={styles.heading}>
            <span>Behavior pattern</span>
            <strong>
              {selectedPattern ? `Новая версия v${selectedPattern.version + 1}` : "Новый паттерн"}
            </strong>
          </div>
          <label htmlFor="pattern-target">Режим</label>
          <select
            id="pattern-target"
            value={patternTarget}
            onChange={(event) => setPatternTarget(event.target.value)}
            disabled={pending !== null}
          >
            <option value="">Создать новую v1</option>
            {patternOptions.map((item) => (
              <option key={item.pattern_id} value={item.pattern_id}>
                Новая версия · {item.name} · v{item.version}
              </option>
            ))}
          </select>
          <label htmlFor="pattern-name">Название</label>
          <input id="pattern-name" name="pattern-name" required disabled={pending !== null} />
          <label htmlFor="pattern-description">Описание</label>
          <textarea
            id="pattern-description"
            name="pattern-description"
            rows={2}
            required
            disabled={pending !== null}
          />
          <label htmlFor="pattern-instructions">Инструкции</label>
          <textarea
            id="pattern-instructions"
            name="pattern-instructions"
            rows={3}
            required
            disabled={pending !== null}
          />
          <fieldset>
            <legend>Разрешённые функции</legend>
            {functionOptions.map((item) => (
              <label className={styles.check} key={item.function_id}>
                <input
                  type="checkbox"
                  name="pattern-function"
                  value={item.function_id}
                  disabled={pending !== null}
                />
                <span>
                  {item.name} · v{item.version}
                </span>
              </label>
            ))}
            {functionOptions.length === 0 && <small>Сначала создайте хотя бы одну функцию.</small>}
          </fieldset>
          <label htmlFor="pattern-limitations">Известные ограничения · по одному на строку</label>
          <textarea
            id="pattern-limitations"
            name="pattern-limitations"
            rows={2}
            disabled={pending !== null}
          />
          <label htmlFor="pattern-status">Статус тестирования</label>
          <select
            id="pattern-status"
            name="pattern-status"
            defaultValue="untested"
            disabled={pending !== null}
          >
            <option value="untested">untested</option>
            <option value="verified">verified</option>
            <option value="restricted">restricted</option>
            <option value="rejected">rejected</option>
          </select>
          <button disabled={pending !== null || functionOptions.length === 0}>
            {pending === "pattern"
              ? "Сохраняю…"
              : selectedPattern
                ? "Создать версию"
                : "Создать паттерн"}
          </button>
        </form>
      </div>

      <form className={styles.archive} onSubmit={(event) => void archivePattern(event)}>
        <div>
          <strong>Архив паттерна</strong>
          <span>Архивная версия исключается из активного каталога и новых композиций.</span>
        </div>
        <select
          id="archive-pattern-target"
          aria-label="Паттерн для архивации"
          value={archiveTarget}
          onChange={(event) => setArchiveTarget(event.target.value)}
          disabled={pending !== null || patternOptions.length === 0}
          required
        >
          <option value="">Выберите активный паттерн</option>
          {patternOptions.map((item) => (
            <option key={item.pattern_id} value={item.pattern_id}>
              {item.name} · v{item.version}
            </option>
          ))}
        </select>
        <button disabled={pending !== null || !selectedArchivePattern}>
          {pending === "archive" ? "Архивирую…" : "Архивировать паттерн"}
        </button>
      </form>

      {notice && <p className={styles.notice}>{notice}</p>}
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
