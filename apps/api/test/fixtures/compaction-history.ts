import { randomUUID } from "node:crypto";
import { GeneralChatStore, LOCAL_OWNER_ID, type DatabaseHandle } from "@cosmora/db";

export function seedCompactionHistory(db: DatabaseHandle, owner = LOCAL_OWNER_ID, blocked = false) {
  const store = new GeneralChatStore(db.sqlite);
  const accepted = store.createChat(
    blocked
      ? "Цель: проверить большой список условий."
      : "Цель: подготовить письмо партнёру. Не менять sidebar.",
    randomUUID(),
    owner
  );
  store.cancelRun(accepted.run.id, owner);
  const add = db.sqlite.prepare(
    "INSERT INTO general_chat_messages(id,chat_id,owner_id,role,content_type,content,status,created_at,updated_at) VALUES(?,?,?,?,'text',?,'completed',?,?)"
  );
  let budgetMessage = "";
  for (let i = 0; i < 30; i++) {
    const at = new Date(Date.UTC(2026, 9, 30, 0, i)).toISOString();
    const id = randomUUID();
    const content =
      i === 4
        ? "Бюджет 17 350.25 ₽, срок 02.11.2026. Кроме иконок, их можно менять."
        : i === 9
          ? "Работу над анимацией ещё не завершили. Следующий шаг — проверить мобильную версию."
          : blocked
            ? "Обязательное точное условие " + i + ": " + "сохранить без изменений ".repeat(20)
            : "Обсудим оформление страницы.";
    if (i === 4) budgetMessage = id;
    add.run(id, accepted.chat.id, owner, "user", content, at, at);
    add.run(
      randomUUID(),
      accepted.chat.id,
      owner,
      "assistant",
      "Подробное описание визуальных вариантов. ".repeat(40),
      at,
      at
    );
  }
  return { store, chatId: accepted.chat.id, budgetMessage };
}
