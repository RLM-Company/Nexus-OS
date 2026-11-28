"use client";

import Link from "next/link";
import { useState, type ReactNode, type ComponentProps } from "react";
import { WorkspaceIcon } from "./workspace-icons";
import styles from "./koscode-navigation.module.css";

export type KoscodeSession = {
  id: string;
  title: string;
  projectId: string | null;
  status?: string;
  mode?: string;
  pinned?: boolean;
};

type Props = {
  projects: Array<{ id: string; title: string }>;
  sessions: KoscodeSession[];
  selectedProjectId?: string | null;
  selectedSessionId?: string | null;
  disabled?: boolean;
  newLabel?: string;
  onNewSession: (projectId?: string) => void;
  onCreateProject: () => void;
  createProjectDisabled?: boolean;
  onSelectProject?: (id: string) => void;
  onSelectSession: (id: string) => void;
  renderSessionMenu?: (session: KoscodeSession) => ReactNode;
  repository?: string;
  branch?: string;
  loadedProjectIds?: readonly string[];
  onNavigate?: ComponentProps<typeof Link>["onNavigate"];
};

const statusLabels: Record<string, string> = {
  running: "В работе",
  checking: "Проверка",
  publishing: "Создание PR",
  proposed: "Изменения готовы",
  drafted: "Правки сохранены",
  checked: "Проверено",
  published: "PR создан",
  failed: "Ошибка",
  cancelled: "Остановлено",
  uncertain: "Нужна сверка"
};

export function KoscodeNavigation({
  projects,
  sessions,
  selectedProjectId,
  selectedSessionId,
  disabled,
  newLabel = "Новая сессия",
  onNewSession,
  onCreateProject,
  createProjectDisabled,
  onSelectProject,
  onSelectSession,
  renderSessionMenu,
  repository,
  branch,
  loadedProjectIds,
  onNavigate
}: Props) {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const search = query.trim().toLocaleLowerCase("ru");
  const matches = (value: string) => value.toLocaleLowerCase("ru").includes(search);
  const known = new Set(projects.map((project) => project.id));
  const loose = sessions.filter(
    (session) => (!session.projectId || !known.has(session.projectId)) && matches(session.title)
  );
  const groups = projects
    .map((project) => ({
      ...project,
      items: sessions.filter(
        (session) =>
          session.projectId === project.id && (matches(project.title) || matches(session.title))
      )
    }))
    .filter((project) => !search || matches(project.title) || project.items.length > 0);

  const sessionRow = (session: KoscodeSession) => {
    const working = ["running", "checking", "publishing"].includes(session.status ?? "");
    return (
      <div
        className={styles.sessionRow}
        key={session.id}
        data-selected={selectedSessionId === session.id || undefined}
      >
        <button
          type="button"
          className={styles.session}
          disabled={disabled}
          aria-current={selectedSessionId === session.id ? "page" : undefined}
          onClick={() => onSelectSession(session.id)}
          title={session.title}
        >
          {session.status ? (
            <span
              className={styles.state}
              data-working={working || undefined}
              title={statusLabels[session.status] ?? session.status}
              aria-label={statusLabels[session.status] ?? session.status}
            />
          ) : (
            <WorkspaceIcon name="chats" />
          )}
          <span className={styles.sessionName}>{session.title}</span>
          {session.pinned && <WorkspaceIcon name="pin" />}
          {session.mode === "work" && <small>Work</small>}
        </button>
        {renderSessionMenu?.(session)}
      </div>
    );
  };

  return (
    <div className={styles.root}>
      <button
        type="button"
        className={styles.newSession}
        disabled={disabled}
        onClick={() => onNewSession()}
      >
        <WorkspaceIcon name="new-chat" />
        <span>{newLabel}</span>
        <WorkspaceIcon name="plus" />
      </button>
      <div className={styles.search}>
        <WorkspaceIcon name="search" />
        <input
          aria-label="Поиск сессий и проектов Koscode"
          placeholder="Найти сессию или проект"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setQuery("");
          }}
        />
        {query && (
          <button type="button" aria-label="Очистить поиск Koscode" onClick={() => setQuery("")}>
            <WorkspaceIcon name="close" />
          </button>
        )}
      </div>
      <nav className={styles.shortcuts} aria-label="Инструменты разработки">
        <Link
          onNavigate={(event) => onNavigate?.(event)}
          href={
            selectedProjectId
              ? `/code-agent?project=${encodeURIComponent(selectedProjectId)}`
              : "/code-agent"
          }
        >
          <WorkspaceIcon name="code" />
          Рабочая область
        </Link>
        <Link onNavigate={(event) => onNavigate?.(event)} href="/github">
          <WorkspaceIcon name="branch" />
          Репозитории GitHub
        </Link>
      </nav>
      <section className={styles.projects} aria-label="Сессии Koscode">
        <div className={styles.sectionHeading}>
          <span>Проекты</span>
          <button
            type="button"
            title="Создать проект"
            aria-label="Создать проект Koscode"
            disabled={disabled || createProjectDisabled}
            onClick={onCreateProject}
          >
            <WorkspaceIcon name="plus" />
          </button>
        </div>
        {groups.map((project) => (
          <div className={styles.project} key={project.id}>
            <div
              className={styles.projectHeading}
              data-selected={selectedProjectId === project.id || undefined}
            >
              <button
                type="button"
                className={styles.collapse}
                aria-label={`${collapsed.has(project.id) ? "Развернуть" : "Свернуть"} проект ${project.title}`}
                aria-expanded={!collapsed.has(project.id)}
                onClick={() =>
                  setCollapsed((current) => {
                    const next = new Set(current);
                    if (next.has(project.id)) next.delete(project.id);
                    else next.add(project.id);
                    return next;
                  })
                }
              >
                <span aria-hidden="true">›</span>
              </button>
              {onSelectProject ? (
                <button
                  className={styles.projectName}
                  type="button"
                  disabled={disabled}
                  onClick={() => onSelectProject(project.id)}
                >
                  <WorkspaceIcon name="projects" />
                  <span>{project.title}</span>
                </button>
              ) : (
                <Link
                  onNavigate={(event) => onNavigate?.(event)}
                  className={styles.projectName}
                  href={`/code-agent?project=${encodeURIComponent(project.id)}`}
                >
                  <WorkspaceIcon name="projects" />
                  <span>{project.title}</span>
                </Link>
              )}
              <button
                type="button"
                className={styles.projectNew}
                title={`Новая сессия: ${project.title}`}
                aria-label={`Новая сессия в проекте ${project.title}`}
                disabled={disabled}
                onClick={() => onNewSession(project.id)}
              >
                <WorkspaceIcon name="plus" />
              </button>
            </div>
            {!collapsed.has(project.id) && (
              <div className={styles.projectSessions}>
                {project.items.map(sessionRow)}
                {project.items.length === 0 && (
                  <span className={styles.emptyProject}>
                    {loadedProjectIds && !loadedProjectIds.includes(project.id)
                      ? "Откройте проект, чтобы увидеть сессии"
                      : "Пока нет сессий"}
                  </span>
                )}
                <Link
                  onNavigate={(event) => onNavigate?.(event)}
                  className={styles.projectWorkspace}
                  href={`/code-agent?project=${encodeURIComponent(project.id)}`}
                >
                  Задачи и проверки
                  <WorkspaceIcon name="arrow" />
                </Link>
              </div>
            )}
          </div>
        ))}
        {loose.length > 0 && (
          <div className={styles.loose}>
            <div className={styles.sectionHeading}>
              <span>Без проекта</span>
            </div>
            {loose.map(sessionRow)}
          </div>
        )}
        {groups.length === 0 && loose.length === 0 && (
          <div className={styles.empty}>
            <WorkspaceIcon name="projects" />
            <p>{search ? "Ничего не найдено" : "Начните с проекта"}</p>
            <span>
              {search
                ? "Попробуйте другое название."
                : "Сессии, задачи и изменения будут собраны здесь."}
            </span>
          </div>
        )}
      </section>
      {(repository || branch) && (
        <div className={styles.repository}>
          <WorkspaceIcon name="branch" />
          <div>
            {repository && <strong title={repository}>{repository}</strong>}
            {branch && <span title={branch}>{branch}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
