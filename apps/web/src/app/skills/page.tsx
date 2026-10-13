"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { loadMockSkillCatalog } from "./skills-manifest";
import styles from "./skills.module.css";

type Draft = { name: string; summary: string; instructions: string };
type Skill = {
  id: string;
  name: string;
  summary: string;
  current_version: number;
  updated_at: string;
};
type Revision = Draft & { version: number; created_at: string };
type Detail = { skill: Skill; versions: Revision[] };
const empty: Draft = { name: "", summary: "", instructions: "" };
const catalog = loadMockSkillCatalog();

const errorLabel = (code: string) =>
  ({
    VERSION_CONFLICT:
      "Другая версия уже сохранена. Откройте инструкцию заново и проверьте изменения.",
    LIMIT_REACHED: "Достигнут лимит: 50 инструкций или 20 версий одной инструкции.",
    INVALID_SKILL: "Заполните название, описание и инструкцию без управляющих символов.",
    OWNER_DATA_FENCED: "Изменения временно заблокированы операцией с данными аккаунта.",
    NOT_FOUND: "Инструкция или версия больше не существует. Обновите список."
  })[code] ?? "Не удалось выполнить действие. Попробуйте ещё раз.";

async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`/api/v1/owner-skills${path}`, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as { error?: { code?: string } };
    throw Error(errorLabel(error.error?.code ?? ""));
  }
  return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>);
}

export default function SkillsPage() {
  const [items, setItems] = useState<Skill[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [draft, setDraft] = useState<Draft>(empty);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const refresh = useCallback(async () => {
    const result = await api<{ items: Skill[] }>("");
    setItems(result.items);
  }, []);
  useEffect(() => {
    void refresh()
      .catch((cause: Error) => setMessage(cause.message))
      .finally(() => setLoading(false));
  }, [refresh]);
  const open = async (id: string) => {
    setMessage("");
    try {
      const value = await api<Detail>(`/${encodeURIComponent(id)}`);
      setSelected(id);
      setDetail(value);
      const latest = value.versions[0];
      setDraft(
        latest
          ? { name: latest.name, summary: latest.summary, instructions: latest.instructions }
          : empty
      );
      setPreview(false);
    } catch (cause) {
      setMessage((cause as Error).message);
    }
  };
  const createNew = () => {
    setSelected(null);
    setDetail(null);
    setDraft(empty);
    setPreview(false);
    setMessage("");
  };
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage("");
    try {
      await action();
      await refresh();
    } catch (cause) {
      setMessage((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const save = () =>
    void run(async () => {
      if (selected && detail) {
        await api<Skill>(`/${encodeURIComponent(selected)}`, "PUT", {
          ...draft,
          expected_version: detail.skill.current_version
        });
        await open(selected);
      } else {
        const saved = await api<Skill>("", "POST", draft);
        await open(saved.id);
      }
      setMessage("Версия сохранена.");
    });
  const restore = (version: number) =>
    void run(async () => {
      if (!selected || !detail) return;
      await api<Skill>(`/${encodeURIComponent(selected)}/restore`, "POST", {
        expected_version: detail.skill.current_version,
        source_version: version
      });
      await open(selected);
      setMessage(`Версия ${version} восстановлена как новая версия.`);
    });
  const remove = () =>
    void run(async () => {
      if (!selected || !detail || !window.confirm(`Удалить «${detail.skill.name}» и все версии?`))
        return;
      await api<void>(`/${encodeURIComponent(selected)}`, "DELETE", {
        expected_version: detail.skill.current_version
      });
      createNew();
      setMessage("Инструкция удалена.");
    });
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <Link className={styles.backLink} href="/">
            ← Назад в Kosmora
          </Link>
          <div>
            <p className={styles.eyebrow}>Мои инструкции</p>
            <h1>Skills</h1>
            <p className={styles.lead}>
              Создавайте приватные инструкции, проверяйте их текст и возвращайтесь к прошлым
              версиям.
            </p>
          </div>
        </header>
        <section className={styles.boundary} aria-label="Граница Skills">
          <strong>Инструкции без исполнения</strong>
          <p>
            Инструкции сохраняются в вашем аккаунте. Предпросмотр показывает текст; запуск кода,
            установка пакетов и выдача разрешений здесь недоступны.
          </p>
        </section>
        <div className={styles.workspace}>
          <aside className={styles.sidebar} aria-label="Мои Skills">
            <div className={styles.sidebarHeader}>
              <h2>Мои Skills</h2>
              <button type="button" onClick={createNew}>
                Новая
              </button>
            </div>
            {loading ? (
              <p>Загрузка…</p>
            ) : items.length === 0 ? (
              <p>Инструкций пока нет.</p>
            ) : (
              items.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={selected === item.id ? styles.activeSkill : styles.skillRow}
                  onClick={() => void open(item.id)}
                >
                  <strong>{item.name}</strong>
                  <small>Версия {item.current_version}</small>
                </button>
              ))
            )}
          </aside>
          <section className={styles.editor} aria-label="Редактор Skill">
            <div className={styles.editorHeading}>
              <h2>{selected ? "Редактирование" : "Новая инструкция"}</h2>
              <span>{detail ? `v${detail.skill.current_version}` : "Черновик"}</span>
            </div>
            {message && (
              <p role="status" className={styles.message}>
                {message}
              </p>
            )}
            <label>
              Название
              <input
                value={draft.name}
                maxLength={80}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder="Например, проверка документа"
              />
            </label>
            <label>
              Краткое описание
              <input
                value={draft.summary}
                maxLength={240}
                onChange={(event) => setDraft({ ...draft, summary: event.target.value })}
                placeholder="Что помогает сделать инструкция"
              />
            </label>
            <label>
              Инструкция
              <textarea
                value={draft.instructions}
                maxLength={20_000}
                onChange={(event) => setDraft({ ...draft, instructions: event.target.value })}
                rows={13}
                placeholder="Опишите шаги и ожидаемый результат…"
              />
            </label>
            <div className={styles.actions}>
              <button type="button" disabled={busy || loading} onClick={save}>
                Сохранить версию
              </button>
              <button type="button" disabled={busy} onClick={() => setPreview(!preview)}>
                {preview ? "Скрыть предпросмотр" : "Предпросмотр"}
              </button>
              {selected && (
                <button type="button" disabled={busy} onClick={remove}>
                  Удалить
                </button>
              )}
            </div>
            {preview && (
              <section className={styles.preview} aria-label="Предпросмотр инструкции">
                <h3>{draft.name || "Без названия"}</h3>
                <p>{draft.summary}</p>
                <pre>{draft.instructions}</pre>
              </section>
            )}
            {detail && (
              <section className={styles.history} aria-label="История версий">
                <h3>История версий</h3>
                {detail.versions.map((revision) => (
                  <div key={revision.version}>
                    <span>
                      v{revision.version} · {new Date(revision.created_at).toLocaleString("ru-RU")}
                    </span>
                    <button
                      type="button"
                      disabled={busy || revision.version === detail.skill.current_version}
                      onClick={() => restore(revision.version)}
                    >
                      Восстановить
                    </button>
                  </div>
                ))}
              </section>
            )}
          </section>
        </div>
        <section className={styles.examples} aria-label="Примеры контрактов">
          <h2>Примеры контрактов</h2>
          <div className={styles.catalog}>
            {catalog.map((skill) => (
              <article className={styles.card} key={skill.id}>
                <header className={styles.cardHeader}>
                  <div>
                    <small>
                      {skill.id} · v{skill.version}
                    </small>
                    <h3>{skill.name}</h3>
                  </div>
                  <span className={styles.badge}>Mock</span>
                </header>
                <p className={styles.summary}>{skill.summary}</p>
                <section className={styles.permissions} aria-label={`Разрешения ${skill.name}`}>
                  <h3>Разрешения для примера</h3>
                  {skill.permissions.map((permission) => (
                    <div className={styles.permission} key={permission.id}>
                      <div>
                        <strong>{permission.label}</strong>
                        <small>{permission.id}</small>
                      </div>
                      <span>{permission.mode === "read" ? "Чтение" : "Предпросмотр"}</span>
                      <p>{permission.description}</p>
                    </div>
                  ))}
                </section>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
