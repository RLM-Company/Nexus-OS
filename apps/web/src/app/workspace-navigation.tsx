"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { WorkspaceIcon as Icon } from "./workspace-icons";
import styles from "./workspace-navigation.module.css";
import {
  TOOL_ITEMS,
  STUDIO_ITEMS,
  type ToolSurface,
  type WorkspaceProject
} from "./workspace-sections";

const WORKSPACE_MODES = [
  { id: "manager", label: "Чат", icon: "chats", description: "Диалоги и идеи" },
  { id: "work", label: "Work", icon: "work", description: "Задачи и материалы" },
  { id: "code", label: "Code", icon: "code", description: "Код и репозитории" }
] as const;

type Surface = "manager" | ToolSurface;

export function WorkspaceModeMenu({
  surface,
  onNavigate
}: {
  surface: Surface;
  onNavigate: (surface: Surface) => void;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const id = useId();
  const mode = ["manager", "work", "code"].includes(surface) ? surface : null;
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (ref.current?.open && event.target instanceof Node && !ref.current.contains(event.target))
        ref.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && ref.current?.open) {
        event.preventDefault();
        ref.current.open = false;
        ref.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  return (
    <details className="workspace-mode-menu" ref={ref}>
      <summary className="brand" aria-label="Режимы Kosmora" aria-controls={id}>
        <span className="brand-mark">
          <Icon name="cosmora" />
        </span>
        <span className="brand-name">Kosmora</span>
        <svg className="brand-chevron" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="m7 10 5 5 5-5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </summary>
      <nav className={`workspace-modes ${styles.panel}`} id={id} aria-label="Режимы работы">
        {WORKSPACE_MODES.map((item) => (
          <button
            type="button"
            key={item.id}
            className={styles.row}
            aria-label={item.label}
            aria-current={mode === item.id ? "page" : undefined}
            onClick={() => {
              onNavigate(item.id);
              if (ref.current) {
                ref.current.open = false;
                ref.current.querySelector("summary")?.focus();
              }
            }}
          >
            <Icon name={item.icon} />
            <span>
              <strong>{item.label}</strong>
              <small>{item.description}</small>
            </span>
            {mode === item.id && <Icon name="check" />}
          </button>
        ))}
        <div className={styles.utilities}>
          <Link
            href="/research-workspace"
            className={styles.row}
            aria-label="Глубокий поиск и отчёты"
            onClick={() => {
              if (ref.current) ref.current.open = false;
            }}
          >
            <Icon name="search" />
            <span>
              <strong>Исследования</strong>
              <small>Поиск, источники и отчёты</small>
            </span>
          </Link>
          <Link
            href="/presentations"
            className={styles.row}
            onClick={() => {
              if (ref.current) ref.current.open = false;
            }}
          >
            <Icon name="studio" />
            <span>
              <strong>Презентации</strong>
              <small>Слайды и PPTX</small>
            </span>
          </Link>
        </div>
      </nav>
    </details>
  );
}

export function AccountMenu({
  onSettings,
  controlCenterHref
}: {
  onSettings: () => void;
  controlCenterHref: string;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const id = useId();
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (ref.current?.open && event.target instanceof Node && !ref.current.contains(event.target))
        ref.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && ref.current?.open) {
        ref.current.open = false;
        ref.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  const close = () => {
    if (ref.current) ref.current.open = false;
  };
  return (
    <details className="account-area" ref={ref}>
      <summary
        className="profile account-trigger"
        aria-label="Аккаунт владельца"
        aria-controls={id}
      >
        <span className="avatar">
          <Icon name="owner" />
        </span>
        <span>
          <strong>Владелец</strong>
          <small>Локальный профиль</small>
        </span>
        <Icon name="more" />
      </summary>
      <div className="account-menu" id={id} aria-label="Меню аккаунта">
        <div className="account-menu-heading">
          <strong>Ваше пространство</strong>
          <small>Kosmora · локальный профиль</small>
        </div>
        <button
          type="button"
          onClick={() => {
            close();
            onSettings();
          }}
        >
          <Icon name="settings" />
          Аккаунт и настройки
        </button>
        <Link href="/model-status" onClick={close}>
          <Icon name="cosmora" />
          Модель и API
        </Link>
        <Link href={controlCenterHref} onClick={close}>
          <Icon name="shield" />
          Автономность и безопасность
        </Link>
      </div>
    </details>
  );
}

type MobileProps = {
  surface: "manager" | ToolSurface;
  onNewChat: () => void;
  onNavigate: (surface: Surface) => void;
  chats: { id: string; title: string }[];
  projects: WorkspaceProject[];
  onOpenChat: (id: string) => void;
  onOpenProject: (id: string) => void;
};
export function MobileNavigation({
  surface,
  onNewChat,
  onNavigate,
  chats,
  projects,
  onOpenChat,
  onOpenProject
}: MobileProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const menuId = useId();
  const titleId = useId();
  const [query, setQuery] = useState("");
  const search = query.trim().toLocaleLowerCase("ru");
  const matchingChats = search
    ? chats.filter((chat) => chat.title.toLocaleLowerCase("ru").includes(search))
    : chats.slice(0, 6);
  const matchingProjects = search
    ? projects.filter((project) => project.title.toLocaleLowerCase("ru").includes(search))
    : projects.slice(0, 6);
  const close = () => dialog.current?.close();
  const navigate = (id: Surface) => {
    close();
    onNavigate(id);
  };
  const studioActive = ["studio", "files", "images", "video", "sound"].includes(surface);
  return (
    <>
      <nav className="mobile-nav" aria-label="Мобильная навигация">
        <button
          type="button"
          className={surface === "manager" ? "active" : ""}
          aria-current={surface === "manager" ? "page" : undefined}
          onClick={onNewChat}
        >
          <Icon name="new-chat" />
          <span>Новый чат</span>
        </button>
        <button
          type="button"
          aria-label="Режимы"
          aria-haspopup="dialog"
          aria-controls={menuId}
          className={surface === "work" || surface === "code" ? "active" : ""}
          aria-current={surface === "work" || surface === "code" ? "page" : undefined}
          onClick={() => dialog.current?.showModal()}
        >
          <Icon name={surface === "code" ? "code" : "work"} />
          <span>Режимы</span>
        </button>
        {(["studio"] as const).map((id) => {
          const active = id === "studio" ? studioActive : surface === id;
          return (
            <button
              type="button"
              key={id}
              className={active ? "active" : ""}
              aria-current={active ? "page" : undefined}
              onClick={() => onNavigate(id)}
            >
              <Icon name={id} />
              <span>Studio</span>
            </button>
          );
        })}
        <button
          type="button"
          aria-label="Все разделы"
          aria-haspopup="dialog"
          aria-controls={menuId}
          onClick={() => dialog.current?.showModal()}
        >
          <Icon name="more" />
          <span>Ещё</span>
        </button>
      </nav>
      <dialog
        className="workspace-drawer"
        id={menuId}
        ref={dialog}
        aria-labelledby={titleId}
        onClose={() => setQuery("")}
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
      >
        <div className="drawer-content">
          <header>
            <div>
              <small>Kosmora</small>
              <h2 id={titleId}>Ваше пространство</h2>
            </div>
            <button type="button" aria-label="Закрыть меню" onClick={close}>
              <Icon name="close" />
            </button>
          </header>
          <label className="drawer-search">
            <Icon name="search" />
            <input
              aria-label="Поиск чатов и проектов"
              placeholder="Найти чат или проект…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && query) {
                  event.preventDefault();
                  event.stopPropagation();
                  setQuery("");
                }
              }}
            />
          </label>
          <section className={`drawer-modes ${styles.mobileModes}`} aria-label="Режимы работы">
            <h3>Режим работы</h3>
            {WORKSPACE_MODES.map((item) => (
              <button
                type="button"
                key={item.id}
                className={styles.row}
                aria-label={item.label}
                aria-current={surface === item.id ? "page" : undefined}
                onClick={() => navigate(item.id)}
              >
                <Icon name={item.icon} />
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.description}</small>
                </span>
                {surface === item.id && <Icon name="check" />}
              </button>
            ))}
          </section>
          <div className="drawer-links">
            {TOOL_ITEMS.filter(
              (item) => !["work", "code", "files", "images", "video", "sound"].includes(item.id)
            ).map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => navigate(item.id)}
                aria-current={surface === item.id ? "page" : undefined}
              >
                <Icon name={item.id} />
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.description}</small>
                </span>
              </button>
            ))}
          </div>
          <section>
            <h3>Kosmora Studio</h3>
            <div className="drawer-studio">
              {STUDIO_ITEMS.map((item) => (
                <button type="button" key={item.id} onClick={() => navigate(item.id)}>
                  <Icon name={item.id} />
                  {item.label}
                </button>
              ))}
              <Link href="/presentations" className={styles.row} onClick={close}>
                <Icon name="studio" />
                Презентации
              </Link>
            </div>
          </section>
          <section>
            <h3>{search ? "Чаты" : "Последние чаты"}</h3>
            {matchingChats.length ? (
              matchingChats.map((chat) => (
                <button
                  type="button"
                  className="drawer-history"
                  key={chat.id}
                  onClick={() => {
                    close();
                    onOpenChat(chat.id);
                  }}
                >
                  <Icon name="chats" />
                  {chat.title}
                </button>
              ))
            ) : (
              <p>{search ? "Чаты не найдены." : "Здесь появится история ваших диалогов."}</p>
            )}
          </section>
          {(projects.length > 0 || search) && (
            <section>
              <h3>Проекты</h3>
              {matchingProjects.length ? (
                matchingProjects.map((project) => (
                  <button
                    type="button"
                    className="drawer-history"
                    key={project.id}
                    onClick={() => {
                      close();
                      onOpenProject(project.id);
                    }}
                  >
                    <Icon name="projects" />
                    {project.title}
                  </button>
                ))
              ) : (
                <p>Проекты не найдены.</p>
              )}
            </section>
          )}
        </div>
      </dialog>
    </>
  );
}
