"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { loadMockSkillCatalog } from "./skills-manifest";
import styles from "./skills.module.css";

import {
  asDraft,
  draftKey,
  emptyDraft,
  filterSkills,
  normalizeDraft,
  type Draft,
  type Skill,
  type Revision,
  type Detail,
  type SkillPackage
} from "./skill-model";
import { skillApi as api, SkillApiError, writeSkillVersion } from "./skill-client";
import { createSkillPackage, downloadSkillPackage } from "./skill-package";
import { SkillImport } from "./skill-import";
import { SkillReview } from "./skill-review";
const catalog = loadMockSkillCatalog();

export default function SkillsPage() {
  const [items, setItems] = useState<Skill[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [saved, setSaved] = useState(draftKey(emptyDraft()));
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [reviewVersion, setReviewVersion] = useState<number | null>(null);
  const [uncertainCreation, setUncertainCreation] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const lock = useRef(false);
  const generation = useRef(0);
  const dirty = draftKey(draft) !== saved;
  const visibleItems = filterSkills(items, query);
  const refresh = useCallback(async () => {
    const current = generation.current;
    const result = await api<{ items: Skill[] }>("");
    if (current === generation.current) setItems(result.items);
  }, []);
  useEffect(() => {
    const current = generation.current;
    void refresh()
      .catch((cause: Error) => {
        if (current === generation.current) setMessage(cause.message);
      })
      .finally(() => {
        if (current === generation.current) setLoading(false);
      });
    return () => {
      generation.current++;
    };
  }, [refresh]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const accept = (value: Detail) => {
    const latest = value.versions.find(
      (version) => version.version === value.skill.current_version
    );
    if (!latest)
      throw Error("Не удалось прочитать актуальную версию. Черновик сохранён в редакторе.");
    setSelected(value.skill.id);
    setDetail(value);
    setDraft(asDraft(latest));
    setSaved(draftKey(latest));
    setPreview(false);
    setReviewVersion(null);
  };
  const discard = () =>
    !dirty || window.confirm("Есть несохранённые изменения Skill. Заменить черновик?");
  const run = async (action: (active: () => boolean) => Promise<void>) => {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    setMessage("");
    const current = generation.current;
    const active = () => current === generation.current;
    try {
      await action(active);
      return true;
    } catch (cause) {
      if (active()) setMessage(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      lock.current = false;
      if (active()) setBusy(false);
    }
  };
  const refreshAfter = async (active: () => boolean) => {
    try {
      await refresh();
    } catch {
      if (active())
        setMessage("Действие выполнено, но список не обновился. Нажмите «Обновить список».");
    }
  };
  const open = async (id: string) => {
    if (lock.current || !discard()) return;
    await run(async (active) => {
      const value = await api<Detail>(`/${encodeURIComponent(id)}`);
      if (active()) {
        accept(value);
        if (id === createdId) {
          setCreatedId(null);
          setUncertainCreation(false);
        }
      }
    });
  };
  const createNew = () => {
    if (lock.current || !discard()) return;
    setSelected(null);
    setDetail(null);
    setDraft(emptyDraft());
    setSaved(draftKey(emptyDraft()));
    setPreview(false);
    setReviewVersion(null);
    setMessage("");
  };
  const copy = () => {
    if (lock.current) return;
    setSelected(null);
    setDetail(null);
    setSaved(draftKey(emptyDraft()));
    setReviewVersion(null);
    setMessage(
      "Независимый черновик подготовлен. Сохраните его как новую инструкцию; подключения исходного Skill не копируются."
    );
  };
  const create = async (path: string, body: Draft | SkillPackage, active: () => boolean) => {
    if (uncertainCreation)
      throw Error("Сначала проверьте результат предыдущего создания в списке.");
    setUncertainCreation(true);
    setCreatedId(null);
    let savedSkill: Skill;
    try {
      savedSkill = await api<Skill>(path, "POST", body);
    } catch (cause) {
      if (active() && cause instanceof SkillApiError && cause.status < 500)
        setUncertainCreation(false);
      else if (active()) {
        await refresh().catch(() => {});
        throw Error(
          "Ответ на создание не получен. Инструкция могла сохраниться. Проверьте список перед новым созданием.",
          { cause }
        );
      }
      throw cause;
    }
    if (!active()) return;
    setCreatedId(savedSkill.id);
    const value = await api<Detail>(`/${encodeURIComponent(savedSkill.id)}`);
    if (!active()) return;
    accept(value);
    setUncertainCreation(false);
    setCreatedId(null);
    setMessage("Новая инструкция сохранена.");
    await refreshAfter(active);
  };
  const save = () =>
    void run(async (active) => {
      normalizeDraft(draft);
      if (selected && detail) {
        const value = await writeSkillVersion(selected, detail.skill.current_version, draft);
        if (active()) {
          accept(value);
          setMessage("Версия сохранена.");
          await refreshAfter(active);
        }
      } else await create("", draft, active);
    });
  const restore = (version: number, expectedVersion: number, reviewedDraft: string) => {
    if (
      !selected ||
      !detail ||
      detail.skill.current_version !== expectedVersion ||
      draftKey(draft) !== reviewedDraft
    )
      return;
    const source = detail.versions.find((item) => item.version === version);
    if (
      !source ||
      !window.confirm(
        `Восстановить версию ${version} как новую? Несохранённый черновик будет заменён.`
      )
    )
      return;
    void run(async (active) => {
      const value = await writeSkillVersion(selected, expectedVersion, source, version);
      if (active()) {
        accept(value);
        setMessage(`Версия ${version} восстановлена как новая.`);
        await refreshAfter(active);
      }
    });
  };
  const remove = () => {
    if (
      !selected ||
      !detail ||
      !window.confirm(
        `Удалить «${detail.skill.name}» и все версии?${dirty ? " Несохранённые правки тоже будут потеряны." : ""}`
      )
    )
      return;
    void run(async (active) => {
      await api<void>(`/${encodeURIComponent(selected)}`, "DELETE", {
        expected_version: detail.skill.current_version
      });
      if (active()) {
        setSelected(null);
        setDetail(null);
        setDraft(emptyDraft());
        setSaved(draftKey(emptyDraft()));
        setReviewVersion(null);
        setMessage("Инструкция удалена.");
        await refreshAfter(active);
      }
    });
  };
  const exportDraft = (value: Draft, name: string) =>
    void run(async (active) => {
      const pack = await createSkillPackage(value);
      if (active()) downloadSkillPackage(pack, name);
    });
  const importSkill = async (value: SkillPackage) => {
    if (lock.current || !discard()) return false;
    return run((active) => create("/import", value, active));
  };
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <Link
            className={styles.backLink}
            href="/"
            onClick={(event) => {
              if (!discard()) event.preventDefault();
            }}
          >
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
              <button type="button" disabled={busy || loading} onClick={createNew}>
                Новая
              </button>
            </div>
            <SkillImport
              busy={busy || loading}
              blocked={uncertainCreation}
              onImport={importSkill}
            />
            <label className={styles.search}>
              Поиск Skills
              <input
                value={query}
                maxLength={320}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Название или описание"
              />
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await refresh();
                })
              }
            >
              Обновить список
            </button>
            <p>
              {visibleItems.length} из {items.length}
            </p>
            {loading ? (
              <p>Загрузка…</p>
            ) : items.length === 0 ? (
              <p>Инструкций пока нет.</p>
            ) : (
              visibleItems.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={selected === item.id ? styles.activeSkill : styles.skillRow}
                  disabled={busy}
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
              <span>
                {detail ? `v${detail.skill.current_version}` : "Черновик"} ·{" "}
                {dirty ? "Не сохранено" : "Без изменений"}
              </span>
            </div>
            {message && (
              <p role="status" className={styles.message}>
                {message}
              </p>
            )}
            {uncertainCreation && (
              <section className={styles.preview} aria-label="Проверка создания">
                <p>
                  Проверьте список: предыдущая инструкция могла сохраниться. Автоматического повтора
                  не будет.
                </p>
                {createdId ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (!discard()) return;
                      void run(async (active) => {
                        const value = await api<Detail>(`/${encodeURIComponent(createdId)}`);
                        if (active()) {
                          accept(value);
                          setCreatedId(null);
                          setUncertainCreation(false);
                        }
                      });
                    }}
                  >
                    Открыть созданную инструкцию
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Вы проверили список и убедились, что предыдущая инструкция не создана? Новая попытка может создать копию."
                        )
                      )
                        setUncertainCreation(false);
                    }}
                  >
                    Проверил список — разрешить новое создание
                  </button>
                )}
              </section>
            )}
            <label>
              Название
              <input
                disabled={busy || loading}
                value={draft.name}
                maxLength={80}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder="Например, проверка документа"
              />
            </label>
            <label>
              Краткое описание
              <input
                disabled={busy || loading}
                value={draft.summary}
                maxLength={240}
                onChange={(event) => setDraft({ ...draft, summary: event.target.value })}
                placeholder="Что помогает сделать инструкция"
              />
            </label>
            <label>
              Инструкция
              <textarea
                disabled={busy || loading}
                value={draft.instructions}
                maxLength={20_000}
                onChange={(event) => setDraft({ ...draft, instructions: event.target.value })}
                rows={13}
                placeholder="Опишите шаги и ожидаемый результат…"
              />
            </label>
            <div className={styles.actions}>
              <button
                type="button"
                disabled={busy || loading || !dirty || (!selected && uncertainCreation)}
                onClick={save}
              >
                Сохранить версию
              </button>
              <button type="button" disabled={busy} onClick={() => setPreview(!preview)}>
                {preview ? "Скрыть предпросмотр" : "Предпросмотр"}
              </button>
              <button
                type="button"
                disabled={busy || loading}
                onClick={() => exportDraft(draft, "kosmora-skill-draft")}
              >
                Скачать черновик
              </button>
              {selected && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(async (active) => {
                      const pack = await api<SkillPackage>(
                        `/${encodeURIComponent(selected)}/package`
                      );
                      if (active()) downloadSkillPackage(pack, "kosmora-skill-saved");
                    })
                  }
                >
                  Скачать сохранённый пакет
                </button>
              )}
              {selected && (
                <button type="button" disabled={busy} onClick={copy}>
                  Копировать в новый черновик
                </button>
              )}
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
            {detail &&
              reviewVersion !== null &&
              detail.versions.find((value) => value.version === reviewVersion) && (
                <SkillReview
                  id={detail.skill.id}
                  currentVersion={detail.skill.current_version}
                  draft={draft}
                  revision={detail.versions.find((value) => value.version === reviewVersion)!}
                  busy={busy}
                  onRestore={restore}
                  onDownload={(revision: Revision) =>
                    exportDraft(revision, `kosmora-skill-v${revision.version}`)
                  }
                />
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
                      disabled={busy}
                      onClick={() => setReviewVersion(revision.version)}
                    >
                      Посмотреть версию {revision.version}
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
