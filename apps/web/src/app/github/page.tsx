"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  githubWritePreviews,
  loadGitHubPanel,
  MockGitHubReadonlyAdapter,
  type GitHubPanelState,
  type MockGitHubMode
} from "./github-readonly";
import styles from "./github.module.css";

const modeFromLocation = (): MockGitHubMode => {
  const value = new URLSearchParams(window.location.search).get("state");
  return value === "empty" || value === "offline" || value === "error" ? value : "ready";
};

export default function GitHubReadonlyPage() {
  const [state, setState] = useState<GitHubPanelState>({ kind: "loading" });
  const [mode, setMode] = useState<MockGitHubMode>("ready");

  const load = useCallback(async (requestedMode: MockGitHubMode): Promise<void> => {
    setState({ kind: "loading" });
    const nextState = await loadGitHubPanel(new MockGitHubReadonlyAdapter(requestedMode));
    setState(nextState);
  }, []);

  useEffect(() => {
    const initialMode = modeFromLocation();
    setMode(initialMode);
    void load(initialMode);
  }, [load]);

  const retry = (): void => {
    setMode("ready");
    void load("ready");
  };

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <Link className={styles.backLink} href="/">
            ← Назад в Cosmora
          </Link>
          <div>
            <p className={styles.eyebrow}>Integration preview</p>
            <h1>GitHub</h1>
            <p className={styles.lead}>
              Безопасный read-only preview для Cosmora. Внешнее подключение, OAuth и операции записи
              не выполняются.
            </p>
          </div>
        </header>

        <section className={styles.card} aria-live="polite" data-testid="github-readonly-card">
          {state.kind === "loading" && (
            <div className={styles.loading} data-testid="github-loading">
              Загружаем read-only данные GitHub…
            </div>
          )}

          {state.kind === "empty" && (
            <div className={styles.empty} data-testid="github-empty">
              <strong>Данные GitHub пока отсутствуют</strong>
              <p>Подключение не настроено, поэтому никакие данные не запрашиваются.</p>
            </div>
          )}

          {state.kind === "offline" && (
            <div className={styles.warning} data-testid="github-offline" role="status">
              <strong>GitHub недоступен</strong>
              <p>Проверьте соединение и повторите безопасное read-only чтение.</p>
              <button type="button" onClick={retry} data-testid="github-retry">
                Повторить
              </button>
            </div>
          )}

          {state.kind === "error" && (
            <div className={styles.error} data-testid="github-error" role="alert">
              <strong>Данные GitHub временно недоступны</strong>
              <p>Внутренние детали не отображаются. Повторите попытку позже.</p>
              <button type="button" onClick={retry} data-testid="github-retry">
                Повторить
              </button>
            </div>
          )}

          {state.kind === "ready" && (
            <div className={styles.ready} data-testid="github-ready">
              <div className={styles.readyBanner}>
                <span className={styles.readonlyBadge}>Read-only</span>
                <p>Демонстрационные данные mock adapter; внешние запросы не выполнялись.</p>
              </div>

              <div className={styles.sections}>
                <DataSection title="Репозитории">
                  <a href={state.repository.webUrl} rel="noreferrer" target="_blank">
                    {state.repository.owner}/{state.repository.name}
                  </a>
                  <span>
                    {state.repository.visibility} · default: {state.repository.defaultBranch}
                  </span>
                </DataSection>
                <DataSection title="Ветки">
                  {state.branches.map((branch) => (
                    <span key={branch.name}>
                      {branch.name} · {branch.protected ? "protected" : "unprotected"}
                    </span>
                  ))}
                </DataSection>
                <DataSection title="Commits">
                  {state.commits.map((commit) => (
                    <span key={commit.sha}>
                      {commit.shortSha} · {commit.message}
                    </span>
                  ))}
                </DataSection>
                <DataSection title="Issues">
                  {state.issues.map((issue) => (
                    <span key={issue.number}>
                      #{issue.number} · {issue.title} · {issue.state}
                    </span>
                  ))}
                </DataSection>
                <DataSection title="Pull requests">
                  {state.pullRequests.map((pullRequest) => (
                    <span key={pullRequest.number}>
                      #{pullRequest.number} · {pullRequest.title} · {pullRequest.state}
                    </span>
                  ))}
                </DataSection>
                <DataSection title="CI status">
                  <span>
                    {state.ci.state} ·{" "}
                    {state.ci.checks
                      .map((check) => `${check.name}: ${check.conclusion}`)
                      .join(", ")}
                  </span>
                </DataSection>
              </div>

              <section className={styles.preview} aria-label="Preview-only операции">
                <h2>Операции</h2>
                {githubWritePreviews.map((preview) => (
                  <button key={preview} disabled type="button">
                    {preview}
                  </button>
                ))}
              </section>
            </div>
          )}
        </section>

        <p className={styles.modeNote} data-testid="github-mode">
          Mock state: {mode}
        </p>
      </div>
    </main>
  );
}

function DataSection({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <section className={styles.section} aria-label={title}>
      <h2>{title}</h2>
      <div>{children}</div>
    </section>
  );
}
