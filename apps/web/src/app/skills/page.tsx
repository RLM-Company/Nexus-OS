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
import {
  skillApi as api,
  SkillApiError,
  writeSkillVersion,
  createSkillOnce,
  readSkillCreation
} from "./skill-client";
import { createSkillPackage, downloadSkillPackage } from "./skill-package";
import { SkillImport } from "./skill-import";
import { SkillReview } from "./skill-review";
import {
  clearPendingCreation,
  readPendingCreation,
  savePendingCreation,
  type PendingCreation
} from "./skill-creation";
import { emptySkillHistory, recordSkillEdit, travelSkillHistory } from "./skill-history";
import { SkillSearchPanel } from "./skill-search-panel";
import type { SkillMatch } from "./skill-search";
const catalog = loadMockSkillCatalog();

export default function SkillsPage() {
  const [scope, setScope] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void api<{ owner_scope: string }>("/scope")
      .then((result) => {
        if (!/^[a-f0-9]{64}$/.test(result.owner_scope))
          throw Error("Не удалось проверить аккаунт.");
        if (active) setScope(result.owner_scope);
      })
      .catch((cause: Error) => {
        if (active) setError(cause.message);
      });
    return () => {
      active = false;
    };
  }, []);
  if (!scope)
    return (
      <main>
        <p role="status">{error || "Проверяем аккаунт…"}</p>
        <Link href="/">Назад в Kosmora</Link>
      </main>
    );
  return <SkillsLibrary key={scope} ownerScope={scope} />;
}
function SkillsLibrary({ ownerScope }: { ownerScope: string }) {
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
  const [pendingCreation, setPendingCreation] = useState<PendingCreation | null>(null);
  const [storageError, setStorageError] = useState(false);
  const uncertainCreation = pendingCreation !== null || storageError;
  const editorLocked = busy || uncertainCreation;
  const history = useRef(emptySkillHistory());
  const editEpoch = useRef(0);
  const fields = useRef<Partial<Record<keyof Draft, HTMLInputElement | HTMLTextAreaElement>>>({});
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
    try {
      const pending = readPendingCreation(window.sessionStorage, ownerScope);
      setPendingCreation(pending);
      if (pending) {
        setDraft(pending.draft);
        setMessage(
          "Найдена незавершённая попытка создания. Проверьте результат или повторите её с тем же ключом."
        );
      }
    } catch (cause) {
      setStorageError(true);
      setMessage(cause instanceof Error ? cause.message : String(cause));
    }
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
  }, [refresh, ownerScope]);
  useEffect(() => {
    if (!dirty && !uncertainCreation) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, uncertainCreation]);
  const endEditGroup = () => {
    history.current.group = null;
  };
  const editDraft = (next: Draft, group: keyof Draft | null = null) => {
    if (lock.current || uncertainCreation || loading || draftKey(next) === draftKey(draft)) return;
    history.current = recordSkillEdit(history.current, draft, next, group);
    editEpoch.current++;
    setDraft(asDraft(next));
    setMessage("");
  };
  const undoRedo = (direction: "undo" | "redo") => {
    if (lock.current || uncertainCreation || loading) return;
    const result = travelSkillHistory(history.current, draft, direction);
    if (!result) return;
    history.current = result.history;
    editEpoch.current++;
    setDraft(result.draft);
    setMessage("");
  };
  const selectMatch = (match: SkillMatch) => {
    const field = fields.current[match.field];
    if (!field || editorLocked || loading) return;
    field.focus();
    field.setSelectionRange(match.start, match.end);
  };
  const accept = (value: Detail, keepHistory = false) => {
    const latest = value.versions.find(
      (version) => version.version === value.skill.current_version
    );
    if (!latest)
      throw Error("Не удалось прочитать актуальную версию. Черновик сохранён в редакторе.");
    history.current = keepHistory
      ? recordSkillEdit(history.current, draft, asDraft(latest))
      : emptySkillHistory();
    endEditGroup();
    editEpoch.current++;
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
    if (lock.current || uncertainCreation || !discard()) return;
    await run(async (active) => {
      const value = await api<Detail>(`/${encodeURIComponent(id)}`);
      if (active()) {
        accept(value);
      }
    });
  };
  const createNew = () => {
    if (lock.current || uncertainCreation || !discard()) return;
    history.current = emptySkillHistory();
    editEpoch.current++;
    setSelected(null);
    setDetail(null);
    setDraft(emptyDraft());
    setSaved(draftKey(emptyDraft()));
    setPreview(false);
    setReviewVersion(null);
    setMessage("");
  };
  const copy = () => {
    if (lock.current || uncertainCreation) return;
    history.current = emptySkillHistory();
    editEpoch.current++;
    setSelected(null);
    setDetail(null);
    setSaved(draftKey(emptyDraft()));
    setReviewVersion(null);
    setMessage(
      "Независимый черновик подготовлен. Сохраните его как новую инструкцию; подключения исходного Skill не копируются."
    );
  };
  const finishCreation = async (value: Detail, active: () => boolean) => {
    if (!active()) return;
    // Validate and accept canonical detail before removing the only local recovery key.
    accept(value);
    clearPendingCreation(window.sessionStorage, ownerScope);
    setPendingCreation(null);
    setMessage("Инструкция сохранена. Открыта её актуальная версия.");
    await refreshAfter(active);
  };
  const create = async (path: string, body: Draft | SkillPackage, active: () => boolean) => {
    if (uncertainCreation) throw Error("Сначала завершите предыдущую попытку создания.");
    const pending = { requestId: crypto.randomUUID(), draft: normalizeDraft(body) };
    savePendingCreation(window.sessionStorage, ownerScope, pending);
    setPendingCreation(pending);
    try {
      await finishCreation(
        await createSkillOnce(pending.draft, pending.requestId, path, body),
        active
      );
    } catch (cause) {
      if (cause instanceof SkillApiError) throw cause;
      throw new Error(
        "Ответ на создание не получен. Проверьте результат или повторите сохранённую попытку.",
        { cause }
      );
    }
  };
  const recoverCreation = (retry: boolean) =>
    void run(async (active) => {
      if (!pendingCreation) return;
      const value = retry
        ? await createSkillOnce(pendingCreation.draft, pendingCreation.requestId)
        : await readSkillCreation(pendingCreation.requestId);
      await finishCreation(value, active);
    });
  const forgetCreation = () => {
    if (
      lock.current ||
      !window.confirm(
        "Сбросить локальную попытку? Уже созданная инструкция останется в списке. Новое создание будет отдельной копией."
      )
    )
      return;
    try {
      clearPendingCreation(window.sessionStorage, ownerScope);
      setPendingCreation(null);
      setStorageError(false);
      setMessage("Локальная попытка сброшена. Проверьте список перед созданием новой копии.");
    } catch {
      setMessage("Не удалось сбросить попытку в этой вкладке.");
    }
  };
  const save = () =>
    void run(async (active) => {
      if (uncertainCreation) return;
      normalizeDraft(draft);
      if (selected && detail) {
        const value = await writeSkillVersion(selected, detail.skill.current_version, draft);
        if (active()) {
          accept(value, true);
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
        history.current = emptySkillHistory();
        editEpoch.current++;
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
    if (lock.current || uncertainCreation || !discard()) return false;
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
              <button type="button" disabled={editorLocked || loading} onClick={createNew}>
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
                  disabled={editorLocked}
                  onClick={() => void open(item.id)}
                >
                  <strong>{item.name}</strong>
                  <small>Версия {item.current_version}</small>
                </button>
              ))
            )}
          </aside>
          <section
            className={styles.editor}
            aria-label="Редактор Skill"
            onKeyDown={(event) => {
              if (
                event.nativeEvent.isComposing ||
                event.altKey ||
                !(event.ctrlKey || event.metaKey)
              )
                return;
              const target = event.target as HTMLElement;
              if (!target.closest("[data-skill-field], [data-skill-history]")) return;
              const key = event.key.toLowerCase();
              if (key !== "z" && key !== "y") return;
              event.preventDefault();
              undoRedo(key === "y" || event.shiftKey ? "redo" : "undo");
            }}
          >
            <div className={styles.editorHeading}>
              <h2>{selected ? "Редактирование" : "Новая инструкция"}</h2>
              <span>
                {detail ? `v${detail.skill.current_version}` : "Черновик"} ·{" "}
                {dirty ? "Не сохранено" : "Без изменений"}
              </span>
            </div>
            <div className={styles.actions} data-skill-history>
              <button
                type="button"
                disabled={editorLocked || loading || !history.current.past.length}
                onClick={() => undoRedo("undo")}
              >
                Отменить правку
              </button>
              <button
                type="button"
                disabled={editorLocked || loading || !history.current.future.length}
                onClick={() => undoRedo("redo")}
              >
                Повторить правку
              </button>
            </div>
            {message && (
              <p role="status" className={styles.message}>
                {message}
              </p>
            )}
            {uncertainCreation && (
              <section className={styles.preview} aria-label="Проверка создания">
                <p>
                  Попытка сохранена в этой вкладке. Проверка только читает сервер; повтор использует
                  прежний ключ и не создаёт дубликат.
                </p>
                {pendingCreation && (
                  <>
                    <h3>{pendingCreation.draft.name}</h3>
                    <p>{pendingCreation.draft.summary}</p>
                    <pre>{pendingCreation.draft.instructions}</pre>
                    <button type="button" disabled={busy} onClick={() => recoverCreation(false)}>
                      Проверить результат создания
                    </button>
                    <button type="button" disabled={busy} onClick={() => recoverCreation(true)}>
                      Повторить сохранённую попытку
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => exportDraft(pendingCreation.draft, "kosmora-skill-pending")}
                    >
                      Скачать текст попытки
                    </button>
                  </>
                )}
                <button type="button" disabled={busy} onClick={forgetCreation}>
                  Сбросить локальную попытку
                </button>
              </section>
            )}
            <label>
              Название
              <input
                disabled={editorLocked || loading}
                data-skill-field
                ref={(element) => {
                  if (element) fields.current.name = element;
                }}
                onBlur={endEditGroup}
                value={draft.name}
                maxLength={80}
                onChange={(event) => editDraft({ ...draft, name: event.target.value }, "name")}
                placeholder="Например, проверка документа"
              />
            </label>
            <label>
              Краткое описание
              <input
                disabled={editorLocked || loading}
                data-skill-field
                ref={(element) => {
                  if (element) fields.current.summary = element;
                }}
                onBlur={endEditGroup}
                value={draft.summary}
                maxLength={240}
                onChange={(event) =>
                  editDraft({ ...draft, summary: event.target.value }, "summary")
                }
                placeholder="Что помогает сделать инструкция"
              />
            </label>
            <label>
              Инструкция
              <textarea
                disabled={editorLocked || loading}
                data-skill-field
                ref={(element) => {
                  if (element) fields.current.instructions = element;
                }}
                onBlur={endEditGroup}
                value={draft.instructions}
                maxLength={20_000}
                onChange={(event) =>
                  editDraft({ ...draft, instructions: event.target.value }, "instructions")
                }
                rows={13}
                placeholder="Опишите шаги и ожидаемый результат…"
              />
            </label>
            <div className={styles.actions}>
              <button type="button" disabled={editorLocked || loading || !dirty} onClick={save}>
                Сохранить версию
              </button>
              <button type="button" disabled={busy} onClick={() => setPreview(!preview)}>
                {preview ? "Скрыть предпросмотр" : "Предпросмотр"}
              </button>
              <button
                type="button"
                disabled={editorLocked || loading}
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
                <button type="button" disabled={editorLocked} onClick={copy}>
                  Копировать в новый черновик
                </button>
              )}
              {selected && (
                <button type="button" disabled={editorLocked} onClick={remove}>
                  Удалить
                </button>
              )}
            </div>
            <SkillSearchPanel
              key={`${selected ?? "new"}:${detail?.skill.current_version ?? 0}`}
              draft={draft}
              epoch={editEpoch.current}
              busy={editorLocked || loading}
              onSelect={selectMatch}
              onApply={(before, next, epoch) => {
                if (epoch === editEpoch.current && before === draftKey(draft)) editDraft(next);
              }}
            />
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
                  draftEpoch={editEpoch.current}
                  revision={detail.versions.find((value) => value.version === reviewVersion)!}
                  busy={editorLocked}
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
