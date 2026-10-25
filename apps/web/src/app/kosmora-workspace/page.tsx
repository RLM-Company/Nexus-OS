/** Experimental package entry point. No fabricated account or execution statistics. */
export default function KosmoraWorkspacePage() {
  return (
    <main
      style={{
        maxWidth: 680,
        margin: "80px auto",
        padding: 24,
        fontFamily: "system-ui",
        color: "#171717"
      }}
    >
      <p>Экспериментальная архитектура</p>
      <h1>Kosmora Workspace</h1>
      <p>
        Этот пакет ещё не подключён к рабочим данным и исполнителям Kosmora. Здесь пока нет
        выполненных задач, статистики аккаунта или подтверждённых результатов.
      </p>
      <a href="/">Вернуться в Kosmora</a>
    </main>
  );
}
