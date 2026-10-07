"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { WorkspaceIcon as Icon, type IconName } from "./workspace-icons";
import { PLANNED_CAPABILITIES, type CapabilityArea } from "./workspace-capabilities";
import styles from "./workspace-sections.module.css";
import { StudioFiles } from "./studio-files";
import type { ChatAttachment } from "@cosmora/contracts/chat-attachments";

export type ToolSurface =
  | "work"
  | "code"
  | "multi-agent"
  | "skills"
  | "studio"
  | "files"
  | "images"
  | "video"
  | "sound"
  | "apps"
  | "features"
  | "settings";
export const TOOL_ITEMS: { id: ToolSurface; label: string; description: string }[] = [
  { id: "work", label: "Work", description: "Проекты и результаты" },
  { id: "code", label: "Code", description: "Задачи разработки" },
  { id: "multi-agent", label: "Мультиагент", description: "Команда и роли" },
  { id: "skills", label: "Skills", description: "Навыки и специализации" },
  { id: "studio", label: "Kosmora Studio", description: "Изображения, видео и звук" },
  { id: "files", label: "Крупные файлы", description: "Документы, данные и код" },
  { id: "images", label: "Изображения", description: "Кадр, стиль и композиция" },
  { id: "video", label: "Видео", description: "Сцена и движение" },
  { id: "sound", label: "Sound", description: "Голос, музыка и атмосфера" },
  { id: "apps", label: "Приложения", description: "Внешние сервисы" },
  { id: "features", label: "Возможности", description: "Что уже работает и что появится" },
  { id: "settings", label: "Настройки", description: "Ваше пространство" }
];
export const STUDIO_ITEMS = TOOL_ITEMS.filter((item) =>
  ["files", "images", "video", "sound"].includes(item.id)
);
export type UiPreferences = { compact: boolean; largeText: boolean };
type OwnerSessionView = {
  status: "active" | "revoked" | "expired";
  assurance: "local" | "single_factor" | "multi_factor";
  actor_kind: "owner" | "system" | "agent";
  expires_at: string;
  last_seen_at: string;
  current: boolean;
};
type OwnerSessionState =
  | { phase: "loading" }
  | { phase: "unavailable" }
  | { phase: "ready"; current: OwnerSessionView | null; activeCount: number };

const isOwnerSessionView = (value: unknown): value is OwnerSessionView => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<OwnerSessionView>;
  return (
    (candidate.status === "active" ||
      candidate.status === "revoked" ||
      candidate.status === "expired") &&
    (candidate.assurance === "local" ||
      candidate.assurance === "single_factor" ||
      candidate.assurance === "multi_factor") &&
    (candidate.actor_kind === "owner" ||
      candidate.actor_kind === "system" ||
      candidate.actor_kind === "agent") &&
    typeof candidate.expires_at === "string" &&
    typeof candidate.last_seen_at === "string" &&
    typeof candidate.current === "boolean"
  );
};

const assuranceLabel = (assurance: OwnerSessionView["assurance"]): string => {
  if (assurance === "multi_factor") return "Многофакторная проверка";
  if (assurance === "single_factor") return "Подтверждённая сессия";
  return "Локальная проверка";
};

const formatSessionDate = (value: string): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "время не подтверждено";
  return parsed.toLocaleString("ru", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
};

const sessionNeedsRotation = (session: OwnerSessionView): boolean => {
  const expiresAt = new Date(session.expires_at).getTime();
  if (!Number.isFinite(expiresAt)) return false;
  return session.status !== "active" || expiresAt - Date.now() <= 48 * 60 * 60 * 1000;
};

export type WorkspaceProject = {
  id: string;
  title: string;
  status: "DRAFT" | "ACTIVE" | "FAILED" | "ARCHIVED";
  updated_at: string;
  last_message_preview: string | null;
};
type Props = {
  surface: ToolSurface;
  projects: WorkspaceProject[];
  activeProjectId: string | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onOpenProject: (id: string, view?: "chat" | "plan" | "project" | "context") => void;
  onCompose: (prompt: string, files?: ChatAttachment[]) => void;
  onNavigate: (surface: ToolSurface) => void;
  agentStudioHref: string;
  controlCenterHref: string;
  preferences: UiPreferences;
  onPreferences: (value: UiPreferences) => void;
  preferencesNotice: string;
  runtime: { mode: string; model: string; credential_configured: boolean } | null;
};

function Header({
  icon,
  eyebrow,
  title,
  children,
  action
}: {
  icon: IconName;
  eyebrow: string;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className={styles.hero}>
      <div className={styles.heroTop}>
        <div className={styles.heading}>
          <span className={styles.heroIcon} aria-hidden="true">
            <Icon name={icon} />
          </span>
          <div>
            <p className={styles.eyebrow}>{eyebrow}</p>
            <h2>{title}</h2>
          </div>
        </div>
        {action && <div className={styles.heroAction}>{action}</div>}
      </div>
      <p className={styles.lead}>{children}</p>
    </header>
  );
}
function ActionLink({
  href,
  children,
  primary = false
}: {
  href: string;
  children: ReactNode;
  primary?: boolean;
}) {
  return (
    <Link className={primary ? styles.primary : styles.secondary} href={href}>
      {children}
      <Icon name="arrow" />
    </Link>
  );
}
function Empty({ icon, title, children }: { icon: IconName; title: string; children: ReactNode }) {
  return (
    <div className={styles.empty}>
      <Icon name={icon} />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
function FutureHint({
  children,
  onNavigate
}: {
  children: ReactNode;
  onNavigate: (surface: ToolSurface) => void;
}) {
  return (
    <div className={styles.futureHint}>
      <Icon name="features" />
      <p>{children}</p>
      <button type="button" onClick={() => onNavigate("features")}>
        Что дальше <Icon name="arrow" />
      </button>
    </div>
  );
}
function ResourceCard({
  icon,
  title,
  text,
  href,
  label
}: {
  icon: IconName;
  title: string;
  text: string;
  href: string;
  label: string;
}) {
  return (
    <Link className={styles.resource} href={href}>
      <span className={styles.cardIcon}>
        <Icon name={icon} />
      </span>
      <div className={styles.resourceCopy}>
        <h3>{title}</h3>
        <p>{text}</p>
      </div>
      <span className={styles.cardLink}>
        {label}
        <Icon name="arrow" />
      </span>
    </Link>
  );
}

const STATUS = {
  DRAFT: "Черновик",
  ACTIVE: "В работе",
  FAILED: "Требует внимания",
  ARCHIVED: "Архив"
};
function Work({
  projects,
  loading,
  error,
  onRetry,
  onOpenProject,
  onCompose,
  onNavigate,
  activeProjectId
}: Props) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const items = projects
    .filter(
      (p) =>
        p.title.toLocaleLowerCase("ru").includes(query.toLocaleLowerCase("ru")) &&
        (filter === "all" ||
          (filter === "active" ? p.status !== "ARCHIVED" : p.status === "ARCHIVED"))
    )
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return (
    <>
      <Header
        icon="work"
        eyebrow="От замысла к результату"
        title="Work"
        action={
          <button
            className={styles.primary}
            onClick={() => onCompose("Хочу создать проект. Цель: \nРезультат: \nСрок: ")}
          >
            Начать с идеи
            <Icon name="arrow" />
          </button>
        }
      >
        Всё, что вы создаёте с Kosmora: проекты, контекст и следующие шаги.
      </Header>
      <div className={styles.metrics}>
        <div>
          <span>Всего проектов</span>
          <strong>{loading ? "—" : projects.length}</strong>
        </div>
        <div>
          <span>В работе</span>
          <strong>{loading ? "—" : projects.filter((p) => p.status === "ACTIVE").length}</strong>
        </div>
        <div>
          <span>Требуют внимания</span>
          <strong>{loading ? "—" : projects.filter((p) => p.status === "FAILED").length}</strong>
        </div>
      </div>
      <div className={styles.sectionHeading}>
        <h3>Ваши проекты</h3>
        <span>Сначала последние изменения</span>
      </div>
      <div className={styles.toolbar}>
        <label className={styles.search}>
          <Icon name="search" />
          <input
            aria-label="Поиск проектов"
            placeholder="Найти проект…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className={styles.segments} aria-label="Фильтр проектов">
          {[
            ["all", "Все"],
            ["active", "Текущие"],
            ["archive", "Архив"]
          ].map(([id, label]) => (
            <button key={id} aria-pressed={filter === id} onClick={() => setFilter(id ?? "all")}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {loading ? (
        <div className={styles.empty} role="status">
          Загружаем проекты…
        </div>
      ) : error && projects.length === 0 ? (
        <div className={styles.empty}>
          <h3>Не удалось загрузить проекты</h3>
          <p>{error}</p>
          <button className={styles.secondary} onClick={onRetry}>
            Повторить
          </button>
        </div>
      ) : items.length ? (
        <div className={styles.projectList}>
          {items.map((p) => (
            <article className={styles.project} key={p.id}>
              <span className={styles.projectIcon}>
                <Icon name="projects" />
              </span>
              <div className={styles.projectCopy}>
                <button className={styles.projectTitle} onClick={() => onOpenProject(p.id)}>
                  {p.title}
                </button>
                <p>{p.last_message_preview || "Добавьте цель и первый шаг проекта."}</p>
                <div className={styles.meta}>
                  <span className={p.status === "FAILED" ? styles.warningBadge : styles.badge}>
                    {STATUS[p.status]}
                  </span>
                  {activeProjectId === p.id && <span>Открыт сейчас</span>}
                  <time dateTime={p.updated_at}>
                    {new Date(p.updated_at).toLocaleDateString("ru", {
                      day: "numeric",
                      month: "short"
                    })}
                  </time>
                </div>
              </div>
              <div className={styles.projectActions}>
                <button onClick={() => onOpenProject(p.id, "plan")}>План</button>
                <button onClick={() => onOpenProject(p.id, "context")}>Контекст</button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty
          icon="projects"
          title={projects.length ? "Ничего не найдено" : "Здесь начнётся ваш первый проект"}
        >
          {projects.length
            ? "Попробуйте другое название или фильтр."
            : "Опишите цель в чате. Kosmora предложит создать проект, когда потребуется совместная работа над задачей."}
        </Empty>
      )}
      <p className={styles.footnote}>
        Кнопка «Начать с идеи» открывает черновик сообщения. Проект создаётся после вашего
        подтверждения.
      </p>
      <FutureHint onNavigate={onNavigate}>
        Глубинное исследование и переход обычного чата в Work предусмотрены в следующих этапах.
      </FutureHint>
    </>
  );
}

function Code({ onCompose }: Props) {
  const [task, setTask] = useState("");
  const [kind, setKind] = useState("Новая функция");
  const [criteria, setCriteria] = useState("");
  const [draftReady, setDraftReady] = useState(false);
  const [draftStorage, setDraftStorage] = useState(true);
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem("cosmora:code-brief");
      if (raw && raw.length <= 16000) {
        const saved: unknown = JSON.parse(raw);
        if (saved && typeof saved === "object") {
          const data = saved as Record<string, unknown>;
          if (typeof data.task === "string" && data.task.length <= 8000) setTask(data.task);
          if (typeof data.criteria === "string" && data.criteria.length <= 3000)
            setCriteria(data.criteria);
          if (
            typeof data.kind === "string" &&
            ["Новая функция", "Исправление", "Разбор кода"].includes(data.kind)
          )
            setKind(data.kind);
        }
      }
    } catch {
      /* A damaged draft must not prevent composing a new brief. */
    }
    setDraftReady(true);
  }, []);
  useEffect(() => {
    if (!draftReady) return;
    try {
      window.sessionStorage.setItem("cosmora:code-brief", JSON.stringify({ task, criteria, kind }));
    } catch {
      setDraftStorage(false);
    }
  }, [draftReady, task, criteria, kind]);
  return (
    <>
      <Header icon="code" eyebrow="Разработка с ясным результатом" title="Code">
        Соберите задание: что изменить, какие ограничения учесть и как проверить результат.
      </Header>
      <div className={styles.split}>
        <form
          className={styles.panel}
          onSubmit={(e) => {
            e.preventDefault();
            if (task.trim())
              onCompose(
                `Задача разработки: ${kind}\n\n${task.trim()}${criteria.trim() ? `\n\nКритерии готовности:\n${criteria.trim()}` : ""}\n\nСначала предложи план и необходимые проверки.`
              );
          }}
        >
          <div className={styles.panelHeading}>
            <span className={styles.badge}>01 / Задание</span>
            <h3>Что создаём?</h3>
          </div>
          <div className={styles.segments} aria-label="Тип задачи">
            {["Новая функция", "Исправление", "Разбор кода"].map((v) => (
              <button type="button" key={v} aria-pressed={kind === v} onClick={() => setKind(v)}>
                {v}
              </button>
            ))}
          </div>
          <label className={styles.field}>
            Описание задачи
            <textarea
              aria-label="Описание задачи разработки"
              disabled={!draftReady}
              value={task}
              onChange={(e) => setTask(e.target.value)}
              maxLength={8000}
              placeholder="Например: добавить поиск по проектам с фильтром по статусу…"
              rows={7}
            />
          </label>
          <label className={styles.field}>
            Критерии готовности <span>Необязательно</span>
            <textarea
              value={criteria}
              onChange={(e) => setCriteria(e.target.value)}
              maxLength={3000}
              placeholder="Ожидаемое поведение, проверки, ограничения…"
              rows={3}
            />
          </label>
          <div className={styles.formFooter}>
            <span>
              {draftStorage
                ? "Черновик хранится в этой вкладке. Откроется новый чат."
                : "Сохранение недоступно. Откроется новый чат."}
            </span>
            <button className={styles.primary} disabled={!task.trim()}>
              Обсудить с Kosmora
              <Icon name="arrow" />
            </button>
          </div>
        </form>
        <aside className={styles.aside}>
          <div className={styles.panel}>
            <h3>Рабочий процесс</h3>
            <ol className={styles.steps}>
              <li>
                <strong>Задача</strong>
                <span>Цель и критерии результата</span>
              </li>
              <li>
                <strong>План</strong>
                <span>Изменения и способы проверки</span>
              </li>
              <li>
                <strong>Результат</strong>
                <span>Файлы и обзор выполненного</span>
              </li>
            </ol>
          </div>
          <div className={styles.note}>
            <Icon name="code" />
            <strong>Файлы и изменения в GitHub</strong>
            <p>
              Откройте разрешённый репозиторий, прочитайте или измените файлы и проверьте diff. По
              вашему подтверждению Kosmora создаст отдельную ветку и черновик PR.
            </p>
            <ActionLink href="/github">Открыть GitHub</ActionLink>
          </div>
        </aside>
      </div>
    </>
  );
}

const MEDIA = {
  images: {
    label: "изображения",
    title: "Создание изображений",
    hint: "Опишите объект, композицию, свет и настроение.",
    sample: "Космическая обсерватория в горах на рассвете, мягкий свет, широкая композиция",
    formats: ["1:1", "16:9", "9:16", "4:3"],
    styles: ["Авто", "Фотореализм", "Иллюстрация", "Кино"],
    prompt: "Кадр, который вы представляете…"
  },
  video: {
    label: "видео",
    title: "Видео",
    hint: "Продумайте сцену, последовательность действий и движение камеры.",
    sample:
      "Камера медленно приближается к обсерватории. Купол открывается, в небе появляются звёзды",
    formats: ["16:9", "9:16", "1:1"],
    styles: ["Авто", "Кино", "Анимация", "Документальный"],
    prompt: "Что происходит в сцене и как движется камера…"
  },
  sound: {
    label: "аудио",
    title: "Sound",
    hint: "Задайте характер звука, темп и атмосферу.",
    sample: "Спокойная электронная композиция для ночной работы, мягкий синтезатор, без вокала",
    formats: ["Короткий", "Средний", "Длинный"],
    styles: ["Авто", "Голос", "Музыка", "Атмосфера"],
    prompt: "Как должен звучать результат…"
  }
};
type MediaSurface = keyof typeof MEDIA;
function Media({ surface }: { surface: MediaSurface }) {
  const config = MEDIA[surface];
  const [prompt, setPrompt] = useState("");
  const [format, setFormat] = useState<string>(
    config.formats[0] ?? (surface === "sound" ? "Короткий" : "1:1")
  );
  const [style, setStyle] = useState("Авто");
  const [output, setOutput] = useState("");
  const [notice, setNotice] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const key = `cosmora:studio-draft:${surface}`;
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(key);
      if (raw && raw.length <= 15000) {
        const saved: unknown = JSON.parse(raw);
        if (saved && typeof saved === "object") {
          const value = saved as Record<string, unknown>;
          if (typeof value.prompt === "string" && value.prompt.length <= 8000)
            setPrompt(value.prompt);
          if (typeof value.format === "string" && config.formats.includes(value.format))
            setFormat(value.format);
          if (typeof value.style === "string" && config.styles.includes(value.style))
            setStyle(value.style);
        }
      }
    } catch {
      setStorageAvailable(false);
    }
    setHydrated(true);
  }, [key, config]);
  useEffect(() => {
    if (!hydrated) return;
    try {
      window.sessionStorage.setItem(key, JSON.stringify({ prompt, format, style }));
    } catch {
      setStorageAvailable(false);
    }
  }, [key, prompt, format, style, hydrated]);
  const copyPrompt = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(output);
      setNotice("Промпт скопирован.");
    } catch {
      setNotice("Копирование недоступно. Скачайте промпт или выделите текст.");
    }
  };
  const invalidate = () => {
    setOutput("");
    setNotice("");
  };
  return (
    <>
      <Header icon={surface} eyebrow="Kosmora Studio / Редактор промпта" title={config.title}>
        {config.hint}
      </Header>
      <div className={styles.split}>
        <form
          className={styles.panel}
          onSubmit={(e) => {
            e.preventDefault();
            if (!prompt.trim()) return;
            setOutput(
              `Задача: создание ${config.label}\nФормат: ${format}\nСтиль: ${style}\n\n${prompt.trim()}`
            );
            setNotice(`Промпт для ${config.label} подготовлен локально.`);
          }}
        >
          <label className={styles.field}>
            Что вы хотите создать?
            <textarea
              aria-label={`Промпт для ${config.label}`}
              placeholder={config.prompt}
              value={prompt}
              disabled={!hydrated}
              maxLength={8000}
              rows={8}
              onChange={(e) => {
                setPrompt(e.target.value);
                invalidate();
              }}
            />
          </label>
          <button
            type="button"
            className={styles.textButton}
            onClick={() => {
              setPrompt(config.sample);
              invalidate();
            }}
          >
            Попробовать пример
          </button>
          <fieldset className={styles.fieldset}>
            <legend>{surface === "sound" ? "Длительность" : "Соотношение сторон"}</legend>
            <div className={styles.segments}>
              {config.formats.map((v) => (
                <button
                  type="button"
                  key={v}
                  aria-pressed={format === v}
                  onClick={() => {
                    setFormat(v);
                    invalidate();
                  }}
                >
                  {v}
                </button>
              ))}
            </div>
          </fieldset>
          <label className={styles.field}>
            Стиль
            <select
              value={style}
              onChange={(e) => {
                setStyle(e.target.value);
                invalidate();
              }}
            >
              {config.styles.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <div className={styles.formFooter}>
            <span>
              {storageAvailable
                ? "Черновик сохраняется в этой вкладке"
                : "Хранение черновика недоступно"}
            </span>
            <button className={styles.primary} disabled={!hydrated || !prompt.trim()}>
              Подготовить промпт
              <Icon name="arrow" />
            </button>
          </div>
        </form>
        <aside className={styles.aside}>
          <div className={styles.resultPanel}>
            <div className={styles.sectionHeading}>
              <h3>Готовый промпт</h3>
              <span className={styles.badge}>Текст</span>
            </div>
            {output ? (
              <>
                <pre className={styles.output}>{output}</pre>
                <div className={styles.actions}>
                  <button className={styles.secondary} onClick={() => void copyPrompt()}>
                    <Icon name="copy" />
                    Копировать
                  </button>
                  <button
                    className={styles.secondary}
                    onClick={() => {
                      const url = URL.createObjectURL(
                        new Blob([output], { type: "text/plain;charset=utf-8" })
                      );
                      const link = document.createElement("a");
                      link.href = url;
                      link.download = `kosmora-${surface}-prompt.txt`;
                      link.click();
                      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
                      setNotice("Промпт подготовлен для скачивания.");
                    }}
                  >
                    <Icon name="download" />
                    Скачать .txt
                  </button>
                </div>
              </>
            ) : (
              <Empty icon={surface} title="От идеи к точному запросу">
                Добавьте описание и параметры. Здесь появится текст для копирования или скачивания.
              </Empty>
            )}
            <p className={styles.notice} role="status">
              {notice}
            </p>
          </div>
          <div className={styles.note}>
            <Icon name="shield" />
            <strong>Внешняя модель не подключена</strong>
            <p>
              Изображение, видео или аудио здесь не генерируются. Подготовка промпта не вызывает
              модель.
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}

function Studio({ onNavigate }: Props) {
  return (
    <>
      <Header icon="studio" eyebrow="Творческое пространство" title="Kosmora Studio">
        Работайте с документами, готовьте изображения, видео и звук.
      </Header>
      <div className={styles.studioGrid}>
        {STUDIO_ITEMS.map((item) => (
          <button className={styles.studioCard} key={item.id} onClick={() => onNavigate(item.id)}>
            <div className={styles.studioArt} aria-hidden="true">
              <Icon name={item.id} />
            </div>
            <div className={styles.studioCopy}>
              <h3>{item.label}</h3>
              <p>{item.description}</p>
              <span>
                {item.id === "files" ? "Открыть анализ" : "Открыть редактор"}
                <Icon name="arrow" />
              </span>
            </div>
          </button>
        ))}
      </div>
      <p className={styles.footnote}>
        Документы: чтение, поиск и разбор частей в чате. Медиа: подготовка промптов и экспорт
        текста.
      </p>
      <FutureHint onNavigate={onNavigate}>
        Презентации и генерация медиа находятся в планах Studio.
      </FutureHint>
    </>
  );
}

function Team({ agentStudioHref, controlCenterHref, activeProjectId, onNavigate }: Props) {
  return (
    <>
      <Header
        icon="multi-agent"
        eyebrow="У каждого своя задача"
        title="Мультиагент"
        action={
          <ActionLink primary href={agentStudioHref}>
            Настроить команду
          </ActionLink>
        }
      >
        Вы собираете команду. Manager распределяет работу и привлекает Критика с учётом риска.
      </Header>
      <div className={styles.contextLine}>
        <Icon name="projects" />
        {activeProjectId ? "Настройка выбранного проекта" : "Каталог ролей · проект не выбран"}
        <span className={styles.badge}>Схема ролей</span>
      </div>
      <div className={styles.roleGrid}>
        {[
          {
            id: "work",
            title: "Manager",
            sub: "Организует работу",
            text: "Уточняет цель, составляет план, выбирает исполнителя и показывает ход задачи."
          },
          {
            id: "code",
            title: "Исполнитель",
            sub: "Создаёт результат",
            text: "Аналитик или Архитектор выполняет свою часть задачи в рамках выданных полномочий."
          },
          {
            id: "shield",
            title: "Критик",
            sub: "Проверяет по риску",
            text: "Оценивает черновик и указывает, что нужно исправить до принятия результата."
          }
        ].map((role, i) => (
          <article className={styles.roleCard} key={role.title}>
            <div className={styles.roleTop}>
              <span className={styles.cardIcon}>
                <Icon name={role.id as IconName} />
              </span>
              <span className={styles.eyebrow}>0{i + 1}</span>
            </div>
            <h3>{role.title}</h3>
            <strong>{role.sub}</strong>
            <p>{role.text}</p>
          </article>
        ))}
      </div>
      <div className={styles.twoColumns}>
        <div className={styles.panel}>
          <h3>Как управляется команда</h3>
          <ul className={styles.bulletList}>
            <li>Состав команды задаёт владелец.</li>
            <li>Право Manager менять состав зависит от автономности и разрешений.</li>
            <li>Проверка Критиком определяется риском задачи.</li>
          </ul>
          <p className={styles.footnote}>
            Это правила проектируемого интерфейса. Фактические разрешения проверяются в центре
            управления.
          </p>
        </div>
        <div className={styles.panel}>
          <h3>Роли, модели и разрешения</h3>
          <p>
            Agent Studio содержит настройки ролей и предложения агентов. Разрешения выбранного
            проекта доступны в центре управления.
          </p>
          <div className={styles.actions}>
            <ActionLink href={agentStudioHref}>Agent Studio</ActionLink>
            <ActionLink href={controlCenterHref}>Разрешения</ActionLink>
          </div>
        </div>
      </div>
      <FutureHint onNavigate={onNavigate}>
        Коллективные чаты и личные диалоги с агентами получат отдельные права видимости.
      </FutureHint>
    </>
  );
}

function Skills({ agentStudioHref, controlCenterHref }: Props) {
  return (
    <>
      <Header icon="skills" eyebrow="Специализации вашей команды" title="Skills">
        Выбирайте навыки для задачи и проверяйте, какие действия они запрашивают.
      </Header>
      <div className={styles.resourceList}>
        <ResourceCard
          icon="skills"
          title="Каталог Skills"
          text="Просмотр описаний, манифестов и запрашиваемых разрешений."
          href="/skills"
          label="Смотреть каталог"
        />
        <ResourceCard
          icon="multi-agent"
          title="Навыки команды"
          text="Свяжите функции, поведение и роли в конфигурации агента."
          href={agentStudioHref}
          label="Открыть Agent Studio"
        />
        <ResourceCard
          icon="shield"
          title="Контроль доступа"
          text="Проверьте полномочия и ожидающие решения проекта."
          href={controlCenterHref}
          label="Проверить разрешения"
        />
      </div>
      <div className={styles.note}>
        <Icon name="skills" />
        <strong>Каталог работает в режиме предпросмотра</strong>
        <p>
          Установка и выполнение сторонних навыков, публикация и обмен пользовательскими профилями
          пока недоступны.
        </p>
      </div>
    </>
  );
}

function Apps({ onNavigate }: Props) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const applications = [
    {
      name: "GitHub",
      icon: "code",
      category: "Разработка",
      text: "Чтение и редактирование файлов, проверка изменений и создание черновика PR.",
      available: true
    },
    {
      name: "Google Drive",
      icon: "projects",
      category: "Материалы",
      text: "Документы и файлы для контекста проекта.",
      available: false
    },
    {
      name: "Telegram",
      icon: "chats",
      category: "Общение",
      text: "Материалы из чатов и уведомления проекта.",
      available: false
    }
  ];
  const items = applications.filter(
    (a) =>
      (filter === "all" || a.available) &&
      `${a.name} ${a.category}`.toLowerCase().includes(query.toLowerCase())
  );
  return (
    <>
      <Header icon="apps" eyebrow="Kosmora и ваши инструменты" title="Приложения">
        Подключения, их возможности и статус — в одном месте.
      </Header>
      <div className={styles.toolbar}>
        <label className={styles.search}>
          <Icon name="search" />
          <input
            aria-label="Поиск приложений"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Найти приложение…"
          />
        </label>
        <div className={styles.segments} aria-label="Фильтр приложений">
          {[
            ["all", "Все"],
            ["preview", "Доступные"]
          ].map(([id, label]) => (
            <button key={id} aria-pressed={filter === id} onClick={() => setFilter(id ?? "all")}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.appList}>
        {items.map((app) => (
          <article className={styles.appCard} key={app.name}>
            <span className={styles.cardIcon} aria-hidden="true">
              <Icon name={app.icon as IconName} />
            </span>
            <div className={styles.appCopy}>
              <h3>{app.name}</h3>
              <span className={styles.eyebrow}>{app.category}</span>
              <p>{app.text}</p>
            </div>
            <div className={styles.appStatus}>
              <span className={styles.badge}>
                {app.available ? "Серверное подключение" : "Запланировано"}
              </span>
              {app.available ? (
                <ActionLink href="/github">Открыть GitHub</ActionLink>
              ) : (
                <span className={styles.unavailable}>Интеграция ещё недоступна</span>
              )}
            </div>
          </article>
        ))}
      </div>
      {!items.length && (
        <Empty icon="search" title="Приложение не найдено">
          Измените запрос или фильтр.
        </Empty>
      )}
      <div className={styles.note}>
        <Icon name="shield" />
        <strong>Доступ GitHub ограничен одним репозиторием</strong>
        <p>
          Статус серверного подключения проверяется в модуле GitHub. Создание ветки и черновика PR
          требует вашего подтверждения после просмотра изменений.
        </p>
      </div>
      <FutureHint onNavigate={onNavigate}>
        Подключение аккаунтов появится после настройки входа и управления доступом.
      </FutureHint>
    </>
  );
}

const CAPABILITY_AREAS: readonly ("Все" | CapabilityArea)[] = [
  "Все",
  "Работа",
  "Творчество",
  "Команда",
  "Платформа"
];

function Features({ onNavigate }: Props) {
  const [area, setArea] = useState<(typeof CAPABILITY_AREAS)[number]>("Все");
  const [query, setQuery] = useState("");
  const search = query.trim().toLocaleLowerCase("ru");
  const items = PLANNED_CAPABILITIES.filter(
    (item) =>
      (area === "Все" || item.area === area) &&
      (!search ||
        `${item.title} ${item.description} ${item.area}`.toLocaleLowerCase("ru").includes(search))
  );
  const current = [
    { id: "work", label: "Work", detail: "Проекты и ход работы", icon: "work" },
    { id: "code", label: "Code", detail: "Черновик задачи разработки", icon: "code" },
    { id: "studio", label: "Studio", detail: "Редакторы промптов", icon: "studio" }
  ] as const;
  return (
    <>
      <Header icon="features" eyebrow="Карта продукта" title="Возможности">
        Что доступно для работы сейчас и какие интерфейсы появятся по мере подключения функций.
      </Header>
      <div className={styles.sectionHeading}>
        <h3>Можно открыть сейчас</h3>
        <span>Статус функций зависит от подключения API и модели</span>
      </div>
      <div className={styles.featureQuickGrid}>
        {current.map((item) => (
          <button
            type="button"
            className={styles.featureQuick}
            key={item.id}
            onClick={() => onNavigate(item.id)}
          >
            <span className={styles.cardIcon}>
              <Icon name={item.icon} />
            </span>
            <span>
              <strong>{item.label}</strong>
              <small>{item.detail}</small>
            </span>
            <Icon name="arrow" />
          </button>
        ))}
      </div>
      <div className={styles.featureHeading}>
        <div>
          <h3>Следующие возможности</h3>
          <p>Концепции интерфейса и условия запуска. Даты готовности пока не назначены.</p>
        </div>
        <span className={styles.badge}>{PLANNED_CAPABILITIES.length} в планах</span>
      </div>
      <div className={styles.featureFilters}>
        <label className={styles.search}>
          <Icon name="search" />
          <input
            aria-label="Поиск возможностей"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Найти функцию…"
          />
        </label>
        <div className={styles.segments} aria-label="Категория возможностей">
          {CAPABILITY_AREAS.map((option) => (
            <button
              type="button"
              key={option}
              aria-pressed={area === option}
              onClick={() => setArea(option)}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
      {items.length ? (
        <div className={styles.featureList}>
          {items.map((item) => (
            <details key={item.id} className={styles.featureItem}>
              <summary>
                <span className={styles.cardIcon}>
                  <Icon name={item.icon} />
                </span>
                <span className={styles.featureCopy}>
                  <strong>{item.title}</strong>
                  <small>{item.description}</small>
                </span>
                <span className={styles.featureArea}>{item.area}</span>
                <Icon name="arrow" />
              </summary>
              <div className={styles.featureDetails}>
                <strong>Для запуска потребуется</strong>
                <ul>
                  {item.requirements.map((requirement) => (
                    <li key={requirement}>{requirement}</li>
                  ))}
                </ul>
                <span className={styles.badge}>Ещё не подключено</span>
              </div>
            </details>
          ))}
        </div>
      ) : (
        <Empty icon="search" title="Ничего не найдено">
          Попробуйте другой запрос или категорию.
        </Empty>
      )}
    </>
  );
}

function Settings({
  preferences,
  onPreferences,
  preferencesNotice,
  runtime,
  controlCenterHref,
  agentStudioHref,
  onNavigate
}: Props) {
  const [tab, setTab] = useState("general");
  const [ownerSessionState, setOwnerSessionState] = useState<OwnerSessionState>({
    phase: "loading"
  });

  useEffect(() => {
    let active = true;
    const loadOwnerSession = async (): Promise<void> => {
      try {
        const response = await fetch("/api/v1/identity/sessions", { cache: "no-store" });
        if (!response.ok) throw new Error("owner-session-unavailable");
        const payload = (await response.json()) as { items?: unknown };
        if (!Array.isArray(payload.items)) throw new Error("owner-session-invalid");
        if (!payload.items.every(isOwnerSessionView)) throw new Error("owner-session-invalid");
        const sessions = payload.items;
        const current =
          sessions.find((session) => session.current && session.actor_kind === "owner") ?? null;
        if (active) {
          setOwnerSessionState({
            phase: "ready",
            current,
            activeCount: sessions.filter(
              (session) => session.status === "active" && session.actor_kind === "owner"
            ).length
          });
        }
      } catch {
        if (active) setOwnerSessionState({ phase: "unavailable" });
      }
    };

    void loadOwnerSession();
    return () => {
      active = false;
    };
  }, []);

  const currentOwnerSession =
    ownerSessionState.phase === "ready" ? ownerSessionState.current : null;
  const ownerSessionHealthy = currentOwnerSession?.status === "active";
  const ownerSessionExpiryLabel = currentOwnerSession
    ? formatSessionDate(currentOwnerSession.expires_at)
    : null;

  return (
    <>
      <Header icon="settings" eyebrow="Ваше пространство" title="Настройки">
        Внешний вид, модель и управление работой Kosmora.
      </Header>
      <div className={styles.settingsLayout}>
        <nav className={styles.settingsNav} aria-label="Категории настроек">
          {[
            ["general", "Общее", "owner"],
            ["model", "Модель и API", "cosmora"],
            ["access", "Автономность", "shield"],
            ["team", "Команда", "multi-agent"]
          ].map(([id, label, icon]) => (
            <button key={id} aria-pressed={tab === id} onClick={() => setTab(id ?? "general")}>
              <Icon name={icon as IconName} />
              {label}
            </button>
          ))}
        </nav>
        <div className={styles.panel}>
          {tab === "general" ? (
            <>
              <div className={styles.profileSummary}>
                <span className={styles.profileAvatar}>
                  <Icon name="owner" />
                </span>
                <div>
                  <h3>Владелец</h3>
                  <p>
                    {ownerSessionState.phase === "loading"
                      ? "Проверяем текущую сессию…"
                      : ownerSessionHealthy
                        ? "Доступ подтверждён сервером"
                        : "Статус сессии требует внимания"}
                  </p>
                </div>
                <span className={styles.badge}>
                  {ownerSessionState.phase === "loading"
                    ? "Проверка"
                    : ownerSessionHealthy
                      ? "Активна"
                      : "Нет подтверждения"}
                </span>
              </div>
              <h3>Доступ владельца</h3>
              <div className={styles.statusBox} data-testid="owner-session-status">
                <span className={styles.badge}>
                  {ownerSessionState.phase === "loading"
                    ? "Проверяем"
                    : ownerSessionHealthy
                      ? "Сессия активна"
                      : "Недоступно"}
                </span>
                <strong>
                  {currentOwnerSession
                    ? assuranceLabel(currentOwnerSession.assurance)
                    : ownerSessionState.phase === "loading"
                      ? "Получаем состояние с сервера"
                      : "Текущая сессия не подтверждена"}
                </strong>
              </div>
              {ownerSessionState.phase === "ready" && currentOwnerSession ? (
                <>
                  <p>
                    Действует до <strong>{ownerSessionExpiryLabel}</strong>.
                  </p>
                  <p>Активных сессий владельца: {ownerSessionState.activeCount}.</p>
                  {sessionNeedsRotation(currentOwnerSession) && (
                    <p className={styles.notice} role="status">
                      Срок действия текущей сессии близок к завершению или сессия уже неактивна.
                      Обновите доступ до следующего обслуживания.
                    </p>
                  )}
                </>
              ) : ownerSessionState.phase === "unavailable" ? (
                <p className={styles.footnote}>
                  Сервер не подтвердил состояние текущей сессии. Остальные настройки остаются
                  доступны, но перед обслуживанием или запуском проверьте доступ владельца.
                </p>
              ) : null}
              <h3>Интерфейс</h3>
              <label className={styles.settingRow}>
                <span>
                  <strong>Компактная навигация</strong>
                  <small>Меньше отступов в боковой панели</small>
                </span>
                <input
                  type="checkbox"
                  checked={preferences.compact}
                  onChange={(e) => onPreferences({ ...preferences, compact: e.target.checked })}
                />
              </label>
              <label className={styles.settingRow}>
                <span>
                  <strong>Увеличенный текст</strong>
                  <small>Более крупный текст чата и разделов</small>
                </span>
                <input
                  type="checkbox"
                  checked={preferences.largeText}
                  onChange={(e) => onPreferences({ ...preferences, largeText: e.target.checked })}
                />
              </label>
              <p className={styles.notice} role="status">
                {preferencesNotice}
              </p>
              <p className={styles.footnote}>
                Настройки интерфейса сохраняются в этом браузере. Текущая сессия владельца
                подтверждается сервером; вход через Google и Telegram, синхронизация профиля и
                совместные аккаунты пока недоступны.
              </p>
              <button
                type="button"
                className={styles.textButton}
                onClick={() => onNavigate("features")}
              >
                Посмотреть будущие возможности →
              </button>
            </>
          ) : tab === "model" ? (
            <>
              <h3>Подключение модели</h3>
              <div className={styles.statusBox}>
                <span className={styles.badge}>
                  {!runtime
                    ? "Нет данных"
                    : runtime.mode === "mock"
                      ? "Демонстрационный режим"
                      : runtime.credential_configured
                        ? "Провайдер настроен"
                        : "Требуется настройка"}
                </span>
                <strong>
                  {runtime?.mode !== "mock" && runtime
                    ? runtime.model
                    : "Модель для обычного чата и Manager"}
                </strong>
              </div>
              <p>
                Проверьте текущую конфигурацию и доступность модели. Настроенный провайдер ещё не
                означает успешный ответ.
              </p>
              <ActionLink primary href="/model-status">
                Открыть диагностику
              </ActionLink>
            </>
          ) : tab === "access" ? (
            <>
              <h3>Автономность и подтверждения</h3>
              <p>
                Уровень автономности и полномочия проверяются для выбранного проекта. Здесь можно
                перейти к его профилю, разрешениям и ожидающим решениям.
              </p>
              <ActionLink primary href={controlCenterHref}>
                Центр управления
              </ActionLink>
              <p className={styles.footnote}>Внешний вид интерфейса не меняет права агентов.</p>
            </>
          ) : (
            <>
              <h3>Команда проекта</h3>
              <p>
                Настройте роли и конфигурации агентов в Agent Studio. Совместные чаты пользователей
                и персональные беседы с агентами пока не подключены.
              </p>
              <ActionLink primary href={agentStudioHref}>
                Настроить команду
              </ActionLink>
            </>
          )}
        </div>
      </div>
    </>
  );
}

export function WorkspaceSections(props: Props) {
  let content: ReactNode;
  switch (props.surface) {
    case "work":
      content = <Work {...props} />;
      break;
    case "code":
      content = <Code {...props} />;
      break;
    case "multi-agent":
      content = <Team {...props} />;
      break;
    case "skills":
      content = <Skills {...props} />;
      break;
    case "studio":
      content = <Studio {...props} />;
      break;
    case "files":
      content = <StudioFiles onCompose={props.onCompose} />;
      break;
    case "apps":
      content = <Apps {...props} />;
      break;
    case "features":
      content = <Features {...props} />;
      break;
    case "settings":
      content = <Settings {...props} />;
      break;
    default:
      content = <Media surface={props.surface} key={props.surface} />;
  }
  return (
    <section
      className={`capability-workspace ${styles.root}`}
      aria-label={TOOL_ITEMS.find((item) => item.id === props.surface)?.label}
    >
      {content}
    </section>
  );
}
