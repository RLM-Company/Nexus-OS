"use client";

import Link from "next/link";
import { loadMockSkillCatalog } from "./skills-manifest";
import styles from "./skills.module.css";

const skills = loadMockSkillCatalog();

export default function SkillsPreviewPage() {
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <Link className={styles.backLink} href="/">
            ← Назад в Cosmora
          </Link>
          <div>
            <p className={styles.eyebrow}>Safe preview</p>
            <h1>Skills</h1>
            <p className={styles.lead}>
              Каталог manifest-контрактов. Здесь можно посмотреть будущие разрешения, но нельзя
              запускать произвольный код или выдавать новые полномочия.
            </p>
          </div>
        </header>

        <section className={styles.boundary} aria-label="Граница Skills">
          <strong>Preview only</strong>
          <p>
            Источник — mock-данные. Выполнение, установка пакетов, subprocess, OAuth и внешние
            write-операции отключены.
          </p>
        </section>

        <div className={styles.catalog} data-testid="skills-catalog">
          {skills.map((skill) => (
            <article className={styles.card} key={skill.id}>
              <header className={styles.cardHeader}>
                <div>
                  <small>
                    {skill.id} · v{skill.version}
                  </small>
                  <h2>{skill.name}</h2>
                </div>
                <span className={styles.badge}>Mock</span>
              </header>

              <p className={styles.summary}>{skill.summary}</p>

              <section className={styles.permissions} aria-label={`Разрешения ${skill.name}`}>
                <h3>Permissions preview</h3>
                {skill.permissions.map((permission) => (
                  <div className={styles.permission} key={permission.id}>
                    <div>
                      <strong>{permission.label}</strong>
                      <small>{permission.id}</small>
                    </div>
                    <span>{permission.mode === "read" ? "Read-only" : "Preview"}</span>
                    <p>{permission.description}</p>
                  </div>
                ))}
              </section>

              <button type="button" disabled>
                Запуск отключён
              </button>
            </article>
          ))}
        </div>
      </div>
    </main>
  );
}
