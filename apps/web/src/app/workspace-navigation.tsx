"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { WorkspaceIcon as Icon } from "./workspace-icons";
import {
  TOOL_ITEMS,
  STUDIO_ITEMS,
  type ToolSurface,
  type WorkspaceProject
} from "./workspace-sections";

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
          <small>Cosmora · локальный профиль</small>
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
  onNavigate: (surface: ToolSurface) => void;
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
  const navigate = (id: ToolSurface) => {
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
        {(["work", "code", "studio"] as const).map((id) => {
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
              <span>{id === "studio" ? "Studio" : id === "work" ? "Work" : "Code"}</span>
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
              <small>Cosmora</small>
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
          <div className="drawer-links">
            {TOOL_ITEMS.filter(
              (item) => !["files", "images", "video", "sound"].includes(item.id)
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
            <h3>Cosmora Studio</h3>
            <div className="drawer-studio">
              {STUDIO_ITEMS.map((item) => (
                <button type="button" key={item.id} onClick={() => navigate(item.id)}>
                  <Icon name={item.id} />
                  {item.label}
                </button>
              ))}
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
