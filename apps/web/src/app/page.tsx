const SparkIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24">
    <path d="M12 2l1.55 5.3L19 9l-5.45 1.7L12 16l-1.55-5.3L5 9l5.45-1.7L12 2Z" />
    <path d="m19 15 .75 2.25L22 18l-2.25.75L19 21l-.75-2.25L16 18l2.25-.75L19 15Z" />
  </svg>
);

const GridIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24">
    <rect x="3" y="3" width="7" height="7" rx="2" />
    <rect x="14" y="3" width="7" height="7" rx="2" />
    <rect x="3" y="14" width="7" height="7" rx="2" />
    <rect x="14" y="14" width="7" height="7" rx="2" />
  </svg>
);

const ShieldIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24">
    <path d="M12 3 5 6v5c0 4.8 2.8 8.1 7 10 4.2-1.9 7-5.2 7-10V6l-7-3Z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

export default function Home() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <SparkIcon />
          </span>
          <span>Nexus</span>
          <span className="version">B0.1</span>
        </div>

        <button className="new-project" disabled title="Будет подключено в B01-027">
          <span>＋</span> Новый проект
        </button>

        <nav className="navigation" aria-label="Основная навигация">
          <a className="nav-item active" href="#workspace">
            <GridIcon />
            Рабочая область
          </a>
          <span className="nav-label">Проекты</span>
          <p className="empty-projects">Проекты появятся после подключения Project API.</p>
        </nav>

        <div className="profile">
          <span className="avatar">M</span>
          <span>
            <strong>Владелец</strong>
            <small>Локальный контур</small>
          </span>
          <span className="profile-dot" />
        </div>
      </aside>

      <main className="workspace" id="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">Рабочая область</span>
            <h1>Nexus Control Center</h1>
          </div>
          <div className="system-status" aria-label="Статус системы">
            <span>
              <i className="status-dot" />
              Локальный режим
            </span>
            <span className="privacy-badge">
              <ShieldIcon />
              Данные под контролем
            </span>
          </div>
        </header>

        <section className="hero">
          <div className="hero-symbol">
            <SparkIcon />
          </div>
          <span className="eyebrow">Фундамент готов</span>
          <h2>
            Одна точка управления
            <br />
            для сложной работы
          </h2>
          <p>
            Архитектура Nexus запущена. Следующий шаг — подключение проектов, менеджера и потоковых
            ответов.
          </p>
        </section>

        <section className="composer" aria-label="Будущий ввод задачи">
          <label htmlFor="task">Опишите результат, который хотите получить</label>
          <textarea id="task" disabled placeholder="Например: создай и запусти цифровой бизнес…" />
          <div className="composer-footer">
            <span>Чат станет доступен в B01-027</span>
            <button disabled>
              <SparkIcon />
              Запустить
            </button>
          </div>
        </section>

        <section className="foundation-grid" aria-label="Состояние фундамента">
          <article className="foundation-card accent-card">
            <span className="card-icon">
              <GridIcon />
            </span>
            <div>
              <small>Текущий этап</small>
              <h3>Системная база</h3>
              <p>API, интерфейс и локальная база данных.</p>
            </div>
            <span className="progress">03 / 08</span>
          </article>
          <article className="foundation-card">
            <span className="card-icon">
              <ShieldIcon />
            </span>
            <div>
              <small>Контроль</small>
              <h3>Безопасный контур</h3>
              <p>Секреты остаются на серверной стороне.</p>
            </div>
          </article>
          <article className="foundation-card">
            <span className="card-icon">
              <SparkIcon />
            </span>
            <div>
              <small>Дальше</small>
              <h3>Менеджер и агенты</h3>
              <p>Добавим роли после основного доменного слоя.</p>
            </div>
          </article>
        </section>
      </main>

      <nav className="mobile-nav" aria-label="Мобильная навигация">
        <a href="#workspace" className="active">
          <GridIcon />
          <span>Главная</span>
        </a>
        <span aria-disabled="true">
          <SparkIcon />
          <span>Проекты</span>
        </span>
        <span aria-disabled="true">
          <ShieldIcon />
          <span>Контроль</span>
        </span>
      </nav>
    </div>
  );
}
