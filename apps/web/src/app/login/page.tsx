import Link from "next/link";
import styles from "./login.module.css";

export default function LoginPage() {
  return (
    <main className={styles.shell}>
      <section className={styles.card} aria-labelledby="login-title">
        <Link className={styles.back} href="/settings">
          ← Настройки
        </Link>
        <span className={styles.eyebrow}>Cosmora / Identity</span>
        <h1 id="login-title">Вход в Cosmora</h1>
        <p className={styles.lead}>
          Единый аккаунт нужен для синхронизации чатов, companion-настроек и будущих уведомлений
          между устройствами.
        </p>

        <div className={styles.providerList}>
          <button type="button" disabled className={styles.provider}>
            <strong>Google</strong>
            <span>OAuth 2.0 / Authorization Code + PKCE · пока не подключено</span>
          </button>
          <button type="button" disabled className={styles.provider}>
            <strong>Telegram</strong>
            <span>OIDC / Authorization Code + PKCE · пока не подключено</span>
          </button>
        </div>

        <div className={styles.verification} aria-label="Статус верификации">
          <div>
            <strong>Верификация</strong>
            <span>Серверная проверка identity token ещё не подключена.</span>
          </div>
          <b>Ожидает</b>
        </div>

        <p className={styles.security}>
          В production Cosmora не должна принимать OAuth ID token как доказательство без серверной
          проверки подписи, issuer, audience и срока действия. Сессия должна выдаваться сервером
          отдельно от внешнего ID token.
        </p>

        <Link className={styles.home} href="/">
          Вернуться в Cosmora
        </Link>
      </section>
    </main>
  );
}
